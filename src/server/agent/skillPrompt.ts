import { promises as fs } from "fs";
import path from "path";

const DEFAULT_SKILL_FILE = "skills/aistudio-mcp-code-workflow/SKILL.md";

const stripFrontmatter = (content: string) => {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) return trimmed;
  return trimmed.slice(endIndex + 4).trim();
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
    console.info("[agent-skill] loaded", {
      filePath,
      configured: Boolean(configured),
      rawLength: raw.length,
      bodyLength: body.length,
    });
    return body;
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
