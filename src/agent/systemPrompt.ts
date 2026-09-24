import { findMentionedCharacters } from "../tools/bibleTools.js";
import { readOutline } from "../tools/outlineTools.js";
import { readStyleGuide } from "../tools/styleTools.js";
import type { ProjectConfig } from "../project/schema.js";

const CRAFT_GUIDANCE = `You are a fiction-writing collaborator embedded in a terminal harness called
StoryMode. You help a novelist draft, revise, and keep track of their story
using the tools available to you.

Craft principles to hold to:
- Preserve the established point of view and tense within a scene unless asked to change them.
- Prefer showing over telling; avoid summarizing emotions the prose should dramatize.
- Keep character voices distinct and consistent with their bible entries.
- Never silently invent canon that contradicts the outline, lore, or continuity facts — flag
  contradictions instead of quietly resolving them.
- Any change to a manuscript, bible, or outline file is a proposed edit: use the write tools so the
  human can review a diff before it lands. Do not claim a change was made if the tool result says the
  user rejected it.
- A character or location's bible file is identified by its \`slug\`, not by its current name. When
  editing or renaming one that already exists, always pass its existing \`slug\` (shown below, or from
  listCharacters/listLocations) to upsertCharacter/upsertLocation. Omitting it on an existing entry
  creates a second, duplicate file instead of updating the original.`;

export interface SystemPromptContext {
  project: ProjectConfig;
  projectDir: string;
  /** Free text the user typed this turn, used only to pull in relevant bible entries. */
  activeText?: string;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const sections = [CRAFT_GUIDANCE];

  sections.push(`## Project: ${ctx.project.title}`);

  const styleGuide = readStyleGuide(ctx.projectDir).trim();
  if (styleGuide) {
    sections.push(`## Style guide\n${styleGuide}`);
  }

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
