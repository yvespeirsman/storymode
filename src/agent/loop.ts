import { createTwoFilesPatch } from "diff";
import { type LanguageModel, type ModelMessage, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import type { ProjectConfig } from "../project/schema.js";
import * as bibleTools from "../tools/bibleTools.js";
import * as continuityTools from "../tools/continuityTools.js";
import * as fileTools from "../tools/fileTools.js";
import * as manuscriptTools from "../tools/manuscriptTools.js";
import * as outlineTools from "../tools/outlineTools.js";
import * as skillTools from "../tools/skillTools.js";
import * as styleTools from "../tools/styleTools.js";
import { buildSystemPrompt } from "./systemPrompt.js";

const WRITE_TOOL_NAMES = [
  "updateOutline",
  "updateBeats",
  "writeChapter",
  "appendScene",
  "upsertCharacter",
  "upsertLocation",
] as const;

export interface PendingApproval {
  approvalId: string;
  toolName: string;
  description: string;
  diffText: string | null;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

export interface SkillUsed {
  id: string;
  name: string;
}

export interface AgentLoopDeps {
  model: LanguageModel;
  projectDir: string;
  project: ProjectConfig;
  onApprovalRequest: (approval: PendingApproval) => Promise<ApprovalDecision>;
  /** Called with each chunk of assistant text as it streams in, in order. */
  onTextDelta?: (delta: string) => void;
  /** Called synchronously when a skill-backed tool (e.g. draftOutline) is invoked. */
  onSkillUsed?: (skill: SkillUsed) => void;
}

function patch(path: string, oldText: string, newText: string): string {
  if (oldText === newText) return "(no changes)";
  return createTwoFilesPatch(path, path, oldText, newText, "", "", { context: 3 });
}

const DRAFT_OUTLINE_SKILL_ID = "draft-outline";
const DRAFT_OUTLINE_FALLBACK_DESCRIPTION =
  "Call this before drafting or revising the top-level outline. Returns drafting instructions " +
  "plus the story's lore, cast, and current outline in one call.";

/**
 * A model can ignore a prompt nudge and jump straight to updateOutline without gathering real
 * context first, producing near-empty or placeholder content. This is shared between buildTools
 * (which flips it once draftOutline runs) and runTurn's approval loop (which checks it before ever
 * showing the human an approval prompt for updateOutline — the diff is built from the model's raw
 * tool-call input, so blocking only inside execute() would still show a bogus approval prompt).
 */
export interface OutlineGuardState {
  draftOutlineCalled: boolean;
}

/** Whether an approval request for this tool call should be auto-rejected without ever reaching the human. */
export function shouldAutoRejectApproval(toolName: string, outlineGuard: OutlineGuardState): boolean {
  return toolName === "updateOutline" && !outlineGuard.draftOutlineCalled;
}

export function buildTools(deps: AgentLoopDeps, outlineGuard: OutlineGuardState) {
  const { projectDir, model } = deps;
  const draftOutlineSkill = skillTools.readSkill(projectDir, DRAFT_OUTLINE_SKILL_ID);

  return {
    readFile: tool({
      description: "Read a text file from the project by its relative path.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => fileTools.readProjectFile(projectDir, path),
    }),
    listFiles: tool({
      description: "List files and directories under a relative project directory.",
      inputSchema: z.object({ dir: z.string(), recursive: z.boolean().optional() }),
      execute: async ({ dir, recursive }) => fileTools.listProjectFiles(projectDir, dir, { recursive }),
    }),
    searchText: tool({
      description: "Case-insensitive text search across markdown files under a directory.",
      inputSchema: z.object({ dir: z.string(), query: z.string() }),
      execute: async ({ dir, query }) => fileTools.searchProjectText(projectDir, dir, query),
    }),

    readOutline: tool({
      description: "Read the top-level plot/act outline.",
      inputSchema: z.object({}),
      execute: async () => outlineTools.readOutline(projectDir) || "(outline is empty)",
    }),
    draftOutline: tool({
      description: draftOutlineSkill?.description ?? DRAFT_OUTLINE_FALLBACK_DESCRIPTION,
      inputSchema: z.object({}),
      execute: async () => {
        outlineGuard.draftOutlineCalled = true;
        deps.onSkillUsed?.({ id: DRAFT_OUTLINE_SKILL_ID, name: draftOutlineSkill?.name ?? DRAFT_OUTLINE_SKILL_ID });
        return {
          instructions:
            draftOutlineSkill?.instructions ??
            `(no draft-outline skill found — create ${skillTools.skillPath(DRAFT_OUTLINE_SKILL_ID)})`,
          lore: bibleTools.readLore(projectDir) || "(no lore recorded yet)",
          characters: bibleTools.listCharacters(projectDir).map((c) => ({ slug: c.slug, ...c.frontmatter })),
          currentOutline: outlineTools.readOutline(projectDir) || "(outline is empty)",
        };
      },
    }),
    updateOutline: tool({
      description: "Replace the top-level outline with new contents. Requires user approval. Call draftOutline first.",
      inputSchema: z.object({ contents: z.string() }),
      execute: async ({ contents }) => {
        if (!outlineGuard.draftOutlineCalled) {
          throw new Error("Call draftOutline first to gather lore, cast, and the current outline, then retry.");
        }
        outlineTools.updateOutline(projectDir, contents);
        return "Outline updated.";
      },
    }),
    readBeats: tool({
      description: "Read the scene beat sheet for a chapter.",
      inputSchema: z.object({ chapterId: z.string() }),
      execute: async ({ chapterId }) => outlineTools.readBeats(projectDir, chapterId) || "(no beats recorded yet)",
    }),
    updateBeats: tool({
      description: "Replace the scene beat sheet for a chapter. Requires user approval.",
      inputSchema: z.object({ chapterId: z.string(), contents: z.string() }),
      execute: async ({ chapterId, contents }) => {
        outlineTools.updateBeats(projectDir, chapterId, contents);
        return `Beats for "${chapterId}" updated.`;
      },
    }),

    readStyleGuide: tool({
      description:
        "Call this before drafting or revising prose (a chapter or scene) so the voice stays " +
        "consistent — point of view, tense, rhythm, tone, and any example passages. Not needed for " +
        "structural work like the outline or beat sheets.",
      inputSchema: z.object({}),
      execute: async () => styleTools.readStyleGuide(projectDir) || "(no style guide recorded yet)",
    }),

    listChapters: tool({
      description: "List chapter ids currently in the manuscript.",
      inputSchema: z.object({}),
      execute: async () => manuscriptTools.listChapters(projectDir),
    }),
    readChapter: tool({
      description: "Read the full text of a chapter by id (filename without extension).",
      inputSchema: z.object({ chapterId: z.string() }),
      execute: async ({ chapterId }) =>
        manuscriptTools.readChapter(projectDir, chapterId) || "(chapter is empty or does not exist yet)",
    }),
    writeChapter: tool({
      description:
        "Overwrite a chapter file with new full contents. Call readStyleGuide first if you haven't " +
        "already this session. Requires user approval.",
      inputSchema: z.object({ chapterId: z.string(), contents: z.string() }),
      execute: async ({ chapterId, contents }) => {
        manuscriptTools.writeChapter(projectDir, chapterId, contents);
        return `Chapter "${chapterId}" written (${manuscriptTools.wordCount(contents)} words).`;
      },
    }),
    appendScene: tool({
      description:
        "Append a new scene to the end of a chapter. Call readStyleGuide first if you haven't " +
        "already this session. Requires user approval.",
      inputSchema: z.object({ chapterId: z.string(), sceneText: z.string() }),
      execute: async ({ chapterId, sceneText }) => {
        const { newContents } = manuscriptTools.buildAppendScene(projectDir, chapterId, sceneText);
        manuscriptTools.writeChapter(projectDir, chapterId, newContents);
        return `Scene appended to "${chapterId}" (${manuscriptTools.wordCount(newContents)} words total).`;
      },
    }),

    listCharacters: tool({
      description: "List all characters recorded in the story bible.",
      inputSchema: z.object({}),
      execute: async () => bibleTools.listCharacters(projectDir).map((c) => ({ slug: c.slug, ...c.frontmatter })),
    }),
    readCharacter: tool({
      description: "Read a character's full bible entry by slug.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => bibleTools.readCharacter(projectDir, slug),
    }),
    upsertCharacter: tool({
      description:
        "Create or update a character's bible entry (name, role, traits, prose bio). Requires user approval. " +
        "To edit or rename an EXISTING character, pass their current `slug` (from listCharacters/readCharacter) " +
        "so the same file is updated in place — omitting it when a character already exists creates a duplicate " +
        "file instead of renaming the original. Only omit `slug` when creating a brand-new character.",
      inputSchema: z.object({
        slug: z.string().optional().describe("The existing character's slug, required when updating or renaming one"),
        name: z.string(),
        role: z.string().optional(),
        traits: z.array(z.string()).optional(),
        body: z.string().optional(),
      }),
      execute: async (input) => {
        const result = bibleTools.upsertCharacter(projectDir, input);
        return `Character "${input.name}" saved at ${result.path}.`;
      },
    }),

    listLocations: tool({
      description: "List all locations recorded in the story bible.",
      inputSchema: z.object({}),
      execute: async () => bibleTools.listLocations(projectDir).map((l) => ({ slug: l.slug, ...l.frontmatter })),
    }),
    readLocation: tool({
      description: "Read a location's full bible entry by slug.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => bibleTools.readLocation(projectDir, slug),
    }),
    upsertLocation: tool({
      description:
        "Create or update a location's bible entry (name, summary, prose description). Requires user approval. " +
        "To edit or rename an EXISTING location, pass its current `slug` (from listLocations/readLocation) so " +
        "the same file is updated in place — omitting it when a location already exists creates a duplicate " +
        "file instead of renaming the original. Only omit `slug` when creating a brand-new location.",
      inputSchema: z.object({
        slug: z.string().optional().describe("The existing location's slug, required when updating or renaming one"),
        name: z.string(),
        summary: z.string().optional(),
        body: z.string().optional(),
      }),
      execute: async (input) => {
        const result = bibleTools.upsertLocation(projectDir, input);
        return `Location "${input.name}" saved at ${result.path}.`;
      },
    }),

    extractContinuityFacts: tool({
      description:
        "Extract atomic canonical facts from a chapter's text (traits, dates, relationships, places) and record " +
        "them for later continuity checking. Safe to call after drafting or editing a chapter.",
      inputSchema: z.object({ chapterId: z.string(), chapterText: z.string() }),
      execute: async ({ chapterId, chapterText }) => {
        const facts = await continuityTools.extractFacts(model, projectDir, chapterId, chapterText);
        return `Recorded ${facts.length} continuity fact(s) from "${chapterId}".`;
      },
    }),
    checkContinuity: tool({
      description: "Check a passage of text against previously recorded continuity facts for contradictions.",
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        const contradictions = await continuityTools.checkConsistency(model, projectDir, text);
        return contradictions.length === 0 ? "No contradictions found." : contradictions;
      },
    }),
  };
}

function buildToolApproval(): Record<(typeof WRITE_TOOL_NAMES)[number], "user-approval"> {
  return Object.fromEntries(WRITE_TOOL_NAMES.map((name) => [name, "user-approval" as const])) as Record<
    (typeof WRITE_TOOL_NAMES)[number],
    "user-approval"
  >;
}

function describeDiff(
  projectDir: string,
  toolName: string,
  input: Record<string, unknown>,
): { description: string; diffText: string } | null {
  try {
    switch (toolName) {
      case "updateOutline": {
        const oldText = outlineTools.readOutline(projectDir);
        return { description: "Update outline", diffText: patch("outline.md", oldText, String(input.contents)) };
      }
      case "updateBeats": {
        const chapterId = String(input.chapterId);
        const oldText = outlineTools.readBeats(projectDir, chapterId);
        return {
          description: `Update beats for "${chapterId}"`,
          diffText: patch(`beats/${chapterId}.md`, oldText, String(input.contents)),
        };
      }
      case "writeChapter": {
        const chapterId = String(input.chapterId);
        const oldText = manuscriptTools.readChapter(projectDir, chapterId);
        return {
          description: `Write chapter "${chapterId}"`,
          diffText: patch(`manuscript/${chapterId}.md`, oldText, String(input.contents)),
        };
      }
      case "appendScene": {
        const chapterId = String(input.chapterId);
        const { oldContents, newContents } = manuscriptTools.buildAppendScene(
          projectDir,
          chapterId,
          String(input.sceneText),
        );
        return {
          description: `Append scene to "${chapterId}"`,
          diffText: patch(`manuscript/${chapterId}.md`, oldContents, newContents),
        };
      }
      case "upsertCharacter": {
        const result = bibleTools.buildCharacterUpsert(projectDir, input as { slug?: string; name: string });
        return {
          description: `Update character "${input.name}"`,
          diffText: patch(result.path, result.oldContents ?? "", result.newContents),
        };
      }
      case "upsertLocation": {
        const result = bibleTools.buildLocationUpsert(projectDir, input as { slug?: string; name: string });
        return {
          description: `Update location "${input.name}"`,
          diffText: patch(result.path, result.oldContents ?? "", result.newContents),
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export interface RunTurnResult {
  text: string;
  messages: ModelMessage[];
}

const MAX_APPROVAL_ROUNDS = 20;

export async function runTurn(deps: AgentLoopDeps, priorMessages: ModelMessage[], userText: string): Promise<RunTurnResult> {
  const outlineGuard: OutlineGuardState = { draftOutlineCalled: false };
  const tools = buildTools(deps, outlineGuard);
  const toolApproval = buildToolApproval();
  const systemPrompt = buildSystemPrompt({
    project: deps.project,
    projectDir: deps.projectDir,
    activeText: userText,
  });

  let messages: ModelMessage[] = [...priorMessages, { role: "user", content: userText }];

  let combinedText = "";

  for (let round = 0; round < MAX_APPROVAL_ROUNDS; round++) {
    const result = streamText({
      model: deps.model,
      system: systemPrompt,
      messages,
      tools,
      toolApproval,
      stopWhen: stepCountIs(8),
    });

    const approvalRequests: Array<{ approvalId: string; toolCall: { toolName: string; input: unknown } }> = [];

    for await (const part of result.stream) {
      if (part.type === "text-start") {
        // Each text block (e.g. before/after a tool call) streams independently and rarely
        // starts with its own leading space, so without this two sentences from different
        // blocks can run together with no space between them.
        if (combinedText.length > 0 && !/\s$/.test(combinedText)) {
          const separator = "\n\n";
          combinedText += separator;
          deps.onTextDelta?.(separator);
        }
      } else if (part.type === "text-delta") {
        combinedText += part.text;
        deps.onTextDelta?.(part.text);
      } else if (part.type === "tool-approval-request" && !part.isAutomatic) {
        approvalRequests.push(part);
      }
    }

    messages = [...messages, ...(await result.responseMessages)];

    if (approvalRequests.length === 0) {
      return { text: combinedText, messages };
    }

    const responses = [];
    for (const req of approvalRequests) {
      const { toolName, input } = req.toolCall;

      // Refuse before the human ever sees it, not just before writing: the diff below is built
      // straight from the model's raw tool-call input, so a premature call still produces a
      // (bogus) approval prompt unless we intercept it here.
      if (shouldAutoRejectApproval(toolName, outlineGuard)) {
        responses.push({
          type: "tool-approval-response" as const,
          approvalId: req.approvalId,
          approved: false,
          reason: "Call draftOutline first to gather lore, cast, and the current outline, then retry updateOutline.",
        });
        continue;
      }

      const diff = describeDiff(deps.projectDir, toolName, (input ?? {}) as Record<string, unknown>);
      const decision = await deps.onApprovalRequest({
        approvalId: req.approvalId,
        toolName,
        description: diff?.description ?? toolName,
        diffText: diff?.diffText ?? null,
      });
      responses.push({
        type: "tool-approval-response" as const,
        approvalId: req.approvalId,
        approved: decision.approved,
        reason: decision.reason,
      });
    }
    messages = [...messages, { role: "tool", content: responses }];
  }

  return { text: combinedText || "(stopped: too many tool-approval rounds without resolution)", messages };
}
