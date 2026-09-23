import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export class PathEscapeError extends Error {
  constructor(path: string) {
    super(`Path "${path}" escapes the project directory.`);
  }
}

/** Resolves a user/model-supplied relative path and refuses anything that escapes projectDir. */
export function resolveInProject(projectDir: string, relPath: string): string {
  const abs = resolve(projectDir, relPath);
  const rel = relative(projectDir, abs);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new PathEscapeError(relPath);
  }
  return abs;
}

export function readProjectFile(projectDir: string, relPath: string): string {
  const abs = resolveInProject(projectDir, relPath);
  return readFileSync(abs, "utf8");
}

export function writeProjectFile(projectDir: string, relPath: string, contents: string): void {
  const abs = resolveInProject(projectDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, "utf8");
}

export function projectFileExists(projectDir: string, relPath: string): boolean {
  try {
    return existsSync(resolveInProject(projectDir, relPath));
  } catch {
    return false;
  }
}

export interface FileEntry {
  path: string;
  isDirectory: boolean;
}

export function listProjectFiles(
  projectDir: string,
  relDir: string,
  opts: { recursive?: boolean } = {},
): FileEntry[] {
  const absDir = resolveInProject(projectDir, relDir);
  if (!existsSync(absDir)) return [];

  const results: FileEntry[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".git")) continue;
      const abs = join(dir, name);
      const rel = relative(projectDir, abs);
      const isDirectory = statSync(abs).isDirectory();
      results.push({ path: rel, isDirectory });
      if (isDirectory && opts.recursive) walk(abs);
    }
  };
  walk(absDir);
  return results;
}

/** Simple case-insensitive text search across markdown files under relDir. */
export function searchProjectText(
  projectDir: string,
  relDir: string,
  query: string,
): Array<{ path: string; line: number; text: string }> {
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const needle = query.toLowerCase();
  for (const entry of listProjectFiles(projectDir, relDir, { recursive: true })) {
    if (entry.isDirectory || !entry.path.endsWith(".md")) continue;
    const contents = readProjectFile(projectDir, entry.path);
    contents.split("\n").forEach((line, idx) => {
      if (line.toLowerCase().includes(needle)) {
        matches.push({ path: entry.path, line: idx + 1, text: line.trim() });
      }
    });
  }
  return matches;
}
