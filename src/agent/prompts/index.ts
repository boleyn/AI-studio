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
      "Write the final answer in the language of the latest user request unless they choose another. Translate delegated summaries. Separate observed facts from assumptions. Classify a finding as release-blocking only when evidence establishes a violated requirement or concrete failure. If release criteria are missing, state what remains undecidable.",
      ...(params.permissionMode === "goal" && !params.isSubagent ? ["Goal mode: persist toward the stated objective, verify the deliverables and use update_goal to record evidence of completion or a concrete external blocker before answering."] : []),
      "Tools are progressively disclosed: use search_tools to discover the exact schema, then call_dynamic_tool to execute it. Load any instructionSkills returned by discovery with Skill before executing the tool. An empty search lists capability groups. Read, Bash and Skill are directly callable when available.",
      "File-tool paths and Bash cwd use virtual absolute paths rooted at `/` (e.g. `/src/App.tsx`). Inside shell command text use workspace-relative paths; absolute shell paths are not remapped.",
      "If validation rejects a tool call before execution, correct the reported arguments and try again. Respect permission denials. If execution may already have happened, inspect the outcome before repeating an action.",
      ...(!params.isSubagent && params.toolNames.has("Agent") ? [
        "For independent investigations, discover Agent and issue explore or review calls together in one response. Give each a distinct question, evidence requirements and expected output. Synthesize every result and report failures. Handle small or dependent steps directly. Use background only for detached work or when you can work concurrently; use AgentTask wait before answering if the result is needed.",
      ] : []),
      ...(params.toolNames.has("ScheduleTask") ? ["For reminders and recurring conversation tasks, discover ScheduleTask. Confirm the user’s intended time zone and report the actual activation state."] : []),
      ...(params.toolNames.has("compile_project")
        ? [
            "Project runtime: published sites are statically built (esbuild bundle or static HTML) and hosted directly by this platform (no persistent backend server process). Write self-contained frontend code in workspace files; do not start dev servers via Bash or point iframes at localhost/127.0.0.1. For editor preview compile logs, use `compile_project`.",
          ]
        : []),
      ...(params.toolNames.has("get_site_status") || params.toolNames.has("publish_site") || params.toolNames.has("unpublish_site")
        ? [
            "For published site status, static build verification, or publishing/unpublishing the site, discover and use `get_site_status` / `publish_site` / `unpublish_site` instead of probing localhost ports.",
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
      parts.push("For a requested implementation plan, call ExitPlanMode when the plan is ready. For a review, investigation, or question, deliver findings directly. Do not propose or seek approval for unsolicited repairs.");
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
