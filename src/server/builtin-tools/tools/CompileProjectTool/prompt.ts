export const COMPILE_PROJECT_TOOL_NAME = 'compile_project'

export const DESCRIPTION =
  'Read normalized Sandpack compile status/errors for the current project with noise-filtered recent logs/events.'

export const PROMPT = `Sandpack compile status/errors for the current project.

Rules:
- Runtime is virtual sandbox (not real host).
- Frontend preview/compile diagnosis should use compile_project first.
- During frontend preview/compile diagnosis, do not run npm/pnpm/yarn dev/start.

Parameters:
- includeLogs (boolean, default true): include recent console logs.
- includeEvents (boolean, default true): include recent compile lifecycle events.
- limit (1-200, default 30): cap for returned errors/logs/events.`

