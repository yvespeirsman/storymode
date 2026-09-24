import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadProjectConfig, resolveConfig, saveProjectConfig } from "../src/project/config.js";
import { withTempProject } from "./helpers.js";

describe("project config", () => {
  beforeEach((ctx) => {
    const globalDir = mkdtempSync(join(tmpdir(), "storymode-global-"));
    process.env.STORYMODE_CONFIG_DIR = globalDir;
    ctx.onTestFinished(() => {
      delete process.env.STORYMODE_CONFIG_DIR;
      rmSync(globalDir, { recursive: true, force: true });
    });
  });

  it("defaults when no config file exists", () => {
    withTempProject((dir) => {
      const config = loadProjectConfig(dir);
      expect(config.title).toBe("Untitled Story");
      expect(config.autoAcceptEdits).toBe(false);
    });
  });

  it("round-trips a saved project config", () => {
    withTempProject((dir) => {
      saveProjectConfig(dir, {
        title: "The Salt Road",
        autoAcceptEdits: false,
        autoExtractContinuity: true,
      });
      const loaded = loadProjectConfig(dir);
      expect(loaded.title).toBe("The Salt Road");
    });
  });

  it("resolveConfig throws a helpful error when no API key is available", () => {
    withTempProject((dir) => {
      const prevKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        expect(() => resolveConfig(dir)).toThrow(/No API key found for provider "anthropic"/);
      } finally {
        if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
      }
    });
  });

  it("resolveConfig picks up an API key from the environment", () => {
    withTempProject((dir) => {
      const prevKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key";
      try {
        const resolved = resolveConfig(dir);
        expect(resolved.provider).toBe("anthropic");
        expect(resolved.apiKey).toBe("test-key");
      } finally {
        if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = prevKey;
      }
    });
  });
});
