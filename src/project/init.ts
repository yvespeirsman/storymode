import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveProjectConfig } from "./config.js";
import { projectConfigSchema } from "./schema.js";

/**
 * Skills ship as plain SKILL.md files under the package's own `skills/` directory (sibling to
 * `src/`/`dist/`) so they're easy to read and edit directly, rather than as string constants in
 * source. `init` copies each one into the new project. Walking up to the nearest package.json
 * finds this directory correctly whether running from source (`src/project/init.ts`) or from the
 * bundled build (`dist/cli.js`), since both sit at a different depth under the package root.
 */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Could not locate the package root (no package.json found).");
    dir = parent;
  }
  return dir;
}

const SKILLS_TEMPLATE_DIR = join(findPackageRoot(dirname(fileURLToPath(import.meta.url))), "skills");

const OUTLINE_TEMPLATE = `# Outline

## Premise

_What is this story about, in two or three sentences?_

## Acts

### Act 1

### Act 2

### Act 3
`;

const LORE_TEMPLATE = `# Lore

World rules, glossary, and timeline go here. The agent reads this before
drafting scenes and should keep it updated as canon is established.
`;

const STYLE_TEMPLATE = `# Style guide

The agent reads this before drafting or revising prose and tries to match
it. You can describe the style in prose, paste example passages to
imitate, or both.

## Description

_Point of view, tense, sentence rhythm, tone, what to avoid..._

## Example passages

_Paste a passage or two — yours or a reference author's — that capture the_
_voice you're going for._
`;

const GITIGNORE = `node_modules/
.storymode/session/
`;

export interface InitResult {
  created: string[];
  skipped: string[];
}

/** Copies every `skills/<name>/SKILL.md` shipped with the package into the new project. */
function copySkillTemplates(projectDir: string, created: string[], skipped: string[]) {
  if (!existsSync(SKILLS_TEMPLATE_DIR)) return;
  for (const entry of readdirSync(SKILLS_TEMPLATE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const srcPath = join(SKILLS_TEMPLATE_DIR, entry.name, "SKILL.md");
    if (!existsSync(srcPath)) continue;

    const destPath = join(projectDir, ".storymode", "skills", entry.name, "SKILL.md");
    mkdirSync(dirname(destPath), { recursive: true });
    if (existsSync(destPath)) {
      skipped.push(destPath);
      continue;
    }
    writeFileSync(destPath, readFileSync(srcPath, "utf8"), "utf8");
    created.push(destPath);
  }
}

export function initProject(projectDir: string, title: string): InitResult {
  const created: string[] = [];
  const skipped: string[] = [];

  const dirs = [
    join(projectDir, ".storymode", "bible", "characters"),
    join(projectDir, ".storymode", "bible", "locations"),
    join(projectDir, ".storymode", "outline", "beats"),
    join(projectDir, ".storymode", "continuity"),
    join(projectDir, ".storymode", "session"),
    join(projectDir, "manuscript"),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  const files: Array<[string, string]> = [
    [join(projectDir, ".storymode", "outline", "outline.md"), OUTLINE_TEMPLATE],
    [join(projectDir, ".storymode", "bible", "lore.md"), LORE_TEMPLATE],
    [join(projectDir, ".storymode", "style.md"), STYLE_TEMPLATE],
    [join(projectDir, ".storymode", "continuity", "facts.jsonl"), ""],
    [join(projectDir, ".gitignore"), GITIGNORE],
  ];

  for (const [path, contents] of files) {
    if (existsSync(path)) {
      skipped.push(path);
      continue;
    }
    writeFileSync(path, contents, "utf8");
    created.push(path);
  }

  copySkillTemplates(projectDir, created, skipped);

  const configPath = join(projectDir, ".storymode", "config.json");
  if (!existsSync(configPath)) {
    saveProjectConfig(projectDir, projectConfigSchema.parse({ title }));
    created.push(configPath);
  } else {
    skipped.push(configPath);
  }

  return { created, skipped };
}
