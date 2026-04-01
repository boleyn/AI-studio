import { promises as fs } from "fs";
import path from "path";

const DEFAULT_SKILL_FILE = "skills/aistudio-mcp-code-workflow/SKILL.md";
const DEFAULT_MAX_LINES = 18;
const DEFAULT_MAX_CHARS = 1400;

const stripFrontmatter = (content: string) => {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) return trimmed;
  return trimmed.slice(endIndex + 4).trim();
};

const compactSkillBody = (body: string): string => {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("```"));

  const important = lines.filter((line) =>
    /^(\d+\.)|^[-*]|^##\s|^Project Conventions|^Hard Rules|^Execution Workflow/i.test(line)
  );
  const selected = (important.length > 0 ? important : lines).slice(0, DEFAULT_MAX_LINES);
  const compact = selected.join("\n");
  if (compact.length <= DEFAULT_MAX_CHARS) return compact;
  return `${compact.slice(0, DEFAULT_MAX_CHARS)}\n...[truncated]`;
};

export const getAgentRuntimeSkillPrompt = async (): Promise<string> => {
  const configured = process.env.AGENT_SKILL_FILE?.trim();
  const relativePath = configured || DEFAULT_SKILL_FILE;
  const filePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(process.cwd(), relativePath);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const body = stripFrontmatter(raw);
    const compactBody = compactSkillBody(body);
    console.info("[agent-skill] loaded", {
      filePath,
      configured: Boolean(configured),
      rawLength: raw.length,
      bodyLength: body.length,
      compactLength: compactBody.length,
    });
    return compactBody;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    console.warn("[agent-skill] load failed", {
      filePath,
      configured: Boolean(configured),
      error: message,
    });
    return "";
  }
};
