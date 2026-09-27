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
