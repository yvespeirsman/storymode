import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type GlobalConfig,
  type ProjectConfig,
  type ProviderId,
  globalConfigSchema,
  projectConfigSchema,
} from "./schema.js";

const ENV_KEY_BY_PROVIDER: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function globalConfigDir(): string {
  return process.env.STORYMODE_CONFIG_DIR ?? join(homedir(), ".config", "storymode");
}

export function globalConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

export function loadGlobalConfig(): GlobalConfig {
  const path = globalConfigPath();
  if (!existsSync(path)) {
    return globalConfigSchema.parse({});
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return globalConfigSchema.parse(raw);
}

export function saveGlobalConfig(config: GlobalConfig): void {
  mkdirSync(globalConfigDir(), { recursive: true });
  writeFileSync(globalConfigPath(), JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function projectConfigPath(projectDir: string): string {
  return join(projectDir, ".storymode", "config.json");
}

export function loadProjectConfig(projectDir: string): ProjectConfig {
  const path = projectConfigPath(projectDir);
  if (!existsSync(path)) {
    return projectConfigSchema.parse({});
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return projectConfigSchema.parse(raw);
}

export function saveProjectConfig(projectDir: string, config: ProjectConfig): void {
  mkdirSync(join(projectDir, ".storymode"), { recursive: true });
  writeFileSync(projectConfigPath(projectDir), JSON.stringify(config, null, 2) + "\n", "utf8");
}

export interface ResolvedConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  project: ProjectConfig;
}

/**
 * Resolution order for API keys: environment variable > project config > global config.
 * Env vars win so CI/one-off overrides never require editing a file.
 */
export function resolveConfig(projectDir: string): ResolvedConfig {
  const global = loadGlobalConfig();
  const project = loadProjectConfig(projectDir);

  const provider = project.provider ?? global.defaultProvider;
  const model = project.model ?? global.defaultModel;

  const apiKey = process.env[ENV_KEY_BY_PROVIDER[provider]] ?? global.apiKeys[provider];
  if (!apiKey) {
    throw new Error(
      `No API key found for provider "${provider}". Set ${ENV_KEY_BY_PROVIDER[provider]} or run \`storymode config\`.`,
    );
  }

  return { provider, model, apiKey, project };
}
