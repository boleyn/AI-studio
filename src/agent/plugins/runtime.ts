import { parseSkillFrontmatter, skillDescription } from "../skills/frontmatter";
import type { BundledSkill } from "../skills/catalog";
import { ToolRegistry } from "../tools/registry";
import type { AgentPlugin, PluginPolicy } from "./types";

/** Request-owned plugin activation; failed setup unwinds all acquired resources. */
export class PluginRuntime {
  readonly registry = new ToolRegistry();
  readonly active: string[] = [];
  readonly skills: BundledSkill[] = [];
  private readonly promptContributions: Array<{ id: string; description: string; tools: string[]; render: (toolNames: ReadonlySet<string>) => string | undefined }> = [];

  instructionSkills(toolNames: ReadonlySet<string>): BundledSkill[] {
    return this.promptContributions.flatMap(({ id, description, tools, render }, index) => {
      const content = render(toolNames);
      if (!content) return [];
      return [{ name: `${id}:instructions-${index + 1}`, description: description.slice(0, 240),
        path: `plugin:${id}/instructions-${index + 1}/SKILL.md`, content,
        tools: tools.filter(name => toolNames.has(name)) }];
    });
  }
  private disposers: Array<() => void | Promise<void>> = [];

  static async create(
    plugins: readonly AgentPlugin[],
    policy: PluginPolicy = {},
    env = process.env,
  ) {
    const known = new Set(plugins.map((plugin) => plugin.manifest.id));
    for (const id of [...(policy.enabled || []), ...(policy.disabled || [])]) {
      if (!known.has(id)) throw new Error(`Unknown plugin: ${id}`);
    }
    const runtime = new PluginRuntime();
    const ids = new Set<string>();
    try {
      for (const plugin of plugins) {
        const { id, defaultEnabled, requiresEnv = [] } = plugin.manifest;
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
          throw new Error(`Invalid plugin ID: ${id}`);
        if (ids.has(id)) throw new Error(`Duplicate plugin: ${id}`);
        ids.add(id);
        if (policy.disabled?.includes(id)) continue;
        if (!defaultEnabled && !policy.enabled?.includes(id)) continue;
        const missing = requiresEnv.filter((key) => !env[key]?.trim());
        if (missing.length)
          throw new Error(`Plugin ${id} requires: ${missing.join(", ")}`);
        const contributedTools: string[] = [];
        await plugin.setup({
          registerSkill: ({ name, content, tools, resources }) => {
            if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
              throw new Error(`Invalid plugin skill: ${name}`);
            const qualifiedName = `${id}:${name}`;
            if (runtime.skills.some((skill) => skill.name === qualifiedName))
              throw new Error(`Duplicate skill: ${qualifiedName}`);
            runtime.skills.push({
              name: qualifiedName,
              description: skillDescription(
                content,
                parseSkillFrontmatter(content),
              ),
              path: `plugin:${id}/${name}/SKILL.md`,
              content, tools, resources,
            });
          },
          registerPrompt: (render) => runtime.promptContributions.push({ id, description: plugin.manifest.description, tools: contributedTools, render }),
          registerTool: (tool) => { runtime.registry.register({ ...tool }); contributedTools.push(tool.name); },
          onDispose: (dispose) => runtime.disposers.push(dispose),
        });
        runtime.active.push(id);
      }
      return runtime;
    } catch (error) {
      await runtime.dispose();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    const disposers = this.disposers.splice(0).reverse();
    for (const dispose of disposers) {
      try {
        await dispose();
      } catch (error) {
        console.warn("[agent] Plugin cleanup failed", error);
      }
    }
  }
}
