import { describe, expect, it } from "vitest";
import {
  BibleEntryNotFoundError,
  buildCharacterUpsert,
  listCharacters,
  readCharacter,
  readLore,
  slugify,
  upsertCharacter,
} from "../src/tools/bibleTools.js";
import { writeProjectFile } from "../src/tools/fileTools.js";
import { withTempProject } from "./helpers.js";

describe("bibleTools", () => {
  it("slugifies character names", () => {
    expect(slugify("Mira Solenne")).toBe("mira-solenne");
    expect(slugify("  Dr. O'Brien!! ")).toBe("dr-o-brien");
  });

  it("creates a new character and reads it back", () => {
    withTempProject((dir) => {
      const result = upsertCharacter(dir, { name: "Mira Solenne", role: "protagonist", traits: ["stubborn"] });
      expect(result.slug).toBe("mira-solenne");

      const entry = readCharacter(dir, "mira-solenne");
      expect(entry.frontmatter.name).toBe("Mira Solenne");
      expect(entry.frontmatter.role).toBe("protagonist");
      expect(entry.frontmatter.traits).toEqual(["stubborn"]);
    });
  });

  it("merges partial updates onto an existing character", () => {
    withTempProject((dir) => {
      upsertCharacter(dir, { name: "Mira Solenne", role: "protagonist", traits: ["stubborn"] });
      upsertCharacter(dir, { name: "Mira Solenne", traits: ["stubborn", "quick-witted"] });

      const entry = readCharacter(dir, "mira-solenne");
      expect(entry.frontmatter.role).toBe("protagonist");
      expect(entry.frontmatter.traits).toEqual(["stubborn", "quick-witted"]);
    });
  });

  it("buildCharacterUpsert previews changes without writing", () => {
    withTempProject((dir) => {
      const preview = buildCharacterUpsert(dir, { name: "Mira Solenne" });
      expect(preview.oldContents).toBeNull();
      expect(listCharacters(dir)).toHaveLength(0);
    });
  });

  it("lists all characters", () => {
    withTempProject((dir) => {
      upsertCharacter(dir, { name: "Mira Solenne" });
      upsertCharacter(dir, { name: "Callum Reyes" });
      const names = listCharacters(dir).map((c) => c.frontmatter.name).sort();
      expect(names).toEqual(["Callum Reyes", "Mira Solenne"]);
    });
  });

  it("renames a character in place instead of creating a duplicate file", () => {
    withTempProject((dir) => {
      const created = upsertCharacter(dir, { name: "Mira Solenne", role: "protagonist" });

      const renamed = upsertCharacter(dir, { slug: created.slug, name: "Mira Okafor" });
      expect(renamed.slug).toBe("mira-solenne");
      expect(renamed.path).toBe(created.path);

      const all = listCharacters(dir);
      expect(all).toHaveLength(1);
      expect(all[0]?.frontmatter.name).toBe("Mira Okafor");
      expect(all[0]?.frontmatter.role).toBe("protagonist");
    });
  });

  it("throws when upserting an existing slug that doesn't exist", () => {
    withTempProject((dir) => {
      expect(() => upsertCharacter(dir, { slug: "no-such-character", name: "Someone" })).toThrow(
        BibleEntryNotFoundError,
      );
    });
  });

  it("reads lore, defaulting to empty when the file doesn't exist yet", () => {
    withTempProject((dir) => {
      expect(readLore(dir)).toBe("");
      writeProjectFile(dir, ".storymode/bible/lore.md", "# Lore\n\nThe tide god sleeps beneath the harbor.");
      expect(readLore(dir)).toContain("tide god");
    });
  });
});
