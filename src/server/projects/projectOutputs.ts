import { isCommonProjectTemplate } from "@shared/sandpack/projectTemplates";
import { loadProjectTemplateDefaults } from "./projectTemplateLoader";

type Files = Record<string, { code: string }>;

/** Output views omit runtime resources and unchanged starter files, without deleting project sources. */
export function filterProjectOutputs(files: Files, starterFiles: Files = {}): Files {
  return Object.fromEntries(Object.entries(files).filter(([name, file]) => {
    const normalized = `/${name.replace(/\\/g, "/").replace(/^\/+/, "")}`;
    if (/^\/(?:\.aistudio|\.files)(?:\/|$)/.test(normalized)) return false;
    return starterFiles[normalized]?.code !== file.code;
  }));
}

export async function getProjectOutputs(project: { files: Files; template: string }): Promise<Files> {
  const template = project.template === "vite-vue" ? "vue" : project.template;
  const defaults = isCommonProjectTemplate(template)
    ? await loadProjectTemplateDefaults(template)
    : { files: {} };
  return filterProjectOutputs(project.files, defaults.files);
}
