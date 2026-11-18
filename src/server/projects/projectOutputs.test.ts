import { expect, test } from "bun:test";
import { filterProjectOutputs } from "./projectOutputs";
import { loadProjectTemplateDefaults } from "./projectTemplateLoader";

test("legacy bootstrap files are not outputs; modified sources and generated artifacts remain", () => {
  const files = {
    "/.aistudio/skills/docx/SKILL.md": { code: "instructions" },
    "/.files/upload.txt": { code: "source" },
    "/App.js": { code: "starter" },
    "/styles.css": { code: "edited" },
    "/report.txt": { code: "result" },
    "/skills/custom/SKILL.md": { code: "user-created skill" },
  };
  expect(Object.keys(filterProjectOutputs(files, { "/App.js": { code: "starter" }, "/styles.css": { code: "original" } })))
    .toEqual(["/styles.css", "/report.txt", "/skills/custom/SKILL.md"]);
  expect(Object.keys(files)).toHaveLength(6);
  expect(filterProjectOutputs({})).toEqual({});
});

test("explicit code templates no longer copy global skills into project storage", async () => {
  const defaults = await loadProjectTemplateDefaults("react");
  expect(Object.keys(defaults.files).length).toBeGreaterThan(0);
  expect(Object.keys(defaults.files).some(name => name.includes("skills/"))).toBe(false);
});
