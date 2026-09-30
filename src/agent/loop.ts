import { createTwoFilesPatch } from "diff";
import { type LanguageModel, type ModelMessage, tool } from "ai";
import { z } from "zod";
import type { ProjectConfig } from "../project/schema.js";
import * as bibleTools from "../tools/bibleTools.js";
import * as continuityTools from "../tools/continuityTools.js";
import * as fileTools from "../tools/fileTools.js";
import * as manuscriptTools from "../tools/manuscriptTools.js";
import * as outlineTools from "../tools/outlineTools.js";
import * as skillTools from "../tools/skillTools.js";
import * as styleTools from "../tools/styleTools.js";
import { runAgenticLoop, type ApprovalDecision, type PendingApproval, type RunTurnResult } from "./agenticLoop.js";
import { compactMessages } from "./compaction.js";
import { runDraftChapterAgent } from "./draftChapterAgent.js";
import { buildSystemPrompt } from "./systemPrompt.js";

export type { ApprovalDecision, PendingApproval, RunTurnResult } from "./agenticLoop.js";

const WRITE_TOOL_NAMES = ["updateOutline", "updateBeats", "upsertCharacter", "upsertLocation"] as const;

export interface SkillUsed {
  id: string;
  name: string;
}

export interface SubAgentStarted {
  id: string;
  name: string;
  /** Short identifying detail for the log line, e.g. the chapter id being drafted. */
  detail?: string;
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
  /** Called synchronously when a tool hands off to its own nested sub-agent (e.g. draftChapter). */
  onSubAgentStarted?: (subAgent: SubAgentStarted) => void;
  /**
   * Called the moment the model starts generating a tool call's arguments — including the (often
   * large, slow-to-generate) content of write tools like updateOutline. No text-delta events fire
   * during this phase, so without this callback the UI has no signal that anything is happening
   * between "here's the draft I'd propose" and the approval prompt finally appearing.
   */
  onToolCallStart?: (toolName: string) => void;
  /** Called when the prior conversation history was summarized to keep requests from growing unbounded. */
  onCompaction?: (info: { summarizedCount: number; keptCount: number }) => void;
}

function patch(path: string, oldText: string, newText: string): string {
  if (oldText === newText) return "(no changes)";
  return createTwoFilesPatch(path, path, oldText, newText, "", "", { context: 3 });
}

const DRAFT_OUTLINE_SKILL_ID = "draft-outline";
const DRAFT_OUTLINE_FALLBACK_DESCRIPTION =
  "Call this before drafting or revising the top-level outline. Returns drafting instructions " +
  "plus the story's lore, cast, and current outline in one call.";

const DRAFT_CHARACTER_SKILL_ID = "draft-character";
const DRAFT_CHARACTER_FALLBACK_DESCRIPTION =
  "Call this before creating or updating a character's bible entry. Returns drafting instructions " +
  "plus the story's lore and existing cast in one call.";

const DRAFT_CHAPTER_SKILL_ID = "draft-chapter";
const DRAFT_CHAPTER_FALLBACK_DESCRIPTION =
  "Draft or revise a chapter or scene. Runs as a focused sub-agent that handles the style guide, " +
  "beats, continuity, and the actual (approval-gated) write itself — give it a clear brief.";

/**
 * Maps each content-generating write tool to the (skill-backed) tool that must be called first
 * this turn — by tool name, not skill id, so the auto-reject reason below can tell the model
 * exactly which tool to call. A model can ignore a prompt nudge and jump straight to a write tool
 * without gathering real context first, producing near-empty or placeholder content. This is
 * shared between buildTools (which records a prerequisite tool call) and the agentic loop (which
 * checks it before ever showing the human an approval prompt — the diff is built from the model's
 * raw tool-call input, so blocking only inside execute() would still show a bogus prompt).
 */
const SKILL_PREREQUISITES: Record<string, string> = {
  updateOutline: "draftOutline",
  upsertCharacter: "draftCharacter",
};

export interface SkillGuardState {
  calledTools: Set<string>;
}

/** Whether an approval request for this tool call should be auto-rejected without ever reaching the human. */
export function shouldAutoRejectApproval(toolName: string, guard: SkillGuardState): boolean {
  const prerequisite = SKILL_PREREQUISITES[toolName];
  return prerequisite !== undefined && !guard.calledTools.has(prerequisite);
}

