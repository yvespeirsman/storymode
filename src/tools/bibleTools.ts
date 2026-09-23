import { parseFrontmatter, stringifyFrontmatter } from "../project/frontmatter.js";
import {
  type CharacterFrontmatter,
  type LocationFrontmatter,
  characterFrontmatterSchema,
  locationFrontmatterSchema,
} from "../project/schema.js";
import { listProjectFiles, projectFileExists, readProjectFile, writeProjectFile } from "./fileTools.js";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const CHARACTERS_DIR = ".storymode/bible/characters";
const LOCATIONS_DIR = ".storymode/bible/locations";

export interface BibleEntry<T> {
  slug: string;
  frontmatter: T;
  body: string;
}

export function listCharacters(projectDir: string): BibleEntry<CharacterFrontmatter>[] {
  return listProjectFiles(projectDir, CHARACTERS_DIR)
    .filter((f) => !f.isDirectory && f.path.endsWith(".md"))
    .map((f) => readCharacter(projectDir, f.path.replace(/^.*\//, "").replace(/\.md$/, "")));
}

export function readCharacter(projectDir: string, slug: string): BibleEntry<CharacterFrontmatter> {
  const path = `${CHARACTERS_DIR}/${slug}.md`;
  const source = readProjectFile(projectDir, path);
  const { data, body } = parseFrontmatter<CharacterFrontmatter>(source);
  return { slug, frontmatter: characterFrontmatterSchema.parse(data), body };
}

export interface UpsertResult {
  slug: string;
  path: string;
  oldContents: string | null;
  newContents: string;
}

export class BibleEntryNotFoundError extends Error {
  constructor(kind: string, slug: string) {
    super(`No ${kind} found with slug "${slug}".`);
  }
}

export function buildCharacterUpsert(
  projectDir: string,
  input: { slug?: string; name: string; role?: string; traits?: string[]; body?: string },
): UpsertResult {
  // A slug is a character's stable file identity. Renaming (changing `name`) must not change
  // the slug/path, or the old file is orphaned instead of updated — only derive a fresh slug
  // from the name when creating a brand-new entry (no slug given).
  const slug = input.slug ?? slugify(input.name);
  const path = `${CHARACTERS_DIR}/${slug}.md`;

  if (input.slug && !projectFileExists(projectDir, path)) {
    throw new BibleEntryNotFoundError("character", input.slug);
  }

  let body = input.body ?? "";
  let frontmatter: CharacterFrontmatter = characterFrontmatterSchema.parse({
    name: input.name,
    role: input.role ?? "",
    traits: input.traits ?? [],
  });
  let oldContents: string | null = null;

  if (projectFileExists(projectDir, path)) {
    const existing = readCharacter(projectDir, slug);
    oldContents = readProjectFile(projectDir, path);
    frontmatter = characterFrontmatterSchema.parse({
      name: input.name,
      role: input.role ?? existing.frontmatter.role,
      traits: input.traits ?? existing.frontmatter.traits,
    });
    body = input.body ?? existing.body;
  }

  const newContents = stringifyFrontmatter(frontmatter, body || `# ${input.name}\n`);
  return { slug, path, oldContents, newContents };
}

export function upsertCharacter(
  projectDir: string,
  input: { slug?: string; name: string; role?: string; traits?: string[]; body?: string },
): { slug: string; path: string; contents: string } {
  const { slug, path, newContents } = buildCharacterUpsert(projectDir, input);
  writeProjectFile(projectDir, path, newContents);
  return { slug, path, contents: newContents };
}

export function listLocations(projectDir: string): BibleEntry<LocationFrontmatter>[] {
  return listProjectFiles(projectDir, LOCATIONS_DIR)
    .filter((f) => !f.isDirectory && f.path.endsWith(".md"))
    .map((f) => readLocation(projectDir, f.path.replace(/^.*\//, "").replace(/\.md$/, "")));
}

export function readLocation(projectDir: string, slug: string): BibleEntry<LocationFrontmatter> {
  const path = `${LOCATIONS_DIR}/${slug}.md`;
  const source = readProjectFile(projectDir, path);
  const { data, body } = parseFrontmatter<LocationFrontmatter>(source);
  return { slug, frontmatter: locationFrontmatterSchema.parse(data), body };
}

export function buildLocationUpsert(
  projectDir: string,
  input: { slug?: string; name: string; summary?: string; body?: string },
): UpsertResult {
  const slug = input.slug ?? slugify(input.name);
  const path = `${LOCATIONS_DIR}/${slug}.md`;

  if (input.slug && !projectFileExists(projectDir, path)) {
    throw new BibleEntryNotFoundError("location", input.slug);
  }

  let body = input.body ?? "";
  let frontmatter: LocationFrontmatter = locationFrontmatterSchema.parse({
    name: input.name,
    summary: input.summary ?? "",
  });
  let oldContents: string | null = null;

  if (projectFileExists(projectDir, path)) {
    const existing = readLocation(projectDir, slug);
    oldContents = readProjectFile(projectDir, path);
    frontmatter = locationFrontmatterSchema.parse({
      name: input.name,
      summary: input.summary ?? existing.frontmatter.summary,
    });
    body = input.body ?? existing.body;
  }

  const newContents = stringifyFrontmatter(frontmatter, body || `# ${input.name}\n`);
  return { slug, path, oldContents, newContents };
}

export function upsertLocation(
  projectDir: string,
  input: { slug?: string; name: string; summary?: string; body?: string },
): { slug: string; path: string; contents: string } {
  const { slug, path, newContents } = buildLocationUpsert(projectDir, input);
  writeProjectFile(projectDir, path, newContents);
  return { slug, path, contents: newContents };
}

/** Finds bible entries whose name is mentioned (case-insensitively) in the given text. */
export function findMentionedCharacters(
  projectDir: string,
  text: string,
): BibleEntry<CharacterFrontmatter>[] {
  const lower = text.toLowerCase();
  return listCharacters(projectDir).filter((c) => lower.includes(c.frontmatter.name.toLowerCase()));
}
