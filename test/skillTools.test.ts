import { describe, expect, it } from "vitest";
import { writeProjectFile } from "../src/tools/fileTools.js";
import { readSkill, skillPath } from "../src/tools/skillTools.js";
import { withTempProject } from "./helpers.js";

describe("skillTools", () => {
  it("returns null when the skill file doesn't exist", () => {
    withTempProject((dir) => {
      expect(readSkill(dir, "draft-outline")).toBeNull();
    });
  });

  it("reads a skill's frontmatter and instructions", () => {
    withTempProject((dir) => {
      writeProjectFile(
        dir,
        skillPath("draft-outline"),
        `---
name: draft-outline
description: Draft or revise the outline.
---

Work at the chapter level.
`,
      );

      const skill = readSkill(dir, "draft-outline");
      expect(skill).not.toBeNull();
      expect(skill?.name).toBe("draft-outline");
      expect(skill?.description).toBe("Draft or revise the outline.");
      expect(skill?.instructions).toBe("Work at the chapter level.");
    });
  });
});
