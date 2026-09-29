import { type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { compactMessages } from "../src/agent/compaction.js";

function mockModel(summaryText: string) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text" as const, text: summaryText }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

function userMsg(text: string): ModelMessage {
  return { role: "user", content: text };
}

function assistantMsg(text: string): ModelMessage {
  return { role: "assistant", content: text };
}

describe("compactMessages", () => {
  it("leaves a short history untouched", async () => {
    const messages = [userMsg("hi"), assistantMsg("hello")];
    const result = await compactMessages(mockModel("should not be used"), messages);
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("summarizes the oldest messages once past the threshold, keeping a recent tail verbatim", async () => {
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 25; i++) {
      messages.push(userMsg(`user turn ${i}`));
      messages.push(assistantMsg(`assistant reply ${i}`));
    }
    expect(messages.length).toBeGreaterThan(40);

    const result = await compactMessages(mockModel("Concise recap of the earlier session."), messages);

    expect(result.compacted).toBe(true);
    expect(result.summarizedCount).toBeGreaterThan(0);
    // The synthetic summary message, plus a verbatim tail.
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.messages[0]?.role).toBe("user");
    expect(String(result.messages[0]?.content)).toContain("Concise recap of the earlier session.");
    // The kept tail must start with a user message (a clean turn boundary).
    expect(result.messages[1]?.role).toBe("user");
    // The most recent turn is preserved verbatim, not summarized away.
    expect(String(messages.at(-1)?.content)).toContain("assistant reply 24");
    expect(result.messages.some((m) => String(m.content).includes("assistant reply 24"))).toBe(true);
  });

  it("falls back to the original messages if summarization fails", async () => {
    const failingModel = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("network error");
      },
    });
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 25; i++) {
      messages.push(userMsg(`user turn ${i}`));
      messages.push(assistantMsg(`assistant reply ${i}`));
    }

    const result = await compactMessages(failingModel, messages);
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });
});
