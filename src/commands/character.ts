import { Command } from "commander";
import { listCharacters, readCharacter, upsertCharacter } from "../tools/bibleTools.js";

export function registerCharacterCommand(program: Command, getProjectDir: () => string) {
  const character = program.command("character").description("Manage the character bible");

  character
    .command("add <name>")
    .description("Add or update a character")
    .option("-r, --role <role>", "Character's role in the story")
    .option("-t, --traits <traits>", "Comma-separated traits")
    .action((name: string, opts: { role?: string; traits?: string }) => {
      const result = upsertCharacter(getProjectDir(), {
        name,
        role: opts.role,
        traits: opts.traits ? opts.traits.split(",").map((t) => t.trim()) : undefined,
      });
      console.log(`Saved ${result.path}`);
    });

  character
    .command("list")
    .description("List all characters")
    .action(() => {
      const chars = listCharacters(getProjectDir());
      if (chars.length === 0) {
        console.log("No characters yet. Add one with `storymode character add \"Name\"`.");
        return;
      }
      for (const c of chars) {
        console.log(`${c.slug}\t${c.frontmatter.name}\t${c.frontmatter.role}`);
      }
    });

  character
    .command("show <slug>")
    .description("Show a character's full bible entry")
    .action((slug: string) => {
      const entry = readCharacter(getProjectDir(), slug);
      console.log(`# ${entry.frontmatter.name}`);
      console.log(`Role: ${entry.frontmatter.role}`);
      console.log(`Traits: ${entry.frontmatter.traits.join(", ")}`);
      console.log();
      console.log(entry.body.trim());
    });
}
