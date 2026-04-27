import { beforeEach, describe, expect, mock, test } from 'bun:test'

type FakeFile = {
  mtimeMs: number
  content: string
}

type FakeState = {
  dirs: Set<string>
  files: Map<string, FakeFile>
  symlinks?: Set<string>
}

let currentState: FakeState
const notifyFileUpdatedMock = mock(() => {})
const logEventMock = mock(() => {})
const logForDebuggingMock = mock(() => {})

function listDirEntries(state: FakeState, dirPath: string): string[] {
  const normalizedPrefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`
  const out = new Set<string>()

  for (const path of state.dirs) {
    if (!path.startsWith(normalizedPrefix)) continue
    const rest = path.slice(normalizedPrefix.length)
    if (!rest || rest.includes('/')) continue
    out.add(rest)
  }
  for (const path of state.files.keys()) {
    if (!path.startsWith(normalizedPrefix)) continue
    const rest = path.slice(normalizedPrefix.length)
    if (!rest || rest.includes('/')) continue
    out.add(rest)
  }
  for (const path of state.symlinks ?? []) {
    if (!path.startsWith(normalizedPrefix)) continue
    const rest = path.slice(normalizedPrefix.length)
    if (!rest || rest.includes('/')) continue
    out.add(rest)
  }

  return [...out].sort()
}

function makeFs() {
  return {
    lstatSync(path: string) {
      if (currentState.symlinks?.has(path)) {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => false,
          mtimeMs: 0,
        }
      }
      if (currentState.dirs.has(path)) {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
          mtimeMs: 0,
        }
      }
      const file = currentState.files.get(path)
      if (!file) throw new Error(`ENOENT: ${path}`)
      return {
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: file.mtimeMs,
      }
    },
    readdirStringSync(path: string) {
      if (!currentState.dirs.has(path)) throw new Error(`ENOENT: ${path}`)
      return listDirEntries(currentState, path)
    },
    statSync(path: string) {
      const file = currentState.files.get(path)
      if (!file) throw new Error(`ENOENT: ${path}`)
      return {
        isFile: () => true,
        size: Buffer.byteLength(file.content, 'utf8'),
      }
    },
    readFileSync(path: string, _opts: { encoding: BufferEncoding }) {
      const file = currentState.files.get(path)
      if (!file) throw new Error(`ENOENT: ${path}`)
      return file.content
    },
  }
}

mock.module('src/utils/fsOperations.js', () => ({
  getFsImplementation: () => makeFs(),
}))

mock.module('src/utils/fileUpdateNotifier.js', () => ({
  notifyFileUpdated: notifyFileUpdatedMock,
}))

mock.module('src/services/analytics/index.js', () => ({
  logEvent: logEventMock,
}))

mock.module('src/utils/debug.js', () => ({
  logForDebugging: logForDebuggingMock,
}))

const { notifyBashFilesystemUpdates, snapshotFilesystemMtimeByPath } =
  await import('../fileChangeNotifications.js')

describe('bash file change notifications', () => {
  beforeEach(() => {
    notifyFileUpdatedMock.mockClear()
    logEventMock.mockClear()
    logForDebuggingMock.mockClear()
  })

  test('notifies on modified file and clears read cache', () => {
    currentState = {
      dirs: new Set(['/ws']),
      files: new Map([
        ['/ws/a.txt', { mtimeMs: 1000, content: 'old' }],
      ]),
    }
    const before = snapshotFilesystemMtimeByPath(['/ws'])
    currentState = {
      dirs: new Set(['/ws']),
      files: new Map([
        ['/ws/a.txt', { mtimeMs: 2000, content: 'new' }],
      ]),
    }

    const deleted: string[] = []
    notifyBashFilesystemUpdates(before, ['/ws'], {
      delete(path: string) {
        deleted.push(path)
        return true
      },
    })

    expect(notifyFileUpdatedMock).toHaveBeenCalledTimes(1)
    expect(notifyFileUpdatedMock).toHaveBeenCalledWith('/ws/a.txt', null, 'new', {
      syncLsp: true,
      clearLspDiagnostics: true,
    })
    expect(deleted).toEqual(['/ws/a.txt'])
  })

  test('notifies on new and deleted files', () => {
    currentState = {
      dirs: new Set(['/ws']),
      files: new Map([
        ['/ws/old.txt', { mtimeMs: 1000, content: 'bye' }],
      ]),
    }
    const before = snapshotFilesystemMtimeByPath(['/ws'])

    currentState = {
      dirs: new Set(['/ws']),
      files: new Map([
        ['/ws/new.txt', { mtimeMs: 2000, content: 'hello' }],
      ]),
    }

    const deleted: string[] = []
    notifyBashFilesystemUpdates(before, ['/ws'], {
      delete(path: string) {
        deleted.push(path)
        return true
      },
    })

    expect(notifyFileUpdatedMock).toHaveBeenCalledTimes(2)
    const calls = notifyFileUpdatedMock.mock.calls.map(call => call.slice(0, 3))
    expect(calls).toContainEqual(['/ws/old.txt', null, null])
    expect(calls).toContainEqual(['/ws/new.txt', null, 'hello'])
    expect(deleted.sort()).toEqual(['/ws/new.txt', '/ws/old.txt'])
  })

  test('snapshot skips symlink entries', () => {
    currentState = {
      dirs: new Set(['/ws']),
      files: new Map([
        ['/ws/real.txt', { mtimeMs: 1000, content: 'x' }],
      ]),
      symlinks: new Set(['/ws/link.txt']),
    }
    const snapshot = snapshotFilesystemMtimeByPath(['/ws'])
    expect(snapshot.has('/ws/real.txt')).toBe(true)
    expect(snapshot.has('/ws/link.txt')).toBe(false)
  })

  test('caps notifications and emits observability signals', () => {
    currentState = {
      dirs: new Set(['/ws']),
      files: new Map([
        ['/ws/a.txt', { mtimeMs: 1000, content: 'a' }],
        ['/ws/b.txt', { mtimeMs: 1000, content: 'b' }],
        ['/ws/c.txt', { mtimeMs: 1000, content: 'c' }],
      ]),
    }
    const before = snapshotFilesystemMtimeByPath(['/ws'])

    currentState = {
      dirs: new Set(['/ws']),
      files: new Map([
        ['/ws/a.txt', { mtimeMs: 2000, content: 'aa' }],
        ['/ws/b.txt', { mtimeMs: 2000, content: 'bb' }],
        ['/ws/c.txt', { mtimeMs: 2000, content: 'cc' }],
      ]),
    }

    notifyBashFilesystemUpdates(before, ['/ws'], {
      delete() {
        return true
      },
    }, {
      snapshotLimit: 100,
      notifyLimit: 2,
      contentReadLimitBytes: 1024 * 1024,
    }, {
      commandType: 'cp' as never,
      toolName: 'Bash' as never,
      permissionMode: 'acceptEdits' as never,
    })

    expect(notifyFileUpdatedMock).toHaveBeenCalledTimes(2)
    const cappedCall = logEventMock.mock.calls.find(
      call => call[0] === 'tengu_bash_file_notify_capped',
    )
    expect(Boolean(cappedCall)).toBe(true)
    expect(cappedCall?.[1]?.command_type).toBe('cp')
    expect(cappedCall?.[1]?.tool_name).toBe('Bash')
    expect(cappedCall?.[1]?.permission_mode).toBe('acceptEdits')
    expect(
      logForDebuggingMock.mock.calls.some(call =>
        String(call[0]).includes('File update notifications capped'),
      ),
    ).toBe(true)
  })

  test('emits snapshot truncation telemetry when scan is truncated', () => {
    currentState = {
      dirs: new Set(['/ws']),
      files: new Map([
        ['/ws/a.txt', { mtimeMs: 1000, content: 'a' }],
        ['/ws/b.txt', { mtimeMs: 1000, content: 'b' }],
        ['/ws/c.txt', { mtimeMs: 1000, content: 'c' }],
      ]),
    }

    notifyBashFilesystemUpdates(new Map<string, number>(), ['/ws'], {
      delete() {
        return true
      },
    }, {
      snapshotLimit: 1,
      notifyLimit: 10,
      contentReadLimitBytes: 1024 * 1024,
    }, {
      commandType: 'rm' as never,
      toolName: 'Bash' as never,
      permissionMode: 'auto' as never,
    })

    const truncatedCall = logEventMock.mock.calls.find(
      call => call[0] === 'tengu_bash_file_snapshot_truncated',
    )
    expect(Boolean(truncatedCall)).toBe(true)
    expect(truncatedCall?.[1]?.command_type).toBe('rm')
    expect(truncatedCall?.[1]?.tool_name).toBe('Bash')
    expect(truncatedCall?.[1]?.permission_mode).toBe('auto')
    expect(
      logForDebuggingMock.mock.calls.some(call =>
        String(call[0]).includes('File snapshot truncated'),
      ),
    ).toBe(true)
  })
})
