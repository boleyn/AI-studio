import type { SandboxKind } from "../sandbox";
import type { SkillSummary } from "../tools";

export function buildSystemPrompt(params: {
  sandboxKind: SandboxKind;
  permissionMode: string;
  selectedSkills: string[];
  availableSkills: SkillSummary[];
  memoryBlock?: string | null;
  systemDirectives: string[];
  currentAttachments: string[];
  projectFilePaths: string[];
  isSubagent?: boolean;
}): string {
  const parts: string[] = [];

  const envLine =
    params.sandboxKind === "connector"
      ? "Environment: LOCAL CONNECTOR WORKSPACE (files map directly to the user's mounted local directory at `/`)."
      : params.sandboxKind === "local"
      ? "Environment: LOCAL WORKSPACE SANDBOX (isolated workspace rooted at `/`)."
      : "Environment: VIRTUAL VM SANDBOX (not host machine, workspace rooted at `/`).";

  parts.push(
    [
      "You are AI Studio Agent (Hermes architecture), an autonomous coding and problem-solving assistant.",
      envLine,
      "All file paths use virtual absolute paths rooted at `/` (e.g. `/src/App.tsx`).",
      "For frontend preview/compile, MUST use `compile_project` when available. NEVER start dev servers via Bash.",
      "Prefer Read/Write/Edit/Glob/Grep over shell commands for reading and editing files.",
    ].join("\n"),
  );

  if (params.permissionMode === "plan") {
    parts.push(
      "Mode: PLAN MODE (read-only). Explore the codebase, ask clarifying questions with AskUserQuestion if needed, " +
        "and call ExitPlanMode with your finished plan before making any file edits.",
    );
  }

  if (params.isSubagent) {
    parts.push("Role: SUBAGENT. Complete the delegated subtask concisely and return your findings/results directly.");
  }

  if (params.memoryBlock) {
    parts.push(params.memoryBlock);
  }

  if (params.availableSkills.length > 0) {
    const lines = params.availableSkills
      .slice(0, 40)
      .map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`);
    parts.push(
      `Available skills (load full instructions with the \`Skill\` tool before using):\n${lines.join("\n")}`,
    );
  }

  if (params.selectedSkills.length > 0) {
    parts.push(`Selected runtime skills for this turn: ${params.selectedSkills.join(", ")}`);
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
    parts.push(`Project files in scope (${params.projectFilePaths.length}):\n${shown.join("\n")}`);
  }

  return parts.join("\n\n");
}
