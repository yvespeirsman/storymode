import { describe, expect, it } from "vitest";
import { buildAppendScene, listChapters, readChapter, wordCount, writeChapter } from "../src/tools/manuscriptTools.js";
import { listBeatChapters, readBeats, readOutline, updateBeats, updateOutline } from "../src/tools/outlineTools.js";
import { readStyleGuide, updateStyleGuide } from "../src/tools/styleTools.js";
import { withTempProject } from "./helpers.js";

describe("outlineTools", () => {
  it("round-trips the outline and per-chapter beats", () => {
    withTempProject((dir) => {
      expect(readOutline(dir)).toBe("");
      updateOutline(dir, "# Outline\n\nAct 1: the storm.");
      expect(readOutline(dir)).toContain("the storm");

      updateBeats(dir, "ch01", "- Mira arrives at the harbor");
      expect(readBeats(dir, "ch02")).toBe("");
      expect(listBeatChapters(dir)).toEqual(["ch01"]);
    });
  });
});

describe("styleTools", () => {
  it("round-trips the project-specific style guide", () => {
    withTempProject((dir) => {
      expect(readStyleGuide(dir)).toBe("");
      updateStyleGuide(dir, "## Description\nTerse, present tense.\n\n## Example passages\nThe tide came in fast.");
      expect(readStyleGuide(dir)).toContain("Terse, present tense.");
      expect(readStyleGuide(dir)).toContain("The tide came in fast.");
    });
  });
});

describe("manuscriptTools", () => {
  it("writes a chapter and counts words", () => {
    withTempProject((dir) => {
      writeChapter(dir, "ch01", "One two three.");
      expect(readChapter(dir, "ch01")).toBe("One two three.");
      expect(wordCount(readChapter(dir, "ch01"))).toBe(3);
      expect(listChapters(dir)).toEqual(["ch01"]);
    });
  });

  it("previews an appended scene without writing until applied", () => {
    withTempProject((dir) => {
      writeChapter(dir, "ch01", "First scene.");
      const preview = buildAppendScene(dir, "ch01", "Second scene.");
      expect(preview.oldContents).toBe("First scene.");
      expect(preview.newContents).toBe("First scene.\n\nSecond scene.\n");
      expect(readChapter(dir, "ch01")).toBe("First scene.");

      writeChapter(dir, "ch01", preview.newContents);
      expect(readChapter(dir, "ch01")).toBe("First scene.\n\nSecond scene.\n");
    });
  });
});
