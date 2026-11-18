import { describe, expect, test } from "bun:test";
import { parseSkillFrontmatter } from "./frontmatter";
import { collectProjectRuntimeSkills } from "./projectRuntimeSkills";

describe("shared SKILL.md parser", () => {
  test("supports YAML multiline descriptions, comments, CRLF and nested metadata", () => {
    const markdown = `---\nname: report # comment\ndescription: >-\n  Analyze a report:\n  explain findings.\nmetadata:\n  author: team\n  version: "2"\n---\n# Instructions`.replaceAll("\n", "\r\n");
    const metadata = parseSkillFrontmatter(markdown);
    expect(metadata.name).toBe("report");
    expect(metadata.description).toBe("Analyze a report: explain findings.");
    expect(metadata.metadata).toEqual({ author: "team", version: "2" });
    const project = collectProjectRuntimeSkills({ "/skills/report/SKILL.md": { code: markdown } });
    expect(project.skills[0].description).toBe(metadata.description!);
    expect(project.skills[0].metadata).toEqual(metadata.metadata);
  });

  test("malformed and non-object YAML cannot produce invalid metadata", () => {
    for (const frontmatter of ["[", "- name", "name: [invalid]", "name: !custom unsafe"]) {
      expect(parseSkillFrontmatter(`---\n${frontmatter}\n---\nBody`).name).toBeUndefined();
    }
  });
});
