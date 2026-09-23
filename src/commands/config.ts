import { Command } from "commander";
import { globalConfigPath, loadGlobalConfig, saveGlobalConfig } from "../project/config.js";
import { providerIdSchema } from "../project/schema.js";

export function registerConfigCommand(program: Command) {
  const config = program.command("config").description("Manage global StoryMode configuration");

  config
    .command("show")
    .description("Print the resolved global config (API keys redacted)")
    .action(() => {
      const global = loadGlobalConfig();
      console.log(`Config file: ${globalConfigPath()}`);
      console.log(`Default provider: ${global.defaultProvider}`);
      console.log(`Default model: ${global.defaultModel}`);
      console.log("API keys set for:", Object.keys(global.apiKeys).join(", ") || "(none)");
    });

  config
    .command("set-key <provider> <apiKey>")
    .description("Store an API key for a provider (anthropic|openai)")
    .action((providerRaw: string, apiKey: string) => {
      const provider = providerIdSchema.parse(providerRaw);
      const global = loadGlobalConfig();
      global.apiKeys[provider] = apiKey;
      saveGlobalConfig(global);
      console.log(`Saved API key for ${provider} to ${globalConfigPath()}`);
    });

  config
    .command("set-default <provider> <model>")
    .description("Set the default provider and model")
    .action((providerRaw: string, model: string) => {
      const provider = providerIdSchema.parse(providerRaw);
      const global = loadGlobalConfig();
      global.defaultProvider = provider;
      global.defaultModel = model;
      saveGlobalConfig(global);
      console.log(`Default provider/model set to ${provider}/${model}`);
    });
}
