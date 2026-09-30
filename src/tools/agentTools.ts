import { parseFrontmatter } from "../project/frontmatter.js";
import { agentFrontmatterSchema, type AgentFrontmatter } from "../project/schema.js";
import { projectFileExists, readProjectFile } from "./fileTools.js";

const AGENTS_DIR = "storymode/agents";

export interface AgentDefinition {
  name: string;
  description: string;
  instructions: string;
}

export function agentPath(id: string): string {
  return `${AGENTS_DIR}/${id}/AGENT.md`;
}

/**
 * Reads a sub-agent definition: YAML frontmatter (name, description — the description of the
 * tool the main agent calls to delegate to it) plus a markdown body (the sub-agent's own
 * instructions, placed in its system prompt). Returns null if the file hasn't been scaffolded.
 */
export function readAgent(projectDir: string, id: string): AgentDefinition | null {
  const path = agentPath(id);
  if (!projectFileExists(projectDir, path)) return null;
  const source = readProjectFile(projectDir, path);
  const { data, body } = parseFrontmatter<AgentFrontmatter>(source);
  const frontmatter = agentFrontmatterSchema.parse(data);
  return { name: frontmatter.name, description: frontmatter.description, instructions: body.trim() };
}
