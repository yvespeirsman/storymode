import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface ParsedFrontmatter<T> {
  data: T;
  body: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseFrontmatter<T>(source: string): ParsedFrontmatter<Partial<T>> {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) {
    return { data: {}, body: source };
  }
  const [, yamlBlock, body] = match;
  const data = (parseYaml(yamlBlock ?? "") ?? {}) as Partial<T>;
  return { data, body: body ?? "" };
}

export function stringifyFrontmatter<T extends Record<string, unknown>>(data: T, body: string): string {
  const yamlBlock = stringifyYaml(data).trimEnd();
  return `---\n${yamlBlock}\n---\n\n${body.trimStart()}`;
}
