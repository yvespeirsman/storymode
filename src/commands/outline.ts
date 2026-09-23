import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Command } from "commander";
import { beatsPath, listBeatChapters, readBeats, readOutline } from "../tools/outlineTools.js";

function openInEditor(absPath: string) {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
  spawnSync(editor, [absPath], { stdio: "inherit" });
}

export function registerOutlineCommand(program: Command, getProjectDir: () => string) {
  const outline = program.command("outline").description("View and edit the plot outline and scene beats");

  outline
    .command("show")
    .description("Print the top-level outline and list of chapters with beat sheets")
    .action(() => {
      const projectDir = getProjectDir();
      const text = readOutline(projectDir);
      console.log(text.trim() || "(outline is empty)");
      const chapters = listBeatChapters(projectDir);
      if (chapters.length > 0) {
        console.log("\nBeat sheets:");
        for (const id of chapters) console.log(`  - ${id}`);
      }
    });

  outline
    .command("edit")
    .description("Open the top-level outline in $EDITOR")
    .action(() => {
      const projectDir = getProjectDir();
      openInEditor(join(projectDir, ".storymode", "outline", "outline.md"));
    });

  outline
    .command("beats <chapterId>")
    .description("Show or edit the scene beat sheet for a chapter")
    .option("-e, --edit", "Open the beat sheet in $EDITOR")
    .action((chapterId: string, opts: { edit?: boolean }) => {
      const projectDir = getProjectDir();
      if (opts.edit) {
        openInEditor(join(projectDir, beatsPath(chapterId)));
        return;
      }
      console.log(readBeats(projectDir, chapterId).trim() || `(no beats recorded yet for "${chapterId}")`);
    });
}
