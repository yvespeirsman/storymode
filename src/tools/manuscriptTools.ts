import { listProjectFiles, projectFileExists, readProjectFile, writeProjectFile } from "./fileTools.js";

const MANUSCRIPT_DIR = "manuscript";

export function chapterPath(chapterId: string): string {
  return `${MANUSCRIPT_DIR}/${chapterId}.md`;
}

export function listChapters(projectDir: string): string[] {
  return listProjectFiles(projectDir, MANUSCRIPT_DIR)
    .filter((f) => !f.isDirectory && f.path.endsWith(".md"))
    .map((f) => f.path.replace(/^.*\//, "").replace(/\.md$/, ""))
    .sort();
}

export function readChapter(projectDir: string, chapterId: string): string {
  if (!projectFileExists(projectDir, chapterPath(chapterId))) return "";
  return readProjectFile(projectDir, chapterPath(chapterId));
}

export function writeChapter(projectDir: string, chapterId: string, contents: string): void {
  writeProjectFile(projectDir, chapterPath(chapterId), contents);
}

export function buildAppendScene(
  projectDir: string,
  chapterId: string,
  sceneText: string,
): { oldContents: string; newContents: string } {
  const existing = readChapter(projectDir, chapterId);
  const newContents = existing ? `${existing.trimEnd()}\n\n${sceneText.trim()}\n` : `${sceneText.trim()}\n`;
  return { oldContents: existing, newContents };
}

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

export function manuscriptWordCount(projectDir: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of listChapters(projectDir)) {
    counts[id] = wordCount(readChapter(projectDir, id));
  }
  return counts;
}
