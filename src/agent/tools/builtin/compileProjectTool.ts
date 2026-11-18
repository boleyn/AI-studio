import { getProject } from "@server/projects/projectStorage";
import { defineTool } from "../types";

const DEFAULT_LIMIT = 30;
const MAX_TEXT_LENGTH = 1200;
const ANSI_COLOR_PATTERN = /\x1b\[[0-9;]*m/g;
const NOISE_PATTERNS = [
  /hot update/i,
  /hot reload/i,
  /fast refresh/i,
  /hmr/i,
  /rebuild(ing)?/i,
  /compiled successfully/i,
  /waiting for update signal/i,
  /websocket connected/i,
];

const sanitizeText = (text: string) =>
  text.replace(ANSI_COLOR_PATTERN, "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);

const isNoise = (text: string) => !text || NOISE_PATTERNS.some((p) => p.test(text));

const looksLikeError = (text: string) =>
  /\berror\b|\bfailed\b|\bexception\b|\bcannot\b|\bmodule not found\b|\bsyntaxerror\b/i.test(text);

const uniqueRecent = (items: string[], limit: number) => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const raw of items) {
    const text = sanitizeText(raw);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    deduped.push(text);
  }
  return deduped.slice(-limit);
};

export const compileProjectTool = defineTool<{ includeLogs?: boolean; includeEvents?: boolean; limit?: number }>({
  name: "compile_project",
  toolset: "project",
  readOnly: true,
  isAvailable: ({ projectToken }) => Boolean(projectToken),
  description:
    "Read normalized Sandpack compile status/errors for the current project with noise-filtered recent logs/events. " +
    "For frontend preview/compile, MUST use compile_project instead of starting dev servers via Bash.",
  parameters: {
    type: "object",
    properties: {
      includeLogs: { type: "boolean", description: "Whether to return console logs. Defaults to true." },
      includeEvents: { type: "boolean", description: "Whether to return compile events. Defaults to true." },
      limit: { type: "number", description: "Max number of logs/events/errors to return (1-200, default 30)." },
    },
  },
  async handler(input, { projectToken }) {
    if (!projectToken) {
      return {
        content: JSON.stringify({
          ok: false,
          message: "Project context is unavailable in this runtime. compile_project only works in project-backed sessions.",
        }),
      };
    }

    const project = await getProject(projectToken);
    if (!project) {
      return { content: JSON.stringify({ ok: false, message: "Project not found for current runtime token." }) };
    }

    const compileInfo = project.sandpackCompileInfo;
    if (!compileInfo) {
      return {
        content: JSON.stringify({
          ok: false,
          message: "No Sandpack compile info yet. Run the preview once, then call compile_project again.",
        }),
      };
    }

    const limit = Math.min(200, Math.max(1, Math.floor(Number(input.limit) || DEFAULT_LIMIT)));
    const includeLogs = input.includeLogs !== false;
    const includeEvents = input.includeEvents !== false;

    const filteredEvents = compileInfo.events
      .map((event) => ({ ...event, text: sanitizeText(event.text) }))
      .filter((event) => event.text && !isNoise(event.text))
      .slice(-limit);

    const filteredLogs = compileInfo.logs
      .map((log) => ({ ...log, text: sanitizeText(log.text) }))
      .filter((log) => log.text && !isNoise(log.text))
      .slice(-limit);

    let filteredErrors = uniqueRecent(
      compileInfo.errors.map((err) => sanitizeText(err)).filter((err) => !isNoise(err)),
      limit,
    );

    if (filteredErrors.length === 0 && compileInfo.status === "error") {
      filteredErrors = uniqueRecent(
        [...filteredEvents.map((e) => e.text), ...filteredLogs.map((l) => l.text)].filter(looksLikeError),
        limit,
      );
    }

    return {
      content: JSON.stringify({
        ok: true,
        status: compileInfo.status,
        updatedAt: compileInfo.updatedAt,
        lastEventType: compileInfo.lastEventType || "",
        lastEventText: sanitizeText(compileInfo.lastEventText || ""),
        errors: filteredErrors,
        events: includeEvents ? filteredEvents : [],
        logs: includeLogs ? filteredLogs : [],
      }),
    };
  },
});
