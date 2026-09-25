import { describe, expect, it } from "vitest";
import { initProject } from "../src/project/init.js";
import { writeProjectFile } from "../src/tools/fileTools.js";
import { readSkill } from "../src/tools/skillTools.js";
import { withTempProject } from "./helpers.js";

describe("initProject", () => {
  it("copies the package's skill templates into the new project", () => {
    withTempProject((dir) => {
      initProject(dir, "The Salt Road");

      const skill = readSkill(dir, "draft-outline");
      expect(skill).not.toBeNull();
      expect(skill?.name).toBe("draft-outline");
      expect(skill?.description.toLowerCase()).toContain("outline");
      expect(skill?.instructions.toLowerCase()).toContain("chapter level");
    });
  });

  it("doesn't overwrite a skill file the user has already customized", () => {
    withTempProject((dir) => {
      initProject(dir, "The Salt Road");
      const skillPath = ".storymode/skills/draft-outline/SKILL.md";
      const before = readSkill(dir, "draft-outline");

      // Simulate a hand edit, then re-run init.
      writeProjectFile(dir, skillPath, "---\nname: draft-outline\ndescription: Custom.\n---\n\nCustom instructions.");

      initProject(dir, "The Salt Road");
      const after = readSkill(dir, "draft-outline");
      expect(after?.description).toBe("Custom.");
      expect(after?.description).not.toBe(before?.description);
    });
  });
});
