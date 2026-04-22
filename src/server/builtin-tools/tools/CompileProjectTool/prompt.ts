export const COMPILE_PROJECT_TOOL_NAME = 'compile_project'

export const DESCRIPTION =
  'Read normalized Sandpack compile status/errors for the current project with noise-filtered recent logs/events.'

export const PROMPT = `Returns current project compile diagnostics captured from Sandpack.

Use this to check whether the preview/build is failing and get the latest useful error details.

Parameters:
- includeLogs (boolean, default true): include recent console logs.
- includeEvents (boolean, default true): include recent compile lifecycle events.
- limit (1-200, default 30): cap for returned errors/logs/events.

The result is already filtered and trimmed to recent entries; use this before attempting broad debugging.`

