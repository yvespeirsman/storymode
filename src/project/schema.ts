import { z } from "zod";

export const providerIdSchema = z.enum(["anthropic", "openai"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const globalConfigSchema = z.object({
  defaultProvider: providerIdSchema.default("anthropic"),
  defaultModel: z.string().default("claude-sonnet-5"),
  apiKeys: z.partialRecord(providerIdSchema, z.string()).default({}),
});
export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const projectConfigSchema = z.object({
  title: z.string().default("Untitled Story"),
  styleGuide: z.string().default(""),
  provider: providerIdSchema.optional(),
  model: z.string().optional(),
  autoAcceptEdits: z.boolean().default(false),
  autoExtractContinuity: z.boolean().default(true),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export const characterFrontmatterSchema = z.object({
  name: z.string(),
  role: z.string().default(""),
  traits: z.array(z.string()).default([]),
});
export type CharacterFrontmatter = z.infer<typeof characterFrontmatterSchema>;

export const locationFrontmatterSchema = z.object({
  name: z.string(),
  summary: z.string().default(""),
});
export type LocationFrontmatter = z.infer<typeof locationFrontmatterSchema>;

export const continuityFactSchema = z.object({
  id: z.string(),
  chapter: z.string(),
  subject: z.string(),
  fact: z.string(),
  extractedAt: z.string(),
});
export type ContinuityFact = z.infer<typeof continuityFactSchema>;
