import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import { buildTools, shouldAutoRejectApproval, type SkillGuardState } from "../src/agent/loop.js";
import { initProject } from "../src/project/init.js";

const noopDeps = (projectDir: string, extra: Partial<Parameters<typeof buildTools>[0]> = {}) => ({
  model: {} as never,
  projectDir,
  project: { title: "Test", autoAcceptEdits: false, autoExtractContinuity: true },
  onApprovalRequest: async () => ({ approved: true }),
  ...extra,
});

/** A model that just streams back a plain text reply, no tool calls. */
function textOnlyModel(text: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "1" },
        { type: "text-delta" as const, id: "1", delta: text },
        { type: "text-end" as const, id: "1" },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 3, text: 3, reasoning: undefined },
          },
        },
      ]),
    }),
  });
}

describe("draft-before-write guard", () => {
  it("auto-rejects updateOutline before draftOutline has been called, and leaves unrelated tools alone", () => {
    const guard: SkillGuardState = { calledTools: new Set() };
    expect(shouldAutoRejectApproval("updateOutline", guard)).toBe(true);
    expect(shouldAutoRejectApproval("updateBeats", guard)).toBe(false);

    guard.calledTools.add("draftOutline");
    expect(shouldAutoRejectApproval("updateOutline", guard)).toBe(false);
  });

  it("auto-rejects upsertCharacter before draftCharacter has been called", () => {
    const guard: SkillGuardState = { calledTools: new Set() };
    expect(shouldAutoRejectApproval("upsertCharacter", guard)).toBe(true);

    guard.calledTools.add("draftCharacter");
    expect(shouldAutoRejectApproval("upsertCharacter", guard)).toBe(false);
  });

  it("tracks each prerequisite independently", () => {
    const guard: SkillGuardState = { calledTools: new Set() };
    guard.calledTools.add("draftOutline");
    expect(shouldAutoRejectApproval("updateOutline", guard)).toBe(false);
    expect(shouldAutoRejectApproval("upsertCharacter", guard)).toBe(true);
  });

  it("refuses to write the outline until draftOutline has run this turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
    try {
      initProject(dir, "The Salt Road");
      const guard: SkillGuardState = { calledTools: new Set() };
      const tools = buildTools(noopDeps(dir), guard);

      await expect(tools.updateOutline.execute!({ contents: "garbage" }, {} as never)).rejects.toThrow(
        /Call draftOutline first/,
      );

      await tools.draftOutline.execute!({}, {} as never);
      await expect(tools.updateOutline.execute!({ contents: "# Outline" }, {} as never)).resolves.toBe(
        "Outline updated.",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to write a character until draftCharacter has run this turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
    try {
      initProject(dir, "The Salt Road");
      const guard: SkillGuardState = { calledTools: new Set() };
      const tools = buildTools(noopDeps(dir), guard);

      await expect(tools.upsertCharacter.execute!({ name: "Mira Solenne" }, {} as never)).rejects.toThrow(
        /Call draftCharacter first/,
      );

      await tools.draftCharacter.execute!({}, {} as never);
      const result = await tools.upsertCharacter.execute!({ name: "Mira Solenne" }, {} as never);
      expect(result).toContain("Mira Solenne");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("notifies onSkillUsed when draftOutline or draftCharacter is called", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
    try {
      initProject(dir, "The Salt Road");
      const used: Array<{ id: string; name: string }> = [];
      const guard: SkillGuardState = { calledTools: new Set() };
      const tools = buildTools(noopDeps(dir, { onSkillUsed: (skill) => used.push(skill) }), guard);

      await tools.draftOutline.execute!({}, {} as never);
      await tools.draftCharacter.execute!({}, {} as never);
      expect(used).toEqual([
        { id: "draft-outline", name: "draft-outline" },
        { id: "draft-character", name: "draft-character" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("draftChapter delegates to the chapter sub-agent", () => {
  it("notifies onSubAgentStarted (not onSkillUsed) and returns the sub-agent's own reply, without writing anything for a text-only response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
    try {
      initProject(dir, "The Salt Road");
      const skillsUsed: Array<{ id: string; name: string }> = [];
      const subAgentsStarted: Array<{ id: string; name: string; detail?: string }> = [];
      const guard: SkillGuardState = { calledTools: new Set() };
      const model = textOnlyModel("I have a question before drafting: who is the POV character?");
      const tools = buildTools(
        noopDeps(dir, {
          model,
          onSkillUsed: (skill) => skillsUsed.push(skill),
          onSubAgentStarted: (subAgent) => subAgentsStarted.push(subAgent),
        }),
        guard,
      );

      const result = await tools.draftChapter.execute!({ chapterId: "ch01", brief: "Open the story." }, {} as never);

      expect(skillsUsed).toEqual([]);
      expect(subAgentsStarted).toEqual([{ id: "draft-chapter", name: "draft-chapter", detail: "ch01" }]);
      expect(result).toBe("I have a question before drafting: who is the POV character?");
      expect(() => readFileSync(join(dir, "manuscript", "ch01.md"))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not forward the sub-agent's own text into the outer onTextDelta stream", async () => {
    // The sub-agent's narration reaches the outer model as its tool result, not the live UI
    // stream — otherwise it flashes on screen during streaming and then vanishes once the turn
    // ends, since the committed log entry only keeps the outer loop's own final text.
    const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
    try {
      initProject(dir, "The Salt Road");
      const deltas: string[] = [];
      const guard: SkillGuardState = { calledTools: new Set() };
      const model = textOnlyModel("I have written the opening scene.");
      const tools = buildTools(
        noopDeps(dir, { model, onTextDelta: (delta) => deltas.push(delta) }),
        guard,
      );

      await tools.draftChapter.execute!({ chapterId: "ch01", brief: "Open the story." }, {} as never);

      expect(deltas).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
