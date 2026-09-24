import { Command } from "commander";
import { resolveLanguageModel } from "./agent/providers.js";
import { createSession, loadLatestSession, saveSession } from "./agent/session.js";
import { registerCharacterCommand } from "./commands/character.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerContinuityCommand } from "./commands/continuity.js";
import { registerExportCommand } from "./commands/export.js";
import { registerOutlineCommand } from "./commands/outline.js";
import { registerStyleCommand } from "./commands/style.js";
import { resolveConfig } from "./project/config.js";
import { initProject } from "./project/init.js";
import { startTui } from "./tui/index.js";

const getProjectDir = () => process.cwd();

async function launchTui(opts: { resume: boolean }) {
  const projectDir = getProjectDir();

  let config;
  try {
    config = resolveConfig(projectDir);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error('Run "storymode init" first if this is a new project, then "storymode config set-key ..."');
    process.exitCode = 1;
    return;
  }

  const model = resolveLanguageModel(config);
  const session = (opts.resume && loadLatestSession(projectDir)) || createSession(projectDir);
  saveSession(projectDir, session);

  await startTui({ model, projectDir, project: config.project }, session, projectDir, `${config.provider}/${config.model}`);
}

async function main() {
  const program = new Command();
  program.name("storymode").description("A terminal, agentic writing harness for fiction.").version("0.1.0");

  program
    .command("init")
    .description("Scaffold a new story project in the current directory")
    .option("-t, --title <title>", "Story title", "Untitled Story")
    .action((opts: { title: string }) => {
      const result = initProject(getProjectDir(), opts.title);
      for (const path of result.created) console.log(`created ${path}`);
      for (const path of result.skipped) console.log(`skipped ${path} (already exists)`);
      console.log('\nRun "storymode" to start writing.');
    });

  program
    .command("continue")
    .description("Resume the most recent agent session in this project")
    .action(async () => {
      await launchTui({ resume: true });
    });

  registerCharacterCommand(program, getProjectDir);
  registerOutlineCommand(program, getProjectDir);
  registerStyleCommand(program, getProjectDir);
  registerContinuityCommand(program, getProjectDir);
  registerExportCommand(program, getProjectDir);
  registerConfigCommand(program);

  if (process.argv.slice(2).length === 0) {
    await launchTui({ resume: false });
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
