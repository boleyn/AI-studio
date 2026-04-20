import 'module-alias/register';
import { getCommands, findCommand } from '../src/server/agent/commands.ts';
import { runWithVirtualProjectRoot } from '../src/server/agent/utils/fsOperations.ts';

async function main() {
  const cwd = process.cwd();
  const commands = await getCommands(cwd);
  const command = findCommand('b-admin-ui-style', commands);
  if (!command || command.type !== 'prompt') {
    console.log('NOT_FOUND');
    process.exit(0);
  }
  console.log('FOUND', JSON.stringify({
    name: command.name,
    source: command.source,
    loadedFrom: command.loadedFrom,
    context: command.context,
    skillRoot: command.skillRoot,
  }, null, 2));
  const fakeContext: any = {
    messages: [],
    options: {
      agentDefinitions: { activeAgents: [{ agentType: 'general-purpose' }] },
      tools: [],
      mainLoopModel: 'sonnet',
    },
    setAppState() {},
    getAppState() {
      return {
        cwd,
        toolPermissionContext: { alwaysAllowRules: { command: [] } },
        mcp: { commands: [] },
      };
    },
  };
  const virtualRoot = `${cwd}/.aistudio-virtual/inspect`;
  const blocks = await runWithVirtualProjectRoot(virtualRoot, () => command.getPromptForCommand('', fakeContext));
  const text = blocks.map((b: any) => (b.type === 'text' ? b.text : '')).join('\n');
  console.log('HAS_USERS_PATH', text.includes('/Users/santain'));
  console.log('HAS_VIRTUAL_SKILLS_PATH', text.includes('/skills/b-admin-ui-style'));
  console.log('HAS_HOST_PROJECT_PATH', text.includes(`${cwd}/skills/b-admin-ui-style`));
  console.log('PROMPT_START');
  console.log(text.slice(0, 1500));
  console.log('PROMPT_END');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
