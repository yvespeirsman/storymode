import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Command } from "commander";
import { readStyleGuide } from "../tools/styleTools.js";

function openInEditor(absPath: string) {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
  spawnSync(editor, [absPath], { stdio: "inherit" });
}

export function registerStyleCommand(program: Command, getProjectDir: () => string) {
  const style = program.command("style").description("View and edit the project's style guide");

  style
    .command("show")
    .description("Print the style guide")
    .action(() => {
      const projectDir = getProjectDir();
      console.log(readStyleGuide(projectDir).trim() || "(style guide is empty)");
    });

  style
    .command("edit")
    .description("Open the style guide in $EDITOR")
    .action(() => {
      const projectDir = getProjectDir();
      openInEditor(join(projectDir, ".storymode", "style.md"));
    });
}
