import path from 'node:path'

const VIRTUAL_ROOT_PATTERN =
  /(^|[\s'"`=:(,\[])\/(\.files|skills|\.aistudio)(?=\/|[\s'"`;:,)\]}]|$)/g

/** Resolve model-visible paths while preserving shell quoting and scripts. */
export function resolveVirtualWorkspacePaths(command: string, workspaceRoot: string): string {
  return command.replace(
    VIRTUAL_ROOT_PATTERN,
    (_match, prefix: string, virtualRoot: string) =>
      `${prefix}${path.join(workspaceRoot, virtualRoot)}`,
  )
}
