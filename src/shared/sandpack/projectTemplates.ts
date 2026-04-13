import type { SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";

export const COMMON_PROJECT_TEMPLATES = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
  { value: "vite-react", label: "Vite + React" },
  { value: "nextjs", label: "Next.js" },
] as const;

export type CommonProjectTemplate = (typeof COMMON_PROJECT_TEMPLATES)[number]["value"];

export const DEFAULT_PROJECT_TEMPLATE: CommonProjectTemplate = "react";

const COMMON_TEMPLATE_SET = new Set<CommonProjectTemplate>(
  COMMON_PROJECT_TEMPLATES.map((item) => item.value)
);

export const isCommonProjectTemplate = (value: unknown): value is CommonProjectTemplate => {
  return typeof value === "string" && COMMON_TEMPLATE_SET.has(value as CommonProjectTemplate);
};

export const toSandpackTemplate = (
  value: CommonProjectTemplate
): SandpackPredefinedTemplate => {
  if (value === "vue") return "vite-vue";
  return value;
};
