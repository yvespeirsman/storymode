import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ResolvedConfig } from "../project/config.js";
import type { ProviderId } from "../project/schema.js";

export function resolveLanguageModel(config: ResolvedConfig): LanguageModel {
  switch (config.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: config.apiKey })(config.model);
    case "openai":
      return createOpenAI({ apiKey: config.apiKey })(config.model);
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unsupported provider: ${exhaustiveCheck}`);
    }
  }
}

export interface ModelInfo {
  id: string;
  displayName?: string;
}

async function listAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];
  let afterId: string | undefined;
  for (;;) {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "100");
    if (afterId) url.searchParams.set("after_id", afterId);
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) {
      throw new Error(`Anthropic models request failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as {
      data: Array<{ id: string; display_name?: string }>;
      has_more: boolean;
      last_id?: string;
    };
    models.push(...body.data.map((m) => ({ id: m.id, displayName: m.display_name })));
    if (!body.has_more || !body.last_id) break;
    afterId = body.last_id;
  }
  return models;
}

async function listOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI models request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { data: Array<{ id: string }> };
  return body.data.map((m) => ({ id: m.id }));
}

export async function listModels(provider: ProviderId, apiKey: string): Promise<ModelInfo[]> {
  switch (provider) {
    case "anthropic":
      return listAnthropicModels(apiKey);
    case "openai":
      return listOpenAIModels(apiKey);
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unsupported provider: ${exhaustiveCheck}`);
    }
  }
}

async function modelExistsAnthropic(apiKey: string, modelId: string): Promise<boolean> {
  const res = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(modelId)}`, {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`Anthropic model lookup failed: ${res.status} ${res.statusText}`);
  }
  return true;
}

async function modelExistsOpenAI(apiKey: string, modelId: string): Promise<boolean> {
  const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(modelId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`OpenAI model lookup failed: ${res.status} ${res.statusText}`);
  }
  return true;
}

export async function modelExists(provider: ProviderId, apiKey: string, modelId: string): Promise<boolean> {
  switch (provider) {
    case "anthropic":
      return modelExistsAnthropic(apiKey, modelId);
    case "openai":
      return modelExistsOpenAI(apiKey, modelId);
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unsupported provider: ${exhaustiveCheck}`);
    }
  }
}
