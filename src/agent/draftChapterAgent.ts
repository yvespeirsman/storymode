import { type LanguageModel, type ModelMessage, tool } from "ai";
import { z } from "zod";
import * as bibleTools from "../tools/bibleTools.js";
import * as continuityTools from "../tools/continuityTools.js";
import * as manuscriptTools from "../tools/manuscriptTools.js";
import * as outlineTools from "../tools/outlineTools.js";
import * as skillTools from "../tools/skillTools.js";
import * as styleTools from "../tools/styleTools.js";
import { runAgenticLoop, type ApprovalDecision, type PendingApproval } from "./agenticLoop.js";

const DRAFT_CHAPTER_SKILL_ID = "draft-chapter";

const DEFAULT_INSTRUCTIONS =
  "Apply the style guide below exactly. Follow the beat sheet if one exists; otherwise use the " +
  "outline. Keep character voices and established facts consistent. writeChapter replaces the " +
  "whole file; appendScene only adds a new scene at the end. Show, don't tell.";

/** The subset of AgentLoopDeps this sub-agent actually needs — kept independent of loop.ts to avoid a circular import. */
export interface DraftChapterAgentDeps {
  model: LanguageModel;
  projectDir: string;
  onApprovalRequest: (approval: PendingApproval) => Promise<ApprovalDecision>;
  onTextDelta?: (delta: string) => void;
  onToolCallStart?: (toolName: string) => void;
}

/**
 * A word-count summary rather than a full diff: chapter text is far too long to review line by
 * line in a terminal approval prompt, so the prompt tells the writer where to go read it
 * (the manuscript file) instead of dumping the whole thing inline.
 */
function summarizeChapterChange(chapterId: string, oldText: string, newText: string): string {
  if (oldText === newText) return "(no changes)";
  const path = `manuscript/${chapterId}.md`;
  const newWords = manuscriptTools.wordCount(newText);
  if (!oldText.trim()) {
    return `New chapter, ${newWords} word(s). Review the full draft in ${path}.`;
  }
  const oldWords = manuscriptTools.wordCount(oldText);
  const delta = newWords - oldWords;
  const sign = delta >= 0 ? "+" : "";
  return `${oldWords} → ${newWords} word(s) (${sign}${delta}). Review the full text in ${path}.`;
}

/**
 * The chapter id immediately before `chapterId` in manuscript order, or null if there isn't one
 * (this is the first chapter, or no earlier chapters exist yet). Works whether `chapterId` is a
 * brand-new chapter (not yet on disk, so absent from listChapters) or an existing one being
 * revised (present in the list, so excluded from its own "before" comparison).
 */
export function findPreviousChapterId(projectDir: string, chapterId: string): string | null {
  const chapters = manuscriptTools.listChapters(projectDir).filter((id) => id !== chapterId);
  const firstLaterIndex = chapters.findIndex((id) => id > chapterId);
  const priorChapters = firstLaterIndex === -1 ? chapters : chapters.slice(0, firstLaterIndex);
  return priorChapters.length > 0 ? (priorChapters[priorChapters.length - 1] ?? null) : null;
}

export function buildDraftChapterSystemPrompt(params: {
  projectDir: string;
  chapterId: string;
  brief: string;
}): string {
  const { projectDir, chapterId, brief } = params;
  const skill = skillTools.readSkill(projectDir, DRAFT_CHAPTER_SKILL_ID);
  const outline = outlineTools.readOutline(projectDir).trim();
  const styleGuide = styleTools.readStyleGuide(projectDir) || "(no style guide recorded yet)";
  const beats = outlineTools.readBeats(projectDir, chapterId) || "(no beats recorded yet)";
  const currentChapter = manuscriptTools.readChapter(projectDir, chapterId) || "(chapter is empty or does not exist yet)";
  const previousChapterId = findPreviousChapterId(projectDir, chapterId);

  const sections = [
    "You are a focused sub-agent with one job: draft or revise a single chapter of a novel-in-progress. " +
      "You do not see the rest of the conversation the writer is having with the main agent — the task " +
      "below is everything you need. Write the actual prose yourself; don't describe what you would write.",
    skill?.instructions ?? DEFAULT_INSTRUCTIONS,
    `## Task\n${brief}`,
  ];
  if (outline) sections.push(`## Outline\n${outline}`);
  sections.push(`## Style guide\n${styleGuide}`);
  sections.push(`## Beat sheet for ${chapterId}\n${beats}`);
  if (previousChapterId) {
    const previousChapter = manuscriptTools.readChapter(projectDir, previousChapterId);
    sections.push(
      `## Previous chapter (${previousChapterId}) — for continuity\n${previousChapter}\n\n` +
        `Stay consistent with names, settings, physical descriptions, established events, and heading ` +
        `format used above. For chapters further back than this one, call listChapters/readChapter.`,
    );
  }
  sections.push(`## Current content of ${chapterId}\n${currentChapter}`);

  return sections.join("\n\n");
}

