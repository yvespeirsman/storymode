import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { listChapters, readChapter, wordCount } from "../tools/manuscriptTools.js";
import { loadProjectConfig } from "../project/config.js";

export function registerExportCommand(program: Command, getProjectDir: () => string) {
  program
    .command("export")
    .description("Compile the manuscript into a single markdown document")
    .option("-o, --out <path>", "Output file path", "manuscript-export.md")
    .action((opts: { out: string }) => {
      const projectDir = getProjectDir();
      const project = loadProjectConfig(projectDir);
      const chapters = listChapters(projectDir);
      if (chapters.length === 0) {
        console.log("No chapters found in manuscript/.");
        return;
      }

      let total = 0;
      const parts = [`# ${project.title}\n`];
      for (const id of chapters) {
        const text = readChapter(projectDir, id).trim();
        total += wordCount(text);
        parts.push(`\n\n---\n\n${text}`);
      }

      const outPath = join(projectDir, opts.out);
      writeFileSync(outPath, parts.join(""), "utf8");
      console.log(`Exported ${chapters.length} chapter(s), ${total} words, to ${outPath}`);
    });
}
