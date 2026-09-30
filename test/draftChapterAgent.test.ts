import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  buildDraftChapterSystemPrompt,
  describeChapterDiff,
  findPreviousChapterId,
  runDraftChapterAgent,
} from "../src/agent/draftChapterAgent.js";
import { updateOutline } from "../src/tools/outlineTools.js";
import { readChapter, writeChapter } from "../src/tools/manuscriptTools.js";
import { updateStyleGuide } from "../src/tools/styleTools.js";
import { initProject } from "../src/project/init.js";

function withDir<T>(fn: (dir: string) => T | Promise<T>) {
  const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const USAGE = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
};

/**
 * A model that proposes a single writeChapter tool call on its first invocation, then replies
 * with plain text on every subsequent invocation. Real models naturally stop re-proposing a call
 * once they've seen its result in the conversation; a purely static mock would instead re-propose
 * the same call forever (the AI SDK calls the model again after a tool executes, per stepCountIs),
 * so this mimics that "don't repeat yourself" behavior via a simple call counter.
 */
function writeChapterModel(contents: string) {
  let callCount = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start" as const, warnings: [] },
            { type: "tool-input-start" as const, id: "call1", toolName: "writeChapter" },
            { type: "tool-input-delta" as const, id: "call1", delta: JSON.stringify({ contents }) },
            { type: "tool-input-end" as const, id: "call1" },
            {
              type: "tool-call" as const,
              toolCallId: "call1",
              toolName: "writeChapter",
              input: JSON.stringify({ contents }),
            },
            { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage: USAGE },
          ]),
        };
      }
      return {
        stream: convertArrayToReadableStream([
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "done" },
          { type: "text-delta" as const, id: "done", delta: "Noted." },
          { type: "text-end" as const, id: "done" },
          { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage: USAGE },
        ]),
      };
    },
  });
}

describe("buildDraftChapterSystemPrompt", () => {
  it("bundles the skill instructions, style guide, beats, and current chapter", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      updateStyleGuide(dir, "Close third person, past tense.");
      updateOutline(dir, "# Outline\n\n## Act 1\n\n### ch01 — Opening\nMira arrives.");
      writeChapter(dir, "ch01", "Existing draft text.");

      const prompt = buildDraftChapterSystemPrompt({ projectDir: dir, chapterId: "ch01", brief: "Open with Mira." });

      expect(prompt).toContain("Open with Mira.");
      expect(prompt).toContain("Close third person, past tense.");
      expect(prompt).toContain("Existing draft text.");
      expect(prompt).toContain("Show, don't tell"); // from the draft-chapter skill's instructions
    });
  });

  it("includes the previous chapter's content for continuity when drafting the next one", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      writeChapter(dir, "ch01", "Mira arrived at the harbor at dawn.");

      const prompt = buildDraftChapterSystemPrompt({ projectDir: dir, chapterId: "ch02", brief: "Continue the story." });

      expect(prompt).toContain("Previous chapter (ch01)");
      expect(prompt).toContain("Mira arrived at the harbor at dawn.");
    });
  });

  it("omits the previous-chapter section for the first chapter", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");

      const prompt = buildDraftChapterSystemPrompt({ projectDir: dir, chapterId: "ch01", brief: "Open the story." });

      expect(prompt).not.toContain("Previous chapter");
    });
  });

  it("does not treat a later chapter as the previous one when revising an earlier one", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      writeChapter(dir, "ch01", "Original ch01 text.");
      writeChapter(dir, "ch02", "Original ch02 text.");

      const prompt = buildDraftChapterSystemPrompt({ projectDir: dir, chapterId: "ch01", brief: "Revise the opening." });

      expect(prompt).not.toContain("Previous chapter");
    });
  });
});

describe("findPreviousChapterId", () => {
  it("returns null when no chapters exist yet", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      expect(findPreviousChapterId(dir, "ch01")).toBeNull();
    });
  });

  it("finds the immediately preceding chapter for a brand-new chapter", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      writeChapter(dir, "ch01", "...");
      writeChapter(dir, "ch02", "...");
      expect(findPreviousChapterId(dir, "ch03")).toBe("ch02");
    });
  });

  it("finds the immediately preceding chapter when revising an existing one", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      writeChapter(dir, "ch01", "...");
      writeChapter(dir, "ch02", "...");
      writeChapter(dir, "ch03", "...");
      expect(findPreviousChapterId(dir, "ch02")).toBe("ch01");
    });
  });
});

describe("describeChapterDiff", () => {
  it("summarizes a new chapter by word count and points at the file, instead of inlining the text", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      const diff = describeChapterDiff(dir, "ch01", "writeChapter", { contents: "New text here now." });
      expect(diff?.description).toBe('Write chapter "ch01"');
      expect(diff?.diffText).not.toContain("New text here now.");
      expect(diff?.diffText).toContain("manuscript/ch01.md");
      expect(diff?.diffText).toContain("4 word(s)");
    });
  });

  it("summarizes a revision as an old → new word count delta", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      writeChapter(dir, "ch01", "One two three.");
      const diff = describeChapterDiff(dir, "ch01", "writeChapter", { contents: "One two three four five." });
      expect(diff?.diffText).toContain("3 → 5 word(s) (+2)");
      expect(diff?.diffText).toContain("manuscript/ch01.md");
    });
  });

  it("returns null for an unrecognized tool", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      expect(describeChapterDiff(dir, "ch01", "someOtherTool", {})).toBeNull();
    });
  });
});

describe("runDraftChapterAgent", () => {
  it("writes the chapter once the human approves", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      const model = writeChapterModel("Mira stepped onto the dock.");
      let sawApproval = false;

      const result = await runDraftChapterAgent(
        {
          model,
          projectDir: dir,
          onApprovalRequest: async (approval) => {
            sawApproval = true;
            expect(approval.toolName).toBe("writeChapter");
            expect(approval.diffText).not.toContain("Mira stepped onto the dock.");
            expect(approval.diffText).toContain("manuscript/ch01.md");
            return { approved: true };
          },
        },
        "ch01",
        "Open the story with Mira arriving at the harbor.",
      );

      expect(sawApproval).toBe(true);
      expect(readChapter(dir, "ch01")).toBe("Mira stepped onto the dock.");
      // The sub-agent's own closing reply (from the mock's second call), not the raw tool result.
      expect(result).toBe("Noted.");
    });
  });

  it("does not write anything if the human rejects the draft", async () => {
    await withDir(async (dir) => {
      initProject(dir, "The Salt Road");
      const model = writeChapterModel("Mira stepped onto the dock.");

      await runDraftChapterAgent(
        {
          model,
          projectDir: dir,
          onApprovalRequest: async () => ({ approved: false, reason: "Not yet — let's discuss the opening first." }),
        },
        "ch01",
        "Open the story with Mira arriving at the harbor.",
      );

      expect(readChapter(dir, "ch01")).toBe("");
    });
  });
});
