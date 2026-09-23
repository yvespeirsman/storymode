import { randomUUID } from "node:crypto";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { type ContinuityFact, continuityFactSchema } from "../project/schema.js";
import { projectFileExists, readProjectFile, writeProjectFile } from "./fileTools.js";

const FACTS_PATH = ".storymode/continuity/facts.jsonl";

export function readFacts(projectDir: string): ContinuityFact[] {
  if (!projectFileExists(projectDir, FACTS_PATH)) return [];
  const raw = readProjectFile(projectDir, FACTS_PATH);
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => continuityFactSchema.parse(JSON.parse(line)));
}

export function appendFacts(projectDir: string, facts: ContinuityFact[]): void {
  if (facts.length === 0) return;
  const existing = projectFileExists(projectDir, FACTS_PATH) ? readProjectFile(projectDir, FACTS_PATH) : "";
  const lines = facts.map((f) => JSON.stringify(f));
  const updated = existing.trimEnd().length > 0 ? `${existing.trimEnd()}\n${lines.join("\n")}\n` : `${lines.join("\n")}\n`;
  writeProjectFile(projectDir, FACTS_PATH, updated);
}

const extractedFactSchema = z.object({
  subject: z.string().describe("Who or what this fact is about, e.g. a character or location name"),
  fact: z.string().describe("A single atomic, verifiable fact stated or implied by the text"),
});

/** Uses the model to pull atomic canonical facts out of a chapter's text and appends them to facts.jsonl. */
export async function extractFacts(
  model: LanguageModel,
  projectDir: string,
  chapterId: string,
  chapterText: string,
): Promise<ContinuityFact[]> {
  const { object } = await generateObject({
    model,
    schema: z.object({ facts: z.array(extractedFactSchema) }),
    prompt:
      "Extract a short list of atomic, checkable canonical facts from this story chapter " +
      "(physical traits, names, dates, relationships, locations visited, objects owned). " +
      "Skip stylistic or subjective observations. Only include facts a later chapter could contradict.\n\n" +
      `Chapter text:\n${chapterText}`,
  });

  const now = new Date().toISOString();
  const facts: ContinuityFact[] = object.facts.map((f) => ({
    id: randomUUID(),
    chapter: chapterId,
    subject: f.subject,
    fact: f.fact,
    extractedAt: now,
  }));

  appendFacts(projectDir, facts);
  return facts;
}

export interface Contradiction {
  factId: string;
  subject: string;
  existingFact: string;
  issue: string;
}

/** Asks the model whether new chapter text contradicts any previously extracted canonical facts. */
export async function checkConsistency(
  model: LanguageModel,
  projectDir: string,
  newText: string,
): Promise<Contradiction[]> {
  const facts = readFacts(projectDir);
  if (facts.length === 0) return [];

  const { object } = await generateObject({
    model,
    schema: z.object({
      contradictions: z.array(
        z.object({
          factId: z.string().describe("The id of the contradicted fact"),
          issue: z.string().describe("A short explanation of the contradiction"),
        }),
      ),
    }),
    prompt:
      "Here is a list of canonical facts established earlier in a story, and a new passage of text.\n" +
      "Identify any facts the new passage clearly contradicts. Do not flag facts it is merely silent about.\n\n" +
      `Known facts (JSON):\n${JSON.stringify(facts.map((f) => ({ id: f.id, subject: f.subject, fact: f.fact })))}\n\n` +
      `New passage:\n${newText}`,
  });

  const byId = new Map(facts.map((f) => [f.id, f]));
  return object.contradictions
    .filter((c) => byId.has(c.factId))
    .map((c) => {
      const fact = byId.get(c.factId)!;
      return { factId: c.factId, subject: fact.subject, existingFact: fact.fact, issue: c.issue };
    });
}
