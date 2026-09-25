import { parseFrontmatter } from "../project/frontmatter.js";
import { skillFrontmatterSchema } from "../project/schema.js";
import { projectFileExists, readProjectFile } from "./fileTools.js";

const SKILLS_DIR = ".storymode/skills";

export interface Skill {
  name: string;
  description: string;
  instructions: string;
}

export function skillPath(id: string): string {
  return `${SKILLS_DIR}/${id}/SKILL.md`;
}

/**
 * Reads a skill file: YAML frontmatter (name, description — the tool-selection prompt, sent to
 * the model every turn) plus a markdown body (the task instructions, delivered only when the
 * matching tool is actually called). Returns null if the skill hasn't been scaffolded/written.
 */
export function readSkill(projectDir: string, id: string): Skill | null {
  const path = skillPath(id);
  if (!projectFileExists(projectDir, path)) return null;
  const source = readProjectFile(projectDir, path);
  const { data, body } = parseFrontmatter<{ name: string; description: string }>(source);
  const frontmatter = skillFrontmatterSchema.parse(data);
  return { name: frontmatter.name, description: frontmatter.description, instructions: body.trim() };
}
