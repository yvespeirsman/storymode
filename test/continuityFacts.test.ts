import { describe, expect, it } from "vitest";
import { appendFacts, readFacts } from "../src/tools/continuityTools.js";
import { withTempProject } from "./helpers.js";

describe("continuity fact storage", () => {
  it("appends and reads back facts as JSONL", () => {
    withTempProject((dir) => {
      expect(readFacts(dir)).toEqual([]);

      appendFacts(dir, [
        { id: "1", chapter: "ch01", subject: "Mira", fact: "Mira has a scar on her left hand.", extractedAt: "t0" },
      ]);
      appendFacts(dir, [
        { id: "2", chapter: "ch02", subject: "Mira", fact: "Mira is left-handed.", extractedAt: "t1" },
      ]);

      const facts = readFacts(dir);
      expect(facts).toHaveLength(2);
      expect(facts.map((f) => f.id)).toEqual(["1", "2"]);
    });
  });
});
