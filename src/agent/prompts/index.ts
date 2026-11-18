import type { SandboxKind } from "../sandbox";
import type { SkillSummary } from "../skills/workspace";

export type PromptContext = {
  sandboxKind: SandboxKind;
  toolNames: ReadonlySet<string>;
  permissionMode: string;
  selectedSkills: string[];
  availableSkills: SkillSummary[];
  memoryBlock?: string | null;
  systemDirectives: string[];
  currentAttachments: string[];
  projectFilePaths: string[];
  isSubagent?: boolean;
};

export function buildSystemPrompt(params: PromptContext): string {
  const parts: string[] = [];

  const envLine =
    params.sandboxKind === "connector"
      ? "Environment: LOCAL CONNECTOR WORKSPACE (files map directly to the user's mounted local directory at `/`)."
      : params.sandboxKind === "local"
        ? "Environment: LOCAL WORKSPACE SANDBOX (isolated workspace rooted at `/`)."
        : "Environment: VIRTUAL VM SANDBOX (not host machine, workspace rooted at `/`).";

  parts.push(
    [
      "You are Bore, an autonomous coding and problem-solving assistant.",
      envLine,
      "Tools are progressively disclosed: use search_tools to discover the exact schema, then call_dynamic_tool to execute it. Load any instructionSkills returned by discovery with Skill before executing the tool. An empty search lists capability groups. Read, Bash and Skill are directly callable when available.",
      "File-tool paths and Bash cwd use virtual absolute paths rooted at `/` (e.g. `/src/App.tsx`). Inside shell command text use workspace-relative paths; absolute shell paths are not remapped.",
      "If validation rejects a tool call before execution, correct the reported arguments and try again. Respect permission denials. If execution may already have happened, inspect the outcome before repeating an action.",
      ...(params.toolNames.has("ScheduleTask") ? ["For reminders and recurring conversation tasks, discover ScheduleTask. Confirm the user’s intended time zone and report the actual activation state."] : []),
      ...(params.toolNames.has("compile_project")
        ? [
            "For frontend preview/compile, use `compile_project`. Do not start dev servers via Bash.",
          ]
        : []),
      ...(params.toolNames.has("Read")
        ? [
            "Prefer available file tools over shell commands for reading and editing files.",
          ]
        : []),
    ].join("\n"),
  );

  if (params.permissionMode === "plan") {
    parts.push(
      "Mode: PLAN MODE (read-only). Explore and present a plan before making changes.",
    );
    if (params.toolNames.has("AskUserQuestion"))
      parts.push("Use AskUserQuestion when clarification is needed.");
    if (params.toolNames.has("ExitPlanMode"))
      parts.push("Call ExitPlanMode with your finished plan for approval.");
  }

  if (params.isSubagent) {
    parts.push(
      "Role: SUBAGENT. Complete the delegated subtask concisely and return your findings/results directly.",
    );
  }

  return parts.join("\n\n");
}

/** Turn-varying observations belong at the tail, not in the cacheable prefix. */
export function buildTurnContext(params: PromptContext): string {
  const parts: string[] = [];
  if (params.toolNames.has("ScheduleTask")) {
    parts.push(`Current time (UTC): ${new Date().toISOString()}. Resolve relative schedule dates in the user's intended time zone.`);
  }
  if (params.memoryBlock) {
    parts.push(params.memoryBlock);
  }

  if (params.toolNames.has("Skill") && params.availableSkills.length > 0) {
    const lines = params.availableSkills
      .slice(0, 40)
      .map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`);
    parts.push(
      `Available skills (load full instructions with the \`Skill\` tool before using):\n${lines.join("\n")}`,
    );
  }

  if (params.toolNames.has("Skill") && params.selectedSkills.length > 0) {
    parts.push(
      `Selected runtime skills for this turn: ${params.selectedSkills.join(", ")}`,
    );
  }

  if (params.systemDirectives.length > 0) {
    parts.push(`System directives:\n${params.systemDirectives.join("\n\n")}`);
  }

  if (params.currentAttachments.length > 0) {
    parts.push(
      [
        "Attachments in the current user turn:",
        ...params.currentAttachments,
        'When the user says "this file" or equivalent, use the attachment from this current turn.',
      ].join("\n"),
    );
  }

  if (params.projectFilePaths.length > 0) {
    const shown = params.projectFilePaths.slice(0, 80);
    parts.push(
      `Project files in scope (${params.projectFilePaths.length}):\n${shown.join("\n")}`,
    );
  }

  return parts.length ? `<turn_context>\n${parts.join("\n\n")}\n</turn_context>` : "";
}
