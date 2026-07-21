import path from 'node:path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { logForDebugging } from 'src/utils/debug.js'
import { getFsImplementation } from 'src/utils/fsOperations.js'
import { notifyFileUpdated } from 'src/utils/fileUpdateNotifier.js'

const BASH_FILE_SNAPSHOT_LIMIT = 20_000
const BASH_FILE_NOTIFY_LIMIT = 2_000
const BASH_CONTENT_READ_LIMIT_BYTES = 1024 * 1024

type FileChangeLimits = {
  snapshotLimit: number
  notifyLimit: number
  contentReadLimitBytes: number
}

const DEFAULT_LIMITS: FileChangeLimits = {
  snapshotLimit: BASH_FILE_SNAPSHOT_LIMIT,
  notifyLimit: BASH_FILE_NOTIFY_LIMIT,
  contentReadLimitBytes: BASH_CONTENT_READ_LIMIT_BYTES,
}

type ReadFileStateLike = {
  delete(path: string): boolean
}

type NotificationMetadata = {
  commandType?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  toolName?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  permissionMode?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export function snapshotFilesystemMtimeByPath(roots: string[]): Map<string, number> {
  return snapshotFilesystemMtimeByPathWithMeta(roots, DEFAULT_LIMITS).snapshot
}

type SnapshotWithMeta = {
  snapshot: Map<string, number>
  truncated: boolean
}

function snapshotFilesystemMtimeByPathWithMeta(
  roots: string[],
  limits: FileChangeLimits,
): SnapshotWithMeta {
  const fs = getFsImplementation()
  const snapshot = new Map<string, number>()
  const pending = [...roots]
  let truncated = false

  while (pending.length > 0 && snapshot.size < limits.snapshotLimit) {
    const current = pending.pop()
    if (!current || snapshot.has(current)) continue

    let lst
    try {
      lst = fs.lstatSync(current)
    } catch {
      continue
    }

    if (lst.isSymbolicLink()) {
      continue
    }

    if (lst.isDirectory()) {
      let entries: string[]
      try {
        entries = fs.readdirStringSync(current)
      } catch {
        continue
      }
      for (const entry of entries) {
        pending.push(path.join(current, entry))
      }
      continue
    }

    if (lst.isFile()) {
      snapshot.set(current, Math.floor(lst.mtimeMs))
    }
  }

  if (pending.length > 0) {
    truncated = true
  }

  return { snapshot, truncated }
}

function readFileForBashNotification(
  filePath: string,
  limits: FileChangeLimits,
): string | null {
  const fs = getFsImplementation()
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > limits.contentReadLimitBytes) {
      return null
    }
    return fs.readFileSync(filePath, { encoding: 'utf8' })
  } catch {
    return null
  }
}

export function notifyBashFilesystemUpdates(
  beforeSnapshot: Map<string, number>,
  roots: string[],
  readFileState: ReadFileStateLike,
  limits: FileChangeLimits = DEFAULT_LIMITS,
  metadata: NotificationMetadata = {},
): void {
  const after = snapshotFilesystemMtimeByPathWithMeta(roots, limits)
  const afterSnapshot = after.snapshot
  const changedPaths = new Set<string>()

  for (const [filePath, mtime] of beforeSnapshot.entries()) {
    const afterMtime = afterSnapshot.get(filePath)
    if (afterMtime === undefined || afterMtime !== mtime) {
      changedPaths.add(filePath)
    }
  }

  for (const [filePath, _mtime] of afterSnapshot.entries()) {
    if (!beforeSnapshot.has(filePath)) {
      changedPaths.add(filePath)
    }
  }
  const totalChanged = changedPaths.size
  if (after.truncated) {
    logEvent('tengu_bash_file_snapshot_truncated', {
      tracked_files: beforeSnapshot.size,
      scanned_files: afterSnapshot.size,
      changed_files: totalChanged,
      command_type: metadata.commandType,
      tool_name: metadata.toolName,
      permission_mode: metadata.permissionMode,
    })
    logForDebugging(
      `[BashTool] File snapshot truncated at ${limits.snapshotLimit} files; some changes may not be reported.`,
    )
  }

  let notified = 0
  for (const filePath of changedPaths) {
    if (notified >= limits.notifyLimit) {
      break
    }
    const existsAfter = afterSnapshot.has(filePath)
    const newContent = existsAfter
      ? readFileForBashNotification(filePath, limits)
      : null
    notifyFileUpdated(filePath, null, newContent, {
      syncLsp: true,
      clearLspDiagnostics: true,
    })
    readFileState.delete(filePath)
    notified += 1
  }
  if (totalChanged > limits.notifyLimit) {
    logEvent('tengu_bash_file_notify_capped', {
      changed_files: totalChanged,
      notified_files: notified,
      skipped_files: totalChanged - notified,
      command_type: metadata.commandType,
      tool_name: metadata.toolName,
      permission_mode: metadata.permissionMode,
    })
    logForDebugging(
      `[BashTool] File update notifications capped at ${limits.notifyLimit}; skipped ${totalChanged - notified} changes.`,
    )
  }
}
