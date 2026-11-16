import { describe, expect, test } from "bun:test";
import { getRuntimeSkillByName, reloadSkillSnapshot, sampleSkillFiles } from "./registry";

describe("Hermes skills API catalog", () => {
  test("loads bundled instructions without exposing host paths", async () => {
    const snapshot = await reloadSkillSnapshot();
    expect(snapshot.skills.length).toBeGreaterThan(0);
    for (const skill of snapshot.skills) {
      expect(skill.location.startsWith("/skills/")).toBe(true);
      expect(skill.baseDir.startsWith("/skills/")).toBe(true);
      expect(skill.body.length).toBeGreaterThan(0);
    }
    const first = snapshot.skills[0];
    const found = await getRuntimeSkillByName(first.name);
    expect(found.skill?.name).toBe(first.name);
    const files = await sampleSkillFiles(first, 2);
    expect(files.length).toBeLessThanOrEqual(2);
    expect(files.every((file) => file.startsWith("/skills/"))).toBe(true);
  });
});
