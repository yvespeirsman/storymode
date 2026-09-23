import { Command } from "commander";
import { resolveLanguageModel } from "../agent/providers.js";
import { resolveConfig } from "../project/config.js";
import { checkConsistency, readFacts } from "../tools/continuityTools.js";
import { readChapter } from "../tools/manuscriptTools.js";

export function registerContinuityCommand(program: Command, getProjectDir: () => string) {
  const continuity = program.command("continuity").description("Check and inspect continuity facts");

  continuity
    .command("check <chapterId>")
    .description("Check a chapter against previously recorded continuity facts")
    .action(async (chapterId: string) => {
      const projectDir = getProjectDir();
      const text = readChapter(projectDir, chapterId);
      if (!text.trim()) {
        console.log(`Chapter "${chapterId}" is empty or does not exist.`);
        return;
      }
      const config = resolveConfig(projectDir);
      const model = resolveLanguageModel(config);
      const contradictions = await checkConsistency(model, projectDir, text);
      if (contradictions.length === 0) {
        console.log("No contradictions found.");
        return;
      }
      for (const c of contradictions) {
        console.log(`- [${c.subject}] ${c.issue}\n  known fact: ${c.existingFact}`);
      }
    });

  continuity
    .command("facts")
    .description("List all recorded continuity facts")
    .action(() => {
      const facts = readFacts(getProjectDir());
      if (facts.length === 0) {
        console.log("No continuity facts recorded yet.");
        return;
      }
      for (const f of facts) {
        console.log(`[${f.chapter}] ${f.subject}: ${f.fact}`);
      }
    });
}
