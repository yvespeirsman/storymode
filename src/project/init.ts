import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveProjectConfig } from "./config.js";
import { projectConfigSchema } from "./schema.js";

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

const GITIGNORE = `node_modules/
.storymode/session/
`;

export interface InitResult {
  created: string[];
  skipped: string[];
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

  const configPath = join(projectDir, ".storymode", "config.json");
  if (!existsSync(configPath)) {
    saveProjectConfig(projectDir, projectConfigSchema.parse({ title }));
    created.push(configPath);
  } else {
    skipped.push(configPath);
  }

  return { created, skipped };
}