export function describeChapterDiff(
  projectDir: string,
  chapterId: string,
  toolName: string,
  input: Record<string, unknown>,
): { description: string; diffText: string } | null {
  try {
    switch (toolName) {
      case "writeChapter": {
        const oldText = manuscriptTools.readChapter(projectDir, chapterId);
        return {
          description: `Write chapter "${chapterId}"`,
          diffText: summarizeChapterChange(chapterId, oldText, String(input.contents)),
        };
      }
      case "appendScene": {
        const { oldContents, newContents } = manuscriptTools.buildAppendScene(
          projectDir,
          chapterId,
          String(input.sceneText),
        );
        return {
          description: `Append scene to "${chapterId}"`,
          diffText: summarizeChapterChange(chapterId, oldContents, newContents),
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** The sub-agent's own toolset, scoped to one fixed chapter — deliberately smaller than the main loop's. */
export function buildDraftChapterAgentTools(model: LanguageModel, projectDir: string, chapterId: string) {
  return {
    listChapters: tool({
      description: "List the ids of all chapters that already exist in the manuscript, in order.",
      inputSchema: z.object({}),
      execute: async () => manuscriptTools.listChapters(projectDir),
    }),
    readChapter: tool({
      description:
        "Read the full current text of any chapter by id (not just the one you're drafting) — use this to " +
        "check names, settings, physical descriptions, timeline, and formatting against chapters further back " +
        "than the one already included in your context.",
      inputSchema: z.object({ chapterId: z.string().describe('e.g. "ch01"') }),
      execute: async ({ chapterId: id }) => manuscriptTools.readChapter(projectDir, id) || "(chapter is empty or does not exist)",
    }),
    readLore: tool({
      description: "Read the story's world rules, glossary, and timeline.",
      inputSchema: z.object({}),
      execute: async () => bibleTools.readLore(projectDir) || "(no lore recorded yet)",
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
    checkContinuity: tool({
      description: "Check a passage of text against previously recorded continuity facts for contradictions.",
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        const contradictions = await continuityTools.checkConsistency(model, projectDir, text);
        return contradictions.length === 0 ? "No contradictions found." : contradictions;
      },
    }),
    extractContinuityFacts: tool({
      description:
        "Extract atomic canonical facts from this chapter's text (traits, dates, relationships, places) and " +
        "record them for later continuity checking. Call after drafting or revising.",
      inputSchema: z.object({ chapterText: z.string() }),
      execute: async ({ chapterText }) => {
        const facts = await continuityTools.extractFacts(model, projectDir, chapterId, chapterText);
        return `Recorded ${facts.length} continuity fact(s) from "${chapterId}".`;
      },
    }),
    writeChapter: tool({
      description: "Overwrite this chapter with new full contents. Requires user approval.",
      inputSchema: z.object({ contents: z.string() }),
      execute: async ({ contents }) => {
        manuscriptTools.writeChapter(projectDir, chapterId, contents);
        return `Chapter "${chapterId}" written (${manuscriptTools.wordCount(contents)} words).`;
      },
    }),
    appendScene: tool({
      description: "Append a new scene to the end of this chapter, without touching what's already there. Requires user approval.",
      inputSchema: z.object({ sceneText: z.string() }),
      execute: async ({ sceneText }) => {
        const { newContents } = manuscriptTools.buildAppendScene(projectDir, chapterId, sceneText);
        manuscriptTools.writeChapter(projectDir, chapterId, newContents);
        return `Scene appended to "${chapterId}" (${manuscriptTools.wordCount(newContents)} words total).`;
      },
    }),
  };
}

/**
 * Runs a bounded sub-agent whose only job is drafting/revising one chapter. Unlike the outer
 * loop's tools, this gets its own tailored system prompt (skill instructions, style guide, beats,
 * current content — no unrelated chat history, no full 20-tool schema list) and a much smaller
 * toolset. The actual write still goes through the same approval flow as everything else, via the
 * shared `onApprovalRequest` callback — so from the writer's side it looks identical to any other
 * proposed edit, even though it's a nested, separate conversation under the hood.
 */
export async function runDraftChapterAgent(deps: DraftChapterAgentDeps, chapterId: string, brief: string): Promise<string> {
  const systemPrompt = buildDraftChapterSystemPrompt({ projectDir: deps.projectDir, chapterId, brief });
  const tools = buildDraftChapterAgentTools(deps.model, deps.projectDir, chapterId);
  const messages: ModelMessage[] = [
    { role: "user", content: `Draft or revise chapter "${chapterId}" per the task above.` },
  ];

  const result = await runAgenticLoop({
    model: deps.model,
    systemPrompt,
    tools,
    toolApproval: { writeChapter: "user-approval", appendScene: "user-approval" },
    messages,
    onApprovalRequest: deps.onApprovalRequest,
    onTextDelta: deps.onTextDelta,
    onToolCallStart: deps.onToolCallStart,
    buildApprovalDescription: (toolName, input) => describeChapterDiff(deps.projectDir, chapterId, toolName, input),
    maxRounds: 10,
  });

  return result.text || `Chapter "${chapterId}" processed.`;
}
