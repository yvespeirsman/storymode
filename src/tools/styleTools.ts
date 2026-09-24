import { projectFileExists, readProjectFile, writeProjectFile } from "./fileTools.js";

const STYLE_PATH = ".storymode/style.md";

export function readStyleGuide(projectDir: string): string {
  if (!projectFileExists(projectDir, STYLE_PATH)) return "";
  return readProjectFile(projectDir, STYLE_PATH);
}

export function updateStyleGuide(projectDir: string, contents: string): void {
  writeProjectFile(projectDir, STYLE_PATH, contents);
}
