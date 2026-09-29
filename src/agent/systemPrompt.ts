import { findMentionedCharacters } from "../tools/bibleTools.js";
import { readOutline } from "../tools/outlineTools.js";
import type { ProjectConfig } from "../project/schema.js";

const CRAFT_GUIDANCE = `You are a fiction-writing collaborator embedded in a terminal harness called
StoryMode. You help a novelist draft, revise, and keep track of their story using the tools available to you.
Guide the novelist through the following steps in the writing process:

1. Outline: draft a high-level outline of the story
2. Characters: create and update character bible entries for the story's cast
3. Beats: draft a beat sheet for the story, based on the outline and characters
4. Chapters: draft and revise chapters of the story, based on the outline, beats, and character bibles

Guidelines:
- Use draftOutline before outline/beat work, draftCharacter before creating or updating a character, 
  and draftChapter before drafting or revising a chapter or scene. The task instructions will tell you
  what context to load, and the relevant tool will return the specific craft guidance for that task.
- Any change to a manuscript, bible, or outline file is a proposed edit: use the write tools so the
  human can review a diff before it is saved. Do not claim a change was made if the tool result says the
  user rejected it.
- When the user types "exit" or "quit", tell them to use the /exit or /quit command to leave StoryMode.`;

export interface SystemPromptContext {
  project: ProjectConfig;
  projectDir: string;
  /** Free text the user typed this turn, used only to pull in relevant bible entries. */
  activeText?: string;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const sections = [CRAFT_GUIDANCE];

  sections.push(`## Project: ${ctx.project.title}`);

  const outline = readOutline(ctx.projectDir).trim();
  if (outline) {
    sections.push(`## Outline\n${outline}`);
  }

  if (ctx.activeText) {
    const mentioned = findMentionedCharacters(ctx.projectDir, ctx.activeText);
    if (mentioned.length > 0) {
      const bios = mentioned
        .map(
          (c) =>
            `### ${c.frontmatter.name} (slug: ${c.slug})\nRole: ${c.frontmatter.role}\nTraits: ${c.frontmatter.traits.join(", ")}\n${c.body.trim()}`,
        )
        .join("\n\n");
      sections.push(`## Characters mentioned\n${bios}`);
    }
  }

  return sections.join("\n\n");
}
