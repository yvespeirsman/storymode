import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("auto-rejects writeChapter and appendScene before draftChapter has been called", () => {
    const guard: SkillGuardState = { calledTools: new Set() };
    expect(shouldAutoRejectApproval("writeChapter", guard)).toBe(true);
    expect(shouldAutoRejectApproval("appendScene", guard)).toBe(true);

    guard.calledTools.add("draftChapter");
    expect(shouldAutoRejectApproval("writeChapter", guard)).toBe(false);
    expect(shouldAutoRejectApproval("appendScene", guard)).toBe(false);
  });

  it("tracks each prerequisite independently", () => {
    const guard: SkillGuardState = { calledTools: new Set() };
    guard.calledTools.add("draftOutline");
    expect(shouldAutoRejectApproval("updateOutline", guard)).toBe(false);
    expect(shouldAutoRejectApproval("upsertCharacter", guard)).toBe(true);
    expect(shouldAutoRejectApproval("writeChapter", guard)).toBe(true);
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

  it("refuses to write a chapter or append a scene until draftChapter has run this turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
    try {
      initProject(dir, "The Salt Road");
      const guard: SkillGuardState = { calledTools: new Set() };
      const tools = buildTools(noopDeps(dir), guard);

      await expect(
        tools.writeChapter.execute!({ chapterId: "ch01", contents: "garbage" }, {} as never),
      ).rejects.toThrow(/Call draftChapter first/);
      await expect(
        tools.appendScene.execute!({ chapterId: "ch01", sceneText: "garbage" }, {} as never),
      ).rejects.toThrow(/Call draftChapter first/);

      const draft = await tools.draftChapter.execute!({ chapterId: "ch01" }, {} as never);
      expect(draft).toHaveProperty("styleGuide");
      expect(draft).toHaveProperty("beats");
      expect(draft).toHaveProperty("currentChapter");

      await expect(
        tools.writeChapter.execute!({ chapterId: "ch01", contents: "Real prose." }, {} as never),
      ).resolves.toContain("written");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("notifies onSkillUsed when draftOutline, draftCharacter, or draftChapter is called", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
    try {
      initProject(dir, "The Salt Road");
      const used: Array<{ id: string; name: string }> = [];
      const guard: SkillGuardState = { calledTools: new Set() };
      const tools = buildTools(noopDeps(dir, { onSkillUsed: (skill) => used.push(skill) }), guard);

      await tools.draftOutline.execute!({}, {} as never);
      await tools.draftCharacter.execute!({}, {} as never);
      await tools.draftChapter.execute!({ chapterId: "ch01" }, {} as never);
      expect(used).toEqual([
        { id: "draft-outline", name: "draft-outline" },
        { id: "draft-character", name: "draft-character" },
        { id: "draft-chapter", name: "draft-chapter" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
