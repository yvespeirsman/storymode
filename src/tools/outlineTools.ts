import { listProjectFiles, projectFileExists, readProjectFile, writeProjectFile } from "./fileTools.js";

const OUTLINE_PATH = ".storymode/outline/outline.md";
const BEATS_DIR = ".storymode/outline/beats";

export function readOutline(projectDir: string): string {
  if (!projectFileExists(projectDir, OUTLINE_PATH)) return "";
  return readProjectFile(projectDir, OUTLINE_PATH);
}

export function updateOutline(projectDir: string, contents: string): void {
  writeProjectFile(projectDir, OUTLINE_PATH, contents);
}

export function beatsPath(chapterId: string): string {
  return `${BEATS_DIR}/${chapterId}.md`;
}

export function readBeats(projectDir: string, chapterId: string): string {
  const path = beatsPath(chapterId);
  if (!projectFileExists(projectDir, path)) return "";
  return readProjectFile(projectDir, path);
}

export function updateBeats(projectDir: string, chapterId: string, contents: string): void {
  writeProjectFile(projectDir, beatsPath(chapterId), contents);
}

export function listBeatChapters(projectDir: string): string[] {
  return listProjectFiles(projectDir, BEATS_DIR)
    .filter((f) => !f.isDirectory && f.path.endsWith(".md"))
    .map((f) => f.path.replace(/^.*\//, "").replace(/\.md$/, ""))
    .sort();
}
