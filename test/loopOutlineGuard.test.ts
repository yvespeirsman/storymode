import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTools, shouldAutoRejectApproval, type OutlineGuardState } from "../src/agent/loop.js";
import { initProject } from "../src/project/init.js";

const noopDeps = (projectDir: string, extra: Partial<Parameters<typeof buildTools>[0]> = {}) => ({
  model: {} as never,
  projectDir,
  project: { title: "Test", autoAcceptEdits: false, autoExtractContinuity: true },
  onApprovalRequest: async () => ({ approved: true }),
  ...extra,
});

describe("outline draft-before-write guard", () => {
  it("auto-rejects an updateOutline approval request before draftOutline has been called", () => {
    const guard: OutlineGuardState = { draftOutlineCalled: false };
    expect(shouldAutoRejectApproval("updateOutline", guard)).toBe(true);
    expect(shouldAutoRejectApproval("updateBeats", guard)).toBe(false);

    guard.draftOutlineCalled = true;
    expect(shouldAutoRejectApproval("updateOutline", guard)).toBe(false);
  });

  it("refuses to write the outline until draftOutline has run this turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
    try {
      initProject(dir, "The Salt Road");
      const guard: OutlineGuardState = { draftOutlineCalled: false };
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

  it("notifies onSkillUsed when draftOutline is called", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
    try {
      initProject(dir, "The Salt Road");
      const used: Array<{ id: string; name: string }> = [];
      const guard: OutlineGuardState = { draftOutlineCalled: false };
      const tools = buildTools(noopDeps(dir, { onSkillUsed: (skill) => used.push(skill) }), guard);

      await tools.draftOutline.execute!({}, {} as never);
      expect(used).toEqual([{ id: "draft-outline", name: "draft-outline" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
