import { defineTool } from "../tools/types";
import { MemoryStore, type MemoryTarget } from "./store";

export const MemoryTool = defineTool<{
  action: "read" | "add" | "replace" | "remove";
  target?: MemoryTarget;
  content?: string;
  old_text?: string;
}>({
  name: "Memory",
  toolset: "memory",
  readOnly: true,
  isAvailable: ({ projectToken }) => Boolean(projectToken),
  description:
    "Read or update persistent cross-session memory (project conventions, user preferences, environment facts). " +
    "Actions: read, add, replace, remove. Targets: 'memory' (project facts) or 'user' (user preferences).",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "add", "replace", "remove"] },
      target: { type: "string", enum: ["memory", "user"], description: "Defaults to 'memory'" },
      content: { type: "string", description: "Content to add/replace, or substring to remove" },
      old_text: { type: "string", description: "Substring to match when action='replace'" },
    },
    required: ["action"],
  },
  async handler(input, { projectToken, permissionMode }) {
    if (!projectToken) return { content: "Memory unavailable without projectToken.", isError: true };
    const store = new MemoryStore(projectToken);
    const target: MemoryTarget = input.target === "user" ? "user" : "memory";

    if (input.action === "read") {
      const entries = await store.loadEntries(target);
      return { content: entries.length ? entries.map((e, i) => `${i + 1}. ${e}`).join("\n") : `(no ${target} entries)` };
    }
    if (permissionMode === "plan") return { content: "Memory updates are disabled in plan mode.", isError: true };
    if (input.action === "add") {
      const res = await store.add(target, String(input.content || ""));
      return { content: res.message, isError: !res.ok };
    }
    if (input.action === "replace") {
      const res = await store.replace(target, String(input.old_text || ""), String(input.content || ""));
      return { content: res.message, isError: !res.ok };
    }
    if (input.action === "remove") {
      const res = await store.remove(target, String(input.content || input.old_text || ""));
      return { content: res.message, isError: !res.ok };
    }
    return { content: `Unsupported action: ${input.action}`, isError: true };
  },
});
