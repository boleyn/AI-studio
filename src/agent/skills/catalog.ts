import path from "node:path";
import type { Sandbox } from "../sandbox";
import { discoverWorkspaceSkills, type SkillSummary } from "./workspace";

export type BundledSkill = SkillSummary & { content: string; resources?: Record<string, string> };
export type LoadedSkill = { skill: SkillSummary; content: string; references?: string[] };
export type SkillCatalog = {
  list: () => Promise<SkillSummary[]>;
  load: (name: string) => Promise<LoadedSkill | undefined>;
  readReference?: (name: string, resource: string) => Promise<string | undefined>;
};

/** Only manifests enter the initial context. References are enumerated, not read. */
export function createSkillCatalog(sandbox: Sandbox, bundled: readonly BundledSkill[] = []): SkillCatalog {
  const list = async () => {
    const skills = new Map((await discoverWorkspaceSkills(sandbox)).map(skill => [skill.name.toLowerCase(), skill]));
    for (const { content, resources, ...skill } of bundled) skills.set(skill.name.toLowerCase(), skill);
    return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const find = async (name: string) => (await list()).find(skill => skill.name.toLowerCase() === name.trim().toLowerCase());
  const references = async (skill: SkillSummary) => {
    const contribution = bundled.find(item => item.name === skill.name);
    if (contribution) return Object.keys(contribution.resources || {}).sort();
    const root = path.posix.dirname(skill.path);
    const queue = [root];
    const result: string[] = [];
    let visited = 0;
    while (queue.length && result.length < 100 && visited++ < 100) {
      const dir = queue.shift()!;
      for (const entry of await sandbox.fs.readdir(dir)) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        if (entry.type === "directory") queue.push(entry.path);
        else if (entry.path !== skill.path && result.length < 100) result.push(path.posix.relative(root, entry.path));
      }
    }
    return result.sort();
  };
  return {
    list,
    async load(name) {
      const skill = await find(name);
      if (!skill) return;
      const contribution = bundled.find(item => item.name === skill.name);
      return { skill, content: contribution?.content ?? await sandbox.fs.readText(skill.path), references: await references(skill) };
    },
    async readReference(name, resource) {
      const skill = await find(name);
      if (!skill) return;
      if (!resource || path.posix.isAbsolute(resource) || resource.split(/[\\/]/).some(part => part === ".." || part.startsWith("."))) throw new Error("Invalid skill reference path");
      const contribution = bundled.find(item => item.name === skill.name);
      if (contribution) return contribution.resources?.[resource];
      const target = path.posix.join(path.posix.dirname(skill.path), resource);
      return sandbox.fs.readText(target);
    },
  };
}
