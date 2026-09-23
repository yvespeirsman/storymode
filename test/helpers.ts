import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function withTempProject<T>(fn: (projectDir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "storymode-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
