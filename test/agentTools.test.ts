import { describe, expect, it } from "vitest";
import { agentPath, readAgent } from "../src/tools/agentTools.js";
import { writeProjectFile } from "../src/tools/fileTools.js";
import { withTempProject } from "./helpers.js";

describe("agentTools", () => {
  it("returns null when the agent file doesn't exist", () => {
    withTempProject((dir) => {
      expect(readAgent(dir, "draft-chapter")).toBeNull();
    });
  });

  it("reads an agent's frontmatter and instructions", () => {
    withTempProject((dir) => {
      writeProjectFile(
        dir,
        agentPath("draft-chapter"),
        `---
name: draft-chapter
description: Draft or revise a chapter.
---

Show, don't tell.
`,
      );

      const agent = readAgent(dir, "draft-chapter");
      expect(agent).not.toBeNull();
      expect(agent?.name).toBe("draft-chapter");
      expect(agent?.description).toBe("Draft or revise a chapter.");
      expect(agent?.instructions).toBe("Show, don't tell.");
    });
  });
});
