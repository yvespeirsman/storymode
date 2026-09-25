import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelMessage } from "ai";

function sessionDir(projectDir: string): string {
  return join(projectDir, ".storymode", "session");
}

function sessionPath(projectDir: string, id: string): string {
  return join(sessionDir(projectDir), `${id}.json`);
}

function latestPointerPath(projectDir: string): string {
  return join(sessionDir(projectDir), "latest.txt");
}

export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ModelMessage[];
}

export function createSession(): SessionData {
  const now = new Date().toISOString();
  return { id: randomUUID(), createdAt: now, updatedAt: now, messages: [] };
}

export function saveSession(projectDir: string, session: SessionData): void {
  mkdirSync(sessionDir(projectDir), { recursive: true });
  session.updatedAt = new Date().toISOString();
  writeFileSync(sessionPath(projectDir, session.id), JSON.stringify(session, null, 2), "utf8");
  writeFileSync(latestPointerPath(projectDir), session.id, "utf8");
}

export function loadLatestSession(projectDir: string): SessionData | null {
  const pointer = latestPointerPath(projectDir);
  if (!existsSync(pointer)) return null;
  const id = readFileSync(pointer, "utf8").trim();
  return loadSession(projectDir, id);
}

export function loadSession(projectDir: string, id: string): SessionData | null {
  const path = sessionPath(projectDir, id);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SessionData;
}
