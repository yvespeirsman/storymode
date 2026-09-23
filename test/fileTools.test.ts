import { describe, expect, it } from "vitest";
import { PathEscapeError, listProjectFiles, readProjectFile, resolveInProject, writeProjectFile } from "../src/tools/fileTools.js";
import { withTempProject } from "./helpers.js";

describe("fileTools", () => {
  it("writes and reads a file scoped to the project", () => {
    withTempProject((dir) => {
      writeProjectFile(dir, "manuscript/ch01.md", "Once upon a time.");
      expect(readProjectFile(dir, "manuscript/ch01.md")).toBe("Once upon a time.");
    });
  });

  it("refuses to resolve paths that escape the project directory", () => {
    withTempProject((dir) => {
      expect(() => resolveInProject(dir, "../outside.md")).toThrow(PathEscapeError);
      expect(() => resolveInProject(dir, "/etc/passwd")).toThrow(PathEscapeError);
    });
  });

  it("lists files recursively", () => {
    withTempProject((dir) => {
      writeProjectFile(dir, "bible/characters/mira.md", "# Mira");
      writeProjectFile(dir, "bible/locations/harbor.md", "# Harbor");
      const entries = listProjectFiles(dir, "bible", { recursive: true }).map((e) => e.path).sort();
      expect(entries).toContain("bible/characters");
      expect(entries).toContain("bible/characters/mira.md");
      expect(entries).toContain("bible/locations/harbor.md");
    });
  });
});
