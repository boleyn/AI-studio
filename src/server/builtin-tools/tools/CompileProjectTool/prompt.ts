export const COMPILE_PROJECT_TOOL_NAME = 'compile_project'

export const DESCRIPTION =
  'Read normalized Sandpack compile status/errors for the current project with noise-filtered recent logs/events.'

export const PROMPT = `Returns current project compile diagnostics captured from Sandpack.

Rules:
- Runtime is VIRTUAL SANDBOX (not host machine).
- For frontend preview/compile, MUST use compile_project. NEVER start dev servers via CLI.

Parameters:
- includeLogs (boolean, default true): include recent console logs.
- includeEvents (boolean, default true): include recent compile lifecycle events.
- limit (1-200, default 30): cap for returned errors/logs/events.`

