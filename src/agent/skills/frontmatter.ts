import { load, JSON_SCHEMA } from "js-yaml";

export type SkillMetadata = {
  name?: string;
  tools?: string[];
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
};

/** Shared by catalog, project snapshots, runtime discovery and skill editing. */
export function parseSkillFrontmatter(markdown: string): SkillMetadata {
  const match = markdown
    .trimStart()
    .match(/^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  try {
    const value: unknown = load(match[1], { schema: JSON_SCHEMA });
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const data = value as Record<string, unknown>;
    const result: SkillMetadata = {};
    if (Array.isArray(data.tools)) result.tools = data.tools.filter((item): item is string => typeof item === "string").slice(0, 20);
    for (const key of [
      "name",
      "description",
      "license",
      "compatibility",
    ] as const) {
      if (typeof data[key] === "string" && data[key].trim())
        result[key] = data[key].trim();
    }
    if (
      data.metadata &&
      typeof data.metadata === "object" &&
      !Array.isArray(data.metadata)
    ) {
      const metadata = Object.fromEntries(
        Object.entries(data.metadata).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      if (Object.keys(metadata).length) result.metadata = metadata;
    }
    return result;
  } catch {
    return {};
  }
}

export function skillDescription(
  markdown: string,
  metadata: SkillMetadata,
): string {
  return (
    metadata.description ||
    markdown
      .trimStart()
      .replace(/^---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
      .split(/\r?\n\r?\n/)
      .map((part) => part.trim())
      .find(Boolean) ||
    "No description"
  ).replace(/\s+/g, " ").slice(0, 240);
}