export function buildTools(deps: AgentLoopDeps, guard: SkillGuardState) {
  const { projectDir, model } = deps;
  const draftOutlineSkill = skillTools.readSkill(projectDir, DRAFT_OUTLINE_SKILL_ID);
  const draftCharacterSkill = skillTools.readSkill(projectDir, DRAFT_CHARACTER_SKILL_ID);
  const draftChapterSkill = skillTools.readSkill(projectDir, DRAFT_CHAPTER_SKILL_ID);

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
        guard.calledTools.add("draftOutline");
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
        if (!guard.calledTools.has("draftOutline")) {
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
      description: "Read the project's style guide (point of view, tense, rhythm, tone, example passages).",
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
    draftChapter: tool({
      description: draftChapterSkill?.description ?? DRAFT_CHAPTER_FALLBACK_DESCRIPTION,
      inputSchema: z.object({
        chapterId: z.string().describe('The chapter to draft or revise, e.g. "ch01"'),
        brief: z
          .string()
          .describe(
            "What this chapter (or revision) should accomplish: plot beats, POV, key events, what the " +
              "writer asked for. The sub-agent doesn't see the rest of this conversation — include " +
              "everything it needs to draft or revise the chapter on its own.",
          ),
      }),
      execute: async ({ chapterId, brief }) => {
        deps.onSubAgentStarted?.({
          id: DRAFT_CHAPTER_SKILL_ID,
          name: draftChapterSkill?.name ?? DRAFT_CHAPTER_SKILL_ID,
          detail: chapterId,
        });
        // Deliberately don't forward onTextDelta: the sub-agent's own narration would stream
        // into the same live text block as the outer model's, then vanish when the turn ends
        // (the final log entry only keeps the outer loop's text). Its return value still reaches
        // the outer model as the tool result, which decides what to relay to the user.
        return runDraftChapterAgent({ ...deps, onTextDelta: undefined }, chapterId, brief);
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
    draftCharacter: tool({
      description: draftCharacterSkill?.description ?? DRAFT_CHARACTER_FALLBACK_DESCRIPTION,
      inputSchema: z.object({}),
      execute: async () => {
        guard.calledTools.add("draftCharacter");
        deps.onSkillUsed?.({
          id: DRAFT_CHARACTER_SKILL_ID,
          name: draftCharacterSkill?.name ?? DRAFT_CHARACTER_SKILL_ID,
        });
        return {
          instructions:
            draftCharacterSkill?.instructions ??
            `(no draft-character skill found — create ${skillTools.skillPath(DRAFT_CHARACTER_SKILL_ID)})`,
          lore: bibleTools.readLore(projectDir) || "(no lore recorded yet)",
          characters: bibleTools.listCharacters(projectDir).map((c) => ({ slug: c.slug, ...c.frontmatter, body: c.body })),
        };
      },
    }),
    upsertCharacter: tool({
      description:
        "Create or update a character's bible entry (name, role, traits, prose bio). Call draftCharacter first. " +
        "Requires user approval. To edit or rename an EXISTING character, pass their current `slug` (from " +
        "listCharacters/readCharacter) so the same file is updated in place — omitting it when a character " +
        "already exists creates a duplicate file instead of renaming the original. Only omit `slug` when " +
        "creating a brand-new character.",
      inputSchema: z.object({
        slug: z.string().optional().describe("The existing character's slug, required when updating or renaming one"),
        name: z.string(),
        role: z.string().optional(),
        traits: z.array(z.string()).optional(),
        body: z.string().optional(),
      }),
      execute: async (input) => {
        if (!guard.calledTools.has("draftCharacter")) {
          throw new Error("Call draftCharacter first to gather lore and the existing cast, then retry.");
        }
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

export async function runTurn(deps: AgentLoopDeps, priorMessages: ModelMessage[], userText: string): Promise<RunTurnResult> {
  const compaction = await compactMessages(deps.model, priorMessages);
  if (compaction.compacted) {
    deps.onCompaction?.({ summarizedCount: compaction.summarizedCount, keptCount: compaction.messages.length });
  }

  const guard: SkillGuardState = { calledTools: new Set() };
  const tools = buildTools(deps, guard);
  const toolApproval = buildToolApproval();
  const systemPrompt = buildSystemPrompt({
    project: deps.project,
    projectDir: deps.projectDir,
    activeText: userText,
  });

  const messages: ModelMessage[] = [...compaction.messages, { role: "user", content: userText }];

  return runAgenticLoop({
    model: deps.model,
    systemPrompt,
    tools,
    toolApproval,
    messages,
    onApprovalRequest: deps.onApprovalRequest,
    onTextDelta: deps.onTextDelta,
    onToolCallStart: deps.onToolCallStart,
    buildApprovalDescription: (toolName, input) => describeDiff(deps.projectDir, toolName, input),
    shouldAutoReject: (toolName) =>
      shouldAutoRejectApproval(toolName, guard)
        ? `Call ${SKILL_PREREQUISITES[toolName]} first to gather context, then retry ${toolName}.`
        : null,
  });
}
