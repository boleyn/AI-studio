export const roleInstructions = {
  explore:
    "Inspect the workspace using read-only tools. Report evidence with paths and unresolved questions.",
  review:
    "Review using read-only tools. Prioritize concrete defects and cite evidence with paths.",
  "general-purpose":
    "Complete only the delegated task. Return results, evidence and unresolved issues.",
};

export function delegationRole(hint?: string, permissionMode?: string) {
  if (hint === "review" || hint === "explore") return hint;
  return permissionMode === "plan" ? "explore" : "general-purpose";
}

export const researchTools = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "search_tools",
  "call_dynamic_tool",
]);
