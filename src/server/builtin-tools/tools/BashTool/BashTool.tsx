import { feature } from 'bun:bundle'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import {
  copyFile,
  mkdtemp as fsMkdtemp,
  mkdir as fsMkdir,
  readdir as fsReaddir,
  readFile as fsReadFile,
  rm as fsRm,
  stat as fsStat,
  truncate as fsTruncate,
  writeFile as fsWriteFile,
  link,
} from 'fs/promises'
import * as nodeFs from 'fs'
import * as React from 'react'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { AppState } from 'src/state/AppState.js'
import { z } from 'zod/v4'
import path from 'node:path'
import { getKairosActive, getOriginalCwd } from 'src/bootstrap/state.js'
import { TOOL_SUMMARY_MAX_LENGTH } from 'src/constants/toolLimits.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import type {
  SetToolJSXFn,
  ToolCallProgress,
  ToolUseContext,
  ValidationResult,
} from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import {
  backgroundExistingForegroundTask,
  markTaskNotified,
  registerForeground,
  spawnShellTask,
  unregisterForeground,
} from 'src/tasks/LocalShellTask/LocalShellTask.js'
import type { AgentId } from 'src/types/ids.js'
import type { AssistantMessage } from 'src/types/message.js'
import { parseForSecurity } from 'src/utils/bash/ast.js'
import {
  splitCommand_DEPRECATED,
  splitCommandWithOperators,
} from 'src/utils/bash/commands.js'
import { extractClaudeCodeHints } from 'src/utils/claudeCodeHints.js'
import { detectCodeIndexingFromCommand } from 'src/utils/codeIndexing.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { isENOENT, ShellError } from 'src/utils/errors.js'
import {
  detectFileEncoding,
  detectLineEndings,
  getFileModificationTime,
  maskVirtualPathForDisplay,
  writeTextContent,
} from 'src/utils/file.js'
import {
  fileHistoryEnabled,
  fileHistoryTrackEdit,
} from 'src/utils/fileHistory.js'
import { notifyFileUpdated } from 'src/utils/fileUpdateNotifier.js'
import { truncate } from 'src/utils/format.js'
import { getFsImplementation, getVirtualProjectRoot } from 'src/utils/fsOperations.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { expandPath } from 'src/utils/path.js'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import { maybeRecordPluginHint } from 'src/utils/plugins/hintRecommendation.js'
import { exec } from 'src/utils/Shell.js'
import type { ExecResult } from 'src/utils/ShellCommand.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import { semanticBoolean } from 'src/utils/semanticBoolean.js'
import { semanticNumber } from 'src/utils/semanticNumber.js'
import { EndTruncatingAccumulator } from 'src/utils/stringUtils.js'
import { getTaskOutputPath } from 'src/utils/task/diskOutput.js'
import { TaskOutput } from 'src/utils/task/TaskOutput.js'
import { isOutputLineTruncated } from 'src/utils/terminal.js'
import {
  buildLargeToolResultMessage,
  ensureToolResultsDir,
  generatePreview,
  getToolResultPath,
  PREVIEW_SIZE_BYTES,
} from 'src/utils/toolResultStorage.js'
import { maskAbsolutePathsInText } from 'src/utils/virtualPathMasking.js'
import { userFacingName as fileEditUserFacingName } from '../FileEditTool/UI.js'
import { trackGitOperations } from '../shared/gitOperationTracking.js'
import {
  bashToolHasPermission,
  commandHasAnyCd,
  matchWildcardPattern,
  permissionRuleExtractPrefix,
} from './bashPermissions.js'
import { interpretCommandResult } from './commandSemantics.js'
import {
  getDefaultTimeoutMs,
  getMaxTimeoutMs,
  getSimplePrompt,
} from './prompt.js'
import { checkReadOnlyConstraints } from './readOnlyValidation.js'
import { parseSedEditCommand } from './sedEditParser.js'
import { shouldUseSandbox } from './shouldUseSandbox.js'
import { BASH_TOOL_NAME } from './toolName.js'
import {
  BackgroundHint,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseQueuedMessage,
} from './UI.js'
import {
  buildImageToolResult,
  isImageOutput,
  resetCwdIfOutsideProject,
  resizeShellImageOutput,
  stdErrAppendShellResetMessage,
  stripEmptyLines,
} from './utils.js'
import {
  notifyBashFilesystemUpdates,
  snapshotFilesystemMtimeByPath,
} from './fileChangeNotifications.js'

const EOL = '\n'

// Progress display constants
const PROGRESS_THRESHOLD_MS = 2000 // Show progress after 2 seconds
// In assistant mode, blocking bash auto-backgrounds after this many ms in the main agent
const ASSISTANT_BLOCKING_BUDGET_MS = 15_000

// Search commands for collapsible display (grep, find, etc.)
const BASH_SEARCH_COMMANDS = new Set([
  'find',
  'grep',
  'rg',
  'ag',
  'ack',
  'locate',
  'which',
  'whereis',
])

// Read/view commands for collapsible display (cat, head, etc.)
const BASH_READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  // Analysis commands
  'wc',
  'stat',
  'file',
  'strings',
  // Data processing — commonly used to parse/transform file content in pipes
  'jq',
  'awk',
  'cut',
  'sort',
  'uniq',
  'tr',
])

// Directory-listing commands for collapsible display (ls, tree, du).
// Split from BASH_READ_COMMANDS so the summary says "Listed N directories"
// instead of the misleading "Read N files".
const BASH_LIST_COMMANDS = new Set(['ls', 'tree', 'du'])

// Commands that are semantic-neutral in any position — pure output/status commands
// that don't change the read/search nature of the overall pipeline.
// e.g. `ls dir && echo "---" && ls dir2` is still a read-only compound command.
const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set([
  'echo',
  'printf',
  'true',
  'false',
  ':', // bash no-op
])

// Commands that typically produce no stdout on success
const BASH_SILENT_COMMANDS = new Set([
  'mv',
  'cp',
  'rm',
  'mkdir',
  'rmdir',
  'chmod',
  'chown',
  'chgrp',
  'touch',
  'ln',
  'cd',
  'export',
  'unset',
  'wait',
])

const VIRTUAL_BASH_ALLOWED_COMMANDS = new Set(['ls', 'pwd', 'cat', 'echo'])
const VIRTUAL_WASI_FILE_LIMIT = 5000
const VIRTUAL_WASI_BYTE_LIMIT = 20 * 1024 * 1024
const VIRTUAL_HOST_SESSION_TTL_MS = 15 * 60 * 1000

type VirtualHostWorkspaceSession = {
  virtualProjectRoot: string
  stagingRoot: string
  workspaceDir: string
  lastUsedAt: number
  ptyShell?: string
  ptyProcess?: {
    write: (data: string) => void
    kill: (signal?: string) => void
    onData: (cb: (data: string) => void) => { dispose: () => void }
    onExit: (
      cb: (event: { exitCode: number; signal?: number }) => void,
    ) => { dispose: () => void }
    cols: number
    rows: number
  }
  ptyQueue: Promise<void>
}

const virtualHostWorkspaceSessions = new Map<string, VirtualHostWorkspaceSession>()
let virtualHostWorkspaceJanitorStarted = false

function getDirEntryName(entry: string | { name: string }): string {
  return typeof entry === 'string' ? entry : entry.name
}

function tokenizeShellLike(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) || []
  return matches.map(part => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1)
    }
    return part
  })
}

function hasUnsupportedShellSyntax(command: string): boolean {
  return /[|;&><`$]/.test(command)
}

function formatMode(mode: number, isDirectory: boolean): string {
  const type = isDirectory ? 'd' : '-'
  const perms = [
    0o400, 0o200, 0o100, // user
    0o040, 0o020, 0o010, // group
    0o004, 0o002, 0o001, // other
  ]
  const chars = ['r', 'w', 'x', 'r', 'w', 'x', 'r', 'w', 'x']
  let out = type
  for (let i = 0; i < perms.length; i++) {
    out += (mode & perms[i]!) !== 0 ? chars[i] : '-'
  }
  return out
}

function formatLsTime(value: Date): string {
  const month = value.toLocaleString('en-US', { month: 'short' })
  const day = String(value.getDate()).padStart(2, ' ')
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  return `${month} ${day} ${hour}:${minute}`
}

function isInsideVirtualRoot(candidatePath: string, rootPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath)
  const resolvedCandidate = path.resolve(candidatePath)
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  )
}

function maskVirtualPathsInText(input: string): string {
  return maskAbsolutePathsInText(input, maskVirtualPathForDisplay)
}

function startVirtualHostWorkspaceJanitor(): void {
  if (virtualHostWorkspaceJanitorStarted) return
  virtualHostWorkspaceJanitorStarted = true
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, session] of virtualHostWorkspaceSessions.entries()) {
      if (now - session.lastUsedAt <= VIRTUAL_HOST_SESSION_TTL_MS) continue
      virtualHostWorkspaceSessions.delete(key)
      try {
        session.ptyProcess?.kill('SIGKILL')
      } catch {
        // ignore
      }
      void fsRm(session.stagingRoot, { recursive: true, force: true }).catch(() => {})
    }
  }, 60_000)
  timer.unref()
}

function getVirtualWasiMap(): Record<string, string> {
  const raw = process.env.CLAUDE_CODE_VIRTUAL_WASI_COMMAND_MAP
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const map: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) {
        map[key.trim()] = value.trim()
      }
    }
    return map
  } catch {
    return {}
  }
}

function collectBashFilesystemRoots(context: Pick<ToolUseContext, 'getAppState'>): string[] {
  const roots = new Set<string>()
  const fs = getFsImplementation()
  const virtualProjectRoot = (getVirtualProjectRoot() || '').trim()
  if (virtualProjectRoot) {
    roots.add(path.resolve(virtualProjectRoot))
    return Array.from(roots)
  }

  roots.add(path.resolve(getOriginalCwd()))
  roots.add(path.resolve(fs.cwd()))
  const appState = context.getAppState()
  for (const dir of appState.toolPermissionContext.additionalWorkingDirectories.keys()) {
    roots.add(path.resolve(dir))
  }
  return Array.from(roots)
}

async function materializeVirtualTreeToHost(
  virtualFs: ReturnType<typeof getFsImplementation>,
  virtualDir: string,
  hostDir: string,
): Promise<void> {
  let fileCount = 0
  let byteCount = 0

  const walk = async (currentVirtual: string, currentHost: string) => {
    await fsMkdir(currentHost, { recursive: true })
    const entries = virtualFs.readdirSync(currentVirtual)
    for (const entry of entries) {
      const entryName = getDirEntryName(entry)
      const source = path.join(currentVirtual, entryName)
      const target = path.join(currentHost, entryName)
      const stat = virtualFs.statSync(source)
      if (stat.isDirectory()) {
        await walk(source, target)
        continue
      }
      if (!stat.isFile()) continue
      fileCount += 1
      byteCount += stat.size
      if (fileCount > VIRTUAL_WASI_FILE_LIMIT || byteCount > VIRTUAL_WASI_BYTE_LIMIT) {
        throw new Error(
          `Virtual WASI staging exceeded limits (files>${VIRTUAL_WASI_FILE_LIMIT} or bytes>${VIRTUAL_WASI_BYTE_LIMIT}).`,
        )
      }
      const bytes = virtualFs.readFileBytesSync(source)
      await fsWriteFile(target, bytes)
    }
  }

  await walk(virtualDir, hostDir)
}

async function runVirtualWasiCommand(
  command: string,
  tokens: string[],
  virtualProjectRoot: string,
  cwd: string,
  fs: ReturnType<typeof getFsImplementation>,
): Promise<{ code: number; stdout: string; stderr: string } | null> {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_VIRTUAL_WASI_BASH || '')) {
    return null
  }

  const wasiMap = getVirtualWasiMap()
  const base = tokens[0] || ''
  const wasmPath = wasiMap[base]
  if (!wasmPath) return null

  const strict = isEnvTruthy(process.env.CLAUDE_CODE_VIRTUAL_WASI_STRICT || 'false')

  let WASIClass: any
  try {
    const wasiModule = await import('node:wasi')
    WASIClass = wasiModule.WASI
  } catch (error) {
    if (!strict) return null
    return {
      code: 127,
      stdout: '',
      stderr:
        error instanceof Error
          ? `Virtual WASI runtime unavailable: ${maskVirtualPathsInText(error.message)}`
          : 'Virtual WASI runtime unavailable.',
    }
  }

  const relativeCwd = path.relative(virtualProjectRoot, cwd)
  if (relativeCwd.startsWith('..')) {
    return {
      code: 1,
      stdout: '',
      stderr: `Working directory "${maskVirtualPathForDisplay(cwd)}" is outside the project sandbox.`,
    }
  }

  const os = await import('node:os')
  const stagingRoot = await fsMkdtemp(path.join(os.tmpdir(), 'claude-virtual-wasi-'))
  const workspaceDir = path.join(stagingRoot, 'workspace')
  const stdoutPath = path.join(stagingRoot, 'stdout.log')
  const stderrPath = path.join(stagingRoot, 'stderr.log')

  try {
    await materializeVirtualTreeToHost(fs, virtualProjectRoot, workspaceDir)
    const moduleBuffer = await fsReadFile(wasmPath)
    const stdoutFd = nodeFs.openSync(stdoutPath, 'w+')
    const stderrFd = nodeFs.openSync(stderrPath, 'w+')

    let exitCode = 0
    try {
      const wasi = new WASIClass({
        version: 'preview1',
        args: tokens,
        env: {
          PWD: path.posix.join('/workspace', relativeCwd.replace(/\\/g, '/')),
        },
        preopens: {
          '/workspace': workspaceDir,
        },
        stdout: stdoutFd,
        stderr: stderrFd,
        returnOnExit: true,
      })
      const module = await WebAssembly.compile(moduleBuffer)
      const instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasi.wasiImport,
        wasi_unstable: wasi.wasiImport,
      } as Record<string, unknown>)
      const result = wasi.start(instance as WebAssembly.Instance)
      if (typeof result === 'number') exitCode = result
    } catch (error) {
      if (!strict) return null
      return {
        code: 126,
        stdout: '',
        stderr:
          error instanceof Error
            ? `Virtual WASI execution failed: ${maskVirtualPathsInText(error.message)}`
            : 'Virtual WASI execution failed.',
      }
    } finally {
      nodeFs.closeSync(stdoutFd)
      nodeFs.closeSync(stderrFd)
    }

    const [stdout, stderr] = await Promise.all([
      fsReadFile(stdoutPath, 'utf8').catch(() => ''),
      fsReadFile(stderrPath, 'utf8').catch(() => ''),
    ])

    return { code: exitCode, stdout, stderr }
  } finally {
    await fsRm(stagingRoot, { recursive: true, force: true }).catch(() => {})
  }
}

function normalizeRelativePathForSet(input: string): string {
  return input.split(path.sep).join('/')
}

function commandReferencesDisallowedPath(command: string): string | null {
  // Block explicit absolute/home/parent-traversal paths at shell-token level.
  // This avoids false positives for relative paths containing '/'.
  const tokens = tokenizeShellLike(command.trim())
  for (const token of tokens) {
    const t = token.trim()
    if (!t) continue
    if (t === '&&' || t === '||' || t === '|' || t === ';') continue

    if (
      t === '~' ||
      t.startsWith('~/') ||
      t.startsWith('~\\') ||
      t.startsWith('file://~')
    ) {
      return 'home-path "~"'
    }

    if (t === '..' || t.startsWith('../') || t.startsWith('..\\')) {
      return 'parent-traversal ".."'
    }

    if (t.startsWith('/') || t.startsWith('file:///')) {
      return 'absolute path'
    }
  }
  return null
}

function collectVirtualFileSet(
  fs: ReturnType<typeof getFsImplementation>,
  virtualRoot: string,
): Set<string> {
  const out = new Set<string>()
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      const entryName = getDirEntryName(entry)
      const absPath = path.join(dir, entryName)
      const stat = fs.statSync(absPath)
      if (stat.isDirectory()) {
        walk(absPath)
        continue
      }
      if (!stat.isFile()) continue
      const relPath = path.relative(virtualRoot, absPath)
      out.add(normalizeRelativePathForSet(relPath))
    }
  }
  walk(virtualRoot)
  return out
}

async function executeInHostShellFromVirtualWorkspace(
  command: string,
  cwd: string,
  workspaceRoot: string,
  timeoutMs: number,
  session?: VirtualHostWorkspaceSession,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const shell =
    process.platform === 'win32'
      ? process.env.ComSpec || 'cmd.exe'
      : process.env.SHELL || '/bin/bash'
  const shellArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', command]
      : ['-lc', command]

  const tmpDir = path.join(workspaceRoot, '.tmp')
  const cacheDir = path.join(workspaceRoot, '.cache')
  const stateDir = path.join(workspaceRoot, '.state')
  const configDir = path.join(workspaceRoot, '.config')
  await fsMkdir(tmpDir, { recursive: true })
  await fsMkdir(cacheDir, { recursive: true })
  await fsMkdir(stateDir, { recursive: true })
  await fsMkdir(configDir, { recursive: true })

  const env = {
    ...process.env,
    HOME: workspaceRoot,
    USERPROFILE: workspaceRoot,
    TMPDIR: tmpDir,
    TMP: tmpDir,
    TEMP: tmpDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_STATE_HOME: stateDir,
    XDG_CONFIG_HOME: configDir,
  }

  // Prefer PTY for terminal-like behavior (ANSI/color, tool output parity).
  // Fall back to plain spawn when node-pty is unavailable at runtime.
  if (session) {
    const ptyMod = await import('node-pty')
    const ptyShell =
      session.ptyShell ||
      (process.platform === 'win32'
        ? process.env.ComSpec || 'cmd.exe'
        : process.env.SHELL || '/bin/bash')
    if (!session.ptyProcess) {
      session.ptyShell = ptyShell
      session.ptyProcess = ptyMod.spawn(ptyShell, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: workspaceRoot,
        env,
        encoding: 'utf8',
      })
      const disposeExit = session.ptyProcess.onExit(() => {
        disposeExit.dispose()
        session.ptyProcess = undefined
      })
    }

    const runWithPty = async () =>
      await new Promise<{ code: number; stdout: string; stderr: string }>(
        resolve => {
          const p = session.ptyProcess
          if (!p) {
            resolve({
              code: 126,
              stdout: '',
              stderr: 'Virtual PTY session unavailable.',
            })
            return
          }

          const markerId = randomUUID()
          const marker = `__CLAUDE_VPTY_DONE_${markerId}__`
          const quotedCwd = cwd.replace(/'/g, `'\\''`)
          const quotedCommand = command.replace(/'/g, `'\\''`)
          const wrapped =
            process.platform === 'win32'
              ? `cd /d "${cwd}" && (${command})\r`
              : `cd '${quotedCwd}' && { ${quotedCommand}; }; __claude_code_rc=$?; printf "\\n${marker}:%s\\n" "$__claude_code_rc"\r`

          let buffer = ''
          let timeoutHandle: NodeJS.Timeout | undefined
          let hardKillHandle: NodeJS.Timeout | undefined
          let settled = false
          const settle = (result: {
            code: number
            stdout: string
            stderr: string
          }) => {
            if (settled) return
            settled = true
            if (timeoutHandle) clearTimeout(timeoutHandle)
            if (hardKillHandle) clearTimeout(hardKillHandle)
            dataDisp.dispose()
            resolve(result)
          }

          const markerRegex = new RegExp(`${marker}:(-?\\d+)`)
          const dataDisp = p.onData((data: string) => {
            buffer += data
            const m = markerRegex.exec(buffer)
            if (!m) return
            const exitCode = Number.parseInt(m[1] || '1', 10)
            const content = buffer.slice(0, m.index).replace(/\r\n/g, '\n')
            settle({
              code: Number.isFinite(exitCode) ? exitCode : 1,
              stdout: content,
              stderr: '',
            })
          })

          if (timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
              p.write('\u0003')
              hardKillHandle = setTimeout(() => {
                try {
                  p.kill('SIGKILL')
                } catch {
                  // ignore
                }
                settle({
                  code: 124,
                  stdout: buffer,
                  stderr: `Command timed out after ${timeoutMs}ms in virtual PTY shell.`,
                })
              }, 2_000)
            }, timeoutMs)
          }

          p.write(wrapped)
        },
      )

    const queued = session.ptyQueue.then(runWithPty, runWithPty)
    session.ptyQueue = queued.then(
      () => undefined,
      () => undefined,
    )
    return await queued
  }

  return await new Promise(resolve => {
    const child = spawn(shell, shellArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let timeoutHandle: NodeJS.Timeout | undefined
    let hardKillHandle: NodeJS.Timeout | undefined

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        hardKillHandle = setTimeout(() => child.kill('SIGKILL'), 2_000)
      }, timeoutMs)
    }

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', error => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (hardKillHandle) clearTimeout(hardKillHandle)
      resolve({
        code: 126,
        stdout,
        stderr:
          stderr +
          (stderr.endsWith('\n') || stderr.length === 0 ? '' : '\n') +
          `Virtual host shell failed: ${maskVirtualPathsInText(error.message)}`,
      })
    })

    child.on('close', code => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (hardKillHandle) clearTimeout(hardKillHandle)
      if (timedOut) {
        resolve({
          code: 124,
          stdout,
          stderr:
            stderr +
            (stderr.endsWith('\n') || stderr.length === 0 ? '' : '\n') +
            `Command timed out after ${timeoutMs}ms in virtual host shell.`,
        })
        return
      }
      resolve({
        code: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
      })
    })
  })
}

async function syncHostWorkspaceBackToVirtualFs(
  fs: ReturnType<typeof getFsImplementation>,
  hostWorkspaceRoot: string,
  virtualProjectRoot: string,
  beforeFiles: Set<string>,
): Promise<void> {
  const afterFiles = new Set<string>()

  const walkHost = async (dir: string) => {
    const entries = await fsReaddir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const hostAbsPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walkHost(hostAbsPath)
        continue
      }
      if (!entry.isFile()) continue

      const relPath = normalizeRelativePathForSet(
        path.relative(hostWorkspaceRoot, hostAbsPath),
      )
      afterFiles.add(relPath)

      const virtualAbsPath = path.join(virtualProjectRoot, relPath)
      fs.mkdirSync(path.dirname(virtualAbsPath))
      const bytes = await fsReadFile(hostAbsPath)
      fs.writeFileSync(virtualAbsPath, bytes)
    }
  }

  await walkHost(hostWorkspaceRoot)

  for (const relPath of beforeFiles) {
    if (afterFiles.has(relPath)) continue
    const virtualAbsPath = path.join(virtualProjectRoot, relPath)
    if (fs.existsSync(virtualAbsPath)) {
      fs.rmSync(virtualAbsPath, { force: true })
    }
  }
}

async function syncVirtualFsIntoHostWorkspace(
  fs: ReturnType<typeof getFsImplementation>,
  virtualProjectRoot: string,
  hostWorkspaceRoot: string,
): Promise<void> {
  const virtualFiles = collectVirtualFileSet(fs, virtualProjectRoot)
  const hostFiles = new Set<string>()

  const walkVirtual = async (virtualDir: string) => {
    const entries = fs.readdirSync(virtualDir)
    for (const entry of entries) {
      const entryName = getDirEntryName(entry)
      const virtualAbsPath = path.join(virtualDir, entryName)
      const relPath = normalizeRelativePathForSet(
        path.relative(virtualProjectRoot, virtualAbsPath),
      )
      const hostAbsPath = path.join(hostWorkspaceRoot, relPath)

      const stat = fs.statSync(virtualAbsPath)
      if (stat.isDirectory()) {
        await fsMkdir(hostAbsPath, { recursive: true })
        await walkVirtual(virtualAbsPath)
        continue
      }
      if (!stat.isFile()) continue

      hostFiles.add(relPath)
      await fsMkdir(path.dirname(hostAbsPath), { recursive: true })
      const bytes = fs.readFileBytesSync(virtualAbsPath)
      await fsWriteFile(hostAbsPath, bytes)
    }
  }

  const walkHost = async (hostDir: string) => {
    const entries = await fsReaddir(hostDir, { withFileTypes: true })
    for (const entry of entries) {
      const hostAbsPath = path.join(hostDir, entry.name)
      const relPath = normalizeRelativePathForSet(
        path.relative(hostWorkspaceRoot, hostAbsPath),
      )
      if (entry.isDirectory()) {
        await walkHost(hostAbsPath)
        continue
      }
      if (!entry.isFile()) continue
      hostFiles.add(relPath)
    }
  }

  await walkVirtual(virtualProjectRoot)
  await walkHost(hostWorkspaceRoot)

  for (const relPath of hostFiles) {
    if (virtualFiles.has(relPath)) continue
    const hostAbsPath = path.join(hostWorkspaceRoot, relPath)
    await fsRm(hostAbsPath, { force: true }).catch(() => {})
  }
}

async function getOrCreateVirtualHostWorkspaceSession(
  fs: ReturnType<typeof getFsImplementation>,
  virtualProjectRoot: string,
): Promise<VirtualHostWorkspaceSession> {
  startVirtualHostWorkspaceJanitor()
  const key = path.resolve(virtualProjectRoot)
  const existing = virtualHostWorkspaceSessions.get(key)
  if (existing) {
    existing.lastUsedAt = Date.now()
    await syncVirtualFsIntoHostWorkspace(fs, virtualProjectRoot, existing.workspaceDir)
    return existing
  }

  const os = await import('node:os')
  const stagingRoot = await fsMkdtemp(
    path.join(os.tmpdir(), 'claude-virtual-shell-session-'),
  )
  const workspaceDir = path.join(stagingRoot, 'workspace')
  await materializeVirtualTreeToHost(fs, virtualProjectRoot, workspaceDir)
  const session: VirtualHostWorkspaceSession = {
    virtualProjectRoot: key,
    stagingRoot,
    workspaceDir,
    lastUsedAt: Date.now(),
    ptyQueue: Promise.resolve(),
  }
  virtualHostWorkspaceSessions.set(key, session)
  return session
}

async function runVirtualHostShellCommand(
  command: string,
  virtualProjectRoot: string,
  cwd: string,
  fs: ReturnType<typeof getFsImplementation>,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const disallowed = commandReferencesDisallowedPath(command)
  if (disallowed) {
    return {
      code: 2,
      stdout: '',
      stderr: `Virtual host shell blocked: detected ${disallowed}. Use paths relative to the virtual workspace only.`,
    }
  }

  const session = await getOrCreateVirtualHostWorkspaceSession(fs, virtualProjectRoot)
  try {
    const beforeFiles = collectVirtualFileSet(fs, virtualProjectRoot)

    const relativeCwd = path.relative(virtualProjectRoot, cwd)
    if (relativeCwd.startsWith('..')) {
      return {
        code: 1,
        stdout: '',
        stderr: `Working directory "${maskVirtualPathForDisplay(cwd)}" is outside the project sandbox.`,
      }
    }
    const hostCwd = path.resolve(session.workspaceDir, relativeCwd || '.')

    const result = await executeInHostShellFromVirtualWorkspace(
      command,
      hostCwd,
      session.workspaceDir,
      timeoutMs,
      session,
    )

    await syncHostWorkspaceBackToVirtualFs(
      fs,
      session.workspaceDir,
      virtualProjectRoot,
      beforeFiles,
    )
    session.lastUsedAt = Date.now()
    return result
  } finally {
    session.lastUsedAt = Date.now()
  }
}

async function runVirtualBashCommand(
  command: string,
  virtualProjectRoot: string,
  workingPath?: string,
  timeoutMs = getDefaultTimeoutMs(),
): Promise<{ code: number; stdout: string; stderr: string }> {
  const tokens = tokenizeShellLike(command.trim())
  if (tokens.length === 0) {
    return { code: 0, stdout: '', stderr: '' }
  }
  const base = tokens[0] || ''
  const fs = getFsImplementation()
  let cwd = fs.cwd()
  if (workingPath && workingPath.trim()) {
    const requested = workingPath.trim()
    const resolved = path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(cwd, requested)
    if (!isInsideVirtualRoot(resolved, virtualProjectRoot)) {
      return {
        code: 1,
        stdout: '',
        stderr: `Path "${maskVirtualPathForDisplay(resolved)}" is outside the project sandbox.`,
      }
    }
    try {
      const stat = fs.statSync(resolved)
      if (!stat.isDirectory()) {
        return {
          code: 1,
          stdout: '',
          stderr: `Path "${requested}" is not a directory.`,
        }
      }
      cwd = resolved
    } catch (error) {
      return {
        code: 1,
        stdout: '',
        stderr:
          error instanceof Error
            ? maskVirtualPathsInText(error.message)
            : `Path "${requested}" does not exist.`,
      }
    }
  }
  const resolvePath = (input: string) =>
    path.isAbsolute(input) ? input : path.resolve(cwd, input)

  const wasiResult = await runVirtualWasiCommand(
    command,
    tokens,
    virtualProjectRoot,
    cwd,
    fs,
  )
  if (wasiResult) return wasiResult

  const canUseBuiltinVirtual =
    !hasUnsupportedShellSyntax(command) && VIRTUAL_BASH_ALLOWED_COMMANDS.has(base)
  if (!canUseBuiltinVirtual) {
    return await runVirtualHostShellCommand(
      command,
      virtualProjectRoot,
      cwd,
      fs,
      timeoutMs,
    )
  }

  if (base === 'pwd') {
    return { code: 0, stdout: `${maskVirtualPathForDisplay(cwd)}\n`, stderr: '' }
  }

  if (base === 'echo') {
    return { code: 0, stdout: `${tokens.slice(1).join(' ')}\n`, stderr: '' }
  }

  if (base === 'ls') {
    const args = tokens.slice(1)
    const options = args.filter(arg => arg.startsWith('-'))
    const showAll = options.some(opt => opt.includes('a'))
    const longFormat = options.some(opt => opt.includes('l'))
    const targets = args.filter(arg => !arg.startsWith('-'))
    const paths = targets.length > 0 ? targets : ['.']
    const chunks: string[] = []

    const formatLongLine = (absPath: string, displayName: string): string => {
      const stat = fs.statSync(absPath)
      const mode = formatMode(stat.mode, stat.isDirectory())
      const nlink = String(stat.nlink ?? 1).padStart(2, ' ')
      const uid = String((stat as unknown as { uid?: number }).uid ?? 0).padStart(4, ' ')
      const gid = String((stat as unknown as { gid?: number }).gid ?? 0).padStart(4, ' ')
      const size = String(stat.size).padStart(8, ' ')
      const mtime = formatLsTime(stat.mtime instanceof Date ? stat.mtime : new Date(stat.mtime))
      return `${mode} ${nlink} ${uid} ${gid} ${size} ${mtime} ${displayName}`
    }

    for (const target of paths) {
      const abs = resolvePath(target)
      try {
        const stat = fs.statSync(abs)
        if (stat.isDirectory()) {
          const names = fs
            .readdirStringSync(abs)
            .filter(name => showAll || !name.startsWith('.'))
            .sort((a, b) => a.localeCompare(b))

          if (showAll) {
            names.unshift('..')
            names.unshift('.')
          }

          if (longFormat) {
            const rows = names.map(name => {
              if (name === '.') return formatLongLine(abs, '.')
              if (name === '..') return formatLongLine(path.resolve(abs, '..'), '..')
              return formatLongLine(path.join(abs, name), name)
            })
            chunks.push(rows.join('\n'))
          } else {
            chunks.push(names.join('\n'))
          }
        } else {
          if (longFormat) {
            chunks.push(formatLongLine(abs, path.basename(abs)))
          } else {
            chunks.push(path.basename(abs))
          }
        }
      } catch (error) {
        return {
          code: 1,
          stdout: '',
          stderr:
            error instanceof Error
              ? maskVirtualPathsInText(error.message)
              : `ls: cannot access '${target}'`,
        }
      }
    }
    const stdout = chunks.filter(Boolean).join('\n') + '\n'
    return { code: 0, stdout, stderr: '' }
  }

  if (base === 'cat') {
    const files = tokens.slice(1).filter(arg => !arg.startsWith('-'))
    if (files.length === 0) {
      return { code: 1, stdout: '', stderr: 'cat: missing file operand' }
    }
    const parts: string[] = []
    for (const file of files) {
      const abs = resolvePath(file)
      try {
        const text = fs.readFileSync(abs, { encoding: 'utf8' })
        parts.push(text)
      } catch (error) {
        return {
          code: 1,
          stdout: '',
          stderr:
            error instanceof Error
              ? maskVirtualPathsInText(error.message)
              : `cat: ${file}: unable to read`,
        }
      }
    }
    return { code: 0, stdout: parts.join(''), stderr: '' }
  }

  return {
    code: 2,
    stdout: '',
    stderr: `Virtual Bash command "${base}" is not implemented.`,
  }
}

/**
 * Checks if a bash command is a search or read operation.
 * Used to determine if the command should be collapsed in the UI.
 * Returns an object indicating whether it's a search or read operation.
 *
 * For pipelines (e.g., `cat file | bq`), ALL parts must be search/read commands
 * for the whole command to be considered collapsible.
 *
 * Semantic-neutral commands (echo, printf, true, false, :) are skipped in any
 * position, as they're pure output/status commands that don't affect the read/search
 * nature of the pipeline (e.g. `ls dir && echo "---" && ls dir2` is still a read).
 */
export function isSearchOrReadBashCommand(command: string): {
  isSearch: boolean
  isRead: boolean
  isList: boolean
} {
  let partsWithOperators: string[]
  try {
    partsWithOperators = splitCommandWithOperators(command)
  } catch {
    // If we can't parse the command due to malformed syntax,
    // it's not a search/read command
    return { isSearch: false, isRead: false, isList: false }
  }

  if (partsWithOperators.length === 0) {
    return { isSearch: false, isRead: false, isList: false }
  }

  let hasSearch = false
  let hasRead = false
  let hasList = false
  let hasNonNeutralCommand = false
  let skipNextAsRedirectTarget = false

  for (const part of partsWithOperators) {
    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false
      continue
    }

    if (part === '>' || part === '>>' || part === '>&') {
      skipNextAsRedirectTarget = true
      continue
    }

    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      continue
    }

    const baseCommand = part.trim().split(/\s+/)[0]
    if (!baseCommand) {
      continue
    }

    if (BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      continue
    }

    hasNonNeutralCommand = true

    const isPartSearch = BASH_SEARCH_COMMANDS.has(baseCommand)
    const isPartRead = BASH_READ_COMMANDS.has(baseCommand)
    const isPartList = BASH_LIST_COMMANDS.has(baseCommand)

    if (!isPartSearch && !isPartRead && !isPartList) {
      return { isSearch: false, isRead: false, isList: false }
    }

    if (isPartSearch) hasSearch = true
    if (isPartRead) hasRead = true
    if (isPartList) hasList = true
  }

  // Only neutral commands (e.g., just "echo foo") -- not collapsible
  if (!hasNonNeutralCommand) {
    return { isSearch: false, isRead: false, isList: false }
  }

  return { isSearch: hasSearch, isRead: hasRead, isList: hasList }
}

/**
 * Checks if a bash command is expected to produce no stdout on success.
 * Used to show "Done" instead of "(No output)" in the UI.
 */
function isSilentBashCommand(command: string): boolean {
  let partsWithOperators: string[]
  try {
    partsWithOperators = splitCommandWithOperators(command)
  } catch {
    return false
  }

  if (partsWithOperators.length === 0) {
    return false
  }

  let hasNonFallbackCommand = false
  let lastOperator: string | null = null
  let skipNextAsRedirectTarget = false

  for (const part of partsWithOperators) {
    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false
      continue
    }

    if (part === '>' || part === '>>' || part === '>&') {
      skipNextAsRedirectTarget = true
      continue
    }

    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      lastOperator = part
      continue
    }

    const baseCommand = part.trim().split(/\s+/)[0]
    if (!baseCommand) {
      continue
    }

    if (
      lastOperator === '||' &&
      BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)
    ) {
      continue
    }

    hasNonFallbackCommand = true

    if (!BASH_SILENT_COMMANDS.has(baseCommand)) {
      return false
    }
  }

  return hasNonFallbackCommand
}

// Commands that should not be auto-backgrounded
const DISALLOWED_AUTO_BACKGROUND_COMMANDS = [
  'sleep', // Sleep should run in foreground unless explicitly backgrounded by user
]

// Check if background tasks are disabled at module load time
const isBackgroundTasksDisabled =
  // eslint-disable-next-line custom-rules/no-process-env-top-level -- Intentional: schema must be defined at module load
  isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS)

const fullInputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().describe('The command to execute'),
    path: z
      .string()
      .optional()
      .describe(
        'Optional working directory for this command. In virtual sessions, this must stay inside the virtual project root.',
      ),
    timeout: semanticNumber(z.number().optional()).describe(
      `Optional timeout in milliseconds (max ${getMaxTimeoutMs()})`,
    ),
    description: z
      .string()
      .optional()
      .describe(`Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.

For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):
- ls → "List files in current directory"
- git status → "Show working tree status"
- npm install → "Install package dependencies"

For commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:
- find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"
- git reset --hard origin/main → "Discard all local changes and match remote main"
- curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements"`),
    run_in_background: semanticBoolean(z.boolean().optional()).describe(
      `Set to true to run this command in the background. Use Read to read the output later.`,
    ),
    dangerouslyDisableSandbox: semanticBoolean(z.boolean().optional()).describe(
      'Set this to true to dangerously override sandbox mode and run commands without sandboxing.',
    ),
    _simulatedSedEdit: z
      .object({
        filePath: z.string(),
        newContent: z.string(),
      })
      .optional()
      .describe('Internal: pre-computed sed edit result from preview'),
  }),
)

// Always omit _simulatedSedEdit from the model-facing schema. It is an internal-only
// field set by SedEditPermissionRequest after the user approves a sed edit preview.
// Exposing it in the schema would let the model bypass permission checks and the
// sandbox by pairing an innocuous command with an arbitrary file write.
// Also conditionally remove run_in_background when background tasks are disabled.
const inputSchema = lazySchema(() =>
  isBackgroundTasksDisabled
    ? fullInputSchema().omit({
        run_in_background: true,
        _simulatedSedEdit: true,
      })
    : fullInputSchema().omit({ _simulatedSedEdit: true }),
)
type InputSchema = ReturnType<typeof inputSchema>

// Use fullInputSchema for the type to always include run_in_background
// (even when it's omitted from the schema, the code needs to handle it)
export type BashToolInput = z.infer<ReturnType<typeof fullInputSchema>>

const COMMON_BACKGROUND_COMMANDS = [
  'npm',
  'yarn',
  'pnpm',
  'node',
  'python',
  'python3',
  'go',
  'cargo',
  'make',
  'docker',
  'terraform',
  'webpack',
  'vite',
  'jest',
  'pytest',
  'curl',
  'wget',
  'build',
  'test',
  'serve',
  'watch',
  'dev',
] as const

function getCommandTypeForLogging(
  command: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  const parts = splitCommand_DEPRECATED(command)
  if (parts.length === 0)
    return 'other' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

  // Check each part of the command to see if any match common background commands
  for (const part of parts) {
    const baseCommand = part.split(' ')[0] || ''
    if (
      COMMON_BACKGROUND_COMMANDS.includes(
        baseCommand as (typeof COMMON_BACKGROUND_COMMANDS)[number],
      )
    ) {
      return baseCommand as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    }
  }

  return 'other' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

const outputSchema = lazySchema(() =>
  z.object({
    stdout: z.string().describe('The standard output of the command'),
    stderr: z.string().describe('The standard error output of the command'),
    rawOutputPath: z
      .string()
      .optional()
      .describe('Path to raw output file for large MCP tool outputs'),
    interrupted: z.boolean().describe('Whether the command was interrupted'),
    isImage: z
      .boolean()
      .optional()
      .describe('Flag to indicate if stdout contains image data'),
    backgroundTaskId: z
      .string()
      .optional()
      .describe(
        'ID of the background task if command is running in background',
      ),
    backgroundedByUser: z
      .boolean()
      .optional()
      .describe(
        'True if the user manually backgrounded the command with Ctrl+B',
      ),
    assistantAutoBackgrounded: z
      .boolean()
      .optional()
      .describe(
        'True if assistant-mode auto-backgrounded a long-running blocking command',
      ),
    dangerouslyDisableSandbox: z
      .boolean()
      .optional()
      .describe('Flag to indicate if sandbox mode was overridden'),
    returnCodeInterpretation: z
      .string()
      .optional()
      .describe(
        'Semantic interpretation for non-error exit codes with special meaning',
      ),
    noOutputExpected: z
      .boolean()
      .optional()
      .describe(
        'Whether the command is expected to produce no output on success',
      ),
    structuredContent: z
      .array(z.any())
      .optional()
      .describe('Structured content blocks'),
    persistedOutputPath: z
      .string()
      .optional()
      .describe(
        'Path to the persisted full output in tool-results dir (set when output is too large for inline)',
      ),
    persistedOutputSize: z
      .number()
      .optional()
      .describe(
        'Total size of the output in bytes (set when output is too large for inline)',
      ),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Out = z.infer<OutputSchema>

// Re-export BashProgress from centralized types to break import cycles
export type { BashProgress } from 'src/types/tools.js'

import type { BashProgress } from 'src/types/tools.js'

/**
 * Checks if a command is allowed to be automatically backgrounded
 * @param command The command to check
 * @returns false for commands that should not be auto-backgrounded (like sleep)
 */
function isAutobackgroundingAllowed(command: string): boolean {
  const parts = splitCommand_DEPRECATED(command)
  if (parts.length === 0) return true

  // Get the first part which should be the base command
  const baseCommand = parts[0]?.trim()
  if (!baseCommand) return true

  return !DISALLOWED_AUTO_BACKGROUND_COMMANDS.includes(baseCommand)
}

/**
 * Detect standalone or leading `sleep N` patterns that should use Monitor
 * instead. Catches `sleep 5`, `sleep 5 && check`, `sleep 5; check` — but
 * not sleep inside pipelines, subshells, or scripts (those are fine).
 */
export function detectBlockedSleepPattern(command: string): string | null {
  const parts = splitCommand_DEPRECATED(command)
  if (parts.length === 0) return null

  const first = parts[0]?.trim() ?? ''
  // Bare `sleep N` or `sleep N.N` as the first subcommand.
  // Float durations (sleep 0.5) are allowed — those are legit pacing, not polls.
  const m = /^sleep\s+(\d+)\s*$/.exec(first)
  if (!m) return null
  const secs = parseInt(m[1]!, 10)
  if (secs < 2) return null // sub-2s sleeps are fine (rate limiting, pacing)

  // `sleep N` alone → "what are you waiting for?"
  // `sleep N && check` → "use Monitor { command: check }"
  const rest = parts.slice(1).join(' ').trim()
  return rest
    ? `sleep ${secs} followed by: ${rest}`
    : `standalone sleep ${secs}`
}

/**
 * Checks if a command contains tools that shouldn't run in sandbox
 * This includes:
 * - Dynamic config-based disabled commands and substrings (tengu_sandbox_disabled_commands)
 * - User-configured commands from settings.json (sandbox.excludedCommands)
 *
 * User-configured commands support the same pattern syntax as permission rules:
 * - Exact matches: "npm run lint"
 * - Prefix patterns: "npm run test:*"
 */

type SimulatedSedEditResult = {
  data: Out
}

type SimulatedSedEditContext = Pick<
  ToolUseContext,
  'readFileState' | 'updateFileHistoryState'
>

/**
 * Applies a simulated sed edit directly instead of running sed.
 * This is used by the permission dialog to ensure what the user previews
 * is exactly what gets written to the file.
 */
async function applySedEdit(
  simulatedEdit: { filePath: string; newContent: string },
  toolUseContext: SimulatedSedEditContext,
  parentMessage?: AssistantMessage,
): Promise<SimulatedSedEditResult> {
  const { filePath, newContent } = simulatedEdit
  const absoluteFilePath = expandPath(filePath)
  const fs = getFsImplementation()

  // Read original content for VS Code notification
  const encoding = detectFileEncoding(absoluteFilePath)
  let originalContent: string
  try {
    originalContent = await fs.readFile(absoluteFilePath, { encoding })
  } catch (e) {
    if (isENOENT(e)) {
      return {
        data: {
          stdout: '',
          stderr: `sed: ${filePath}: No such file or directory\nExit code 1`,
          interrupted: false,
        },
      }
    }
    throw e
  }

  // Track file history before making changes (for undo support)
  if (fileHistoryEnabled() && parentMessage) {
    await fileHistoryTrackEdit(
      toolUseContext.updateFileHistoryState,
      absoluteFilePath,
      parentMessage.uuid,
    )
  }

  // Detect line endings and write new content
  const endings = detectLineEndings(absoluteFilePath)
  writeTextContent(absoluteFilePath, newContent, encoding, endings)

  // Notify VS Code about the file change
  notifyFileUpdated(absoluteFilePath, originalContent, newContent, {
    syncLsp: true,
    clearLspDiagnostics: true,
  })

  // Update read timestamp to invalidate stale writes
  toolUseContext.readFileState.set(absoluteFilePath, {
    content: newContent,
    timestamp: getFileModificationTime(absoluteFilePath),
    offset: undefined,
    limit: undefined,
  })

  // Return success result matching sed output format (sed produces no output on success)
  return {
    data: {
      stdout: '',
      stderr: '',
      interrupted: false,
    },
  }
}

export const BashTool = buildTool({
  name: BASH_TOOL_NAME,
  searchHint: 'execute shell commands',
  // 30K chars - tool result persistence threshold
  maxResultSizeChars: 30_000,
  strict: true,
  async description({ description }) {
    return description || 'Run shell command'
  },
  async prompt() {
    return getSimplePrompt()
  },
  isConcurrencySafe(input) {
    return this.isReadOnly?.(input) ?? false
  },
  isReadOnly(input) {
    const compoundCommandHasCd = commandHasAnyCd(input.command)
    const result = checkReadOnlyConstraints(input, compoundCommandHasCd)
    return result.behavior === 'allow'
  },
  toAutoClassifierInput(input) {
    return input.command
  },
  async preparePermissionMatcher({ command }) {
    // Hook `if` filtering is "no match → skip hook" (deny-like semantics), so
    // compound commands must fire the hook if ANY subcommand matches. Without
    // splitting, `ls && git push` would bypass a `Bash(git *)` security hook.
    const parsed = await parseForSecurity(command)
    if (parsed.kind !== 'simple') {
      // parse-unavailable / too-complex: fail safe by running the hook.
      return () => true
    }
    // Match on argv (strips leading VAR=val) so `FOO=bar git push` still
    // matches `Bash(git *)`.
    const subcommands = parsed.commands.map(c => c.argv.join(' '))
    return pattern => {
      const prefix = permissionRuleExtractPrefix(pattern)
      return subcommands.some(cmd => {
        if (prefix !== null) {
          return cmd === prefix || cmd.startsWith(`${prefix} `)
        }
        return matchWildcardPattern(pattern, cmd)
      })
    }
  },
  isSearchOrReadCommand(input) {
    const parsed = inputSchema().safeParse(input)
    if (!parsed.success)
      return { isSearch: false, isRead: false, isList: false }
    return isSearchOrReadBashCommand(parsed.data.command)
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    if (!input) {
      return 'Bash'
    }
    // Render sed in-place edits as file edits
    if (input.command) {
      const sedInfo = parseSedEditCommand(input.command)
      if (sedInfo) {
        return fileEditUserFacingName({
          file_path: sedInfo.filePath,
          old_string: 'x',
        })
      }
    }
    // Env var FIRST: shouldUseSandbox → splitCommand_DEPRECATED → shell-quote's
    // `new RegExp` per call. userFacingName runs per-render for every bash
    // message in history; with ~50 msgs + one slow-to-tokenize command, this
    // exceeds the shimmer tick → transition abort → infinite retry (#21605).
    return isEnvTruthy(process.env.CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR) &&
      shouldUseSandbox(input)
      ? 'SandboxedBash'
      : 'Bash'
  },
  getToolUseSummary(input) {
    if (!input?.command) {
      return null
    }
    const { command, description } = input
    if (description) {
      return description
    }
    return truncate(command, TOOL_SUMMARY_MAX_LENGTH)
  },
  getActivityDescription(input) {
    if (!input?.command) {
      return 'Running command'
    }
    const desc =
      input.description ?? truncate(input.command, TOOL_SUMMARY_MAX_LENGTH)
    return `Running ${desc}`
  },
  async validateInput(input: BashToolInput): Promise<ValidationResult> {
    if (
      feature('MONITOR_TOOL') &&
      !isBackgroundTasksDisabled &&
      !input.run_in_background
    ) {
      const sleepPattern = detectBlockedSleepPattern(input.command)
      if (sleepPattern !== null) {
        return {
          result: false,
          message: `Blocked: ${sleepPattern}. Run blocking commands in the background with run_in_background: true — you'll get a completion notification when done. For streaming events (watching logs, polling APIs), use the Monitor tool. If you genuinely need a delay (rate limiting, deliberate pacing), keep it under 2 seconds.`,
          errorCode: 10,
        }
      }
    }
    return { result: true }
  },
  async checkPermissions(input, context): Promise<PermissionResult> {
    return bashToolHasPermission(input, context)
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseQueuedMessage,
  renderToolResultMessage,
  // BashToolResultMessage shows <OutputLine content={stdout}> + stderr.
  // UI never shows persistedOutputPath wrapper, backgroundInfo — those are
  // model-facing (mapToolResult... below).
  extractSearchText({ stdout, stderr }) {
    return stderr ? `${stdout}\n${stderr}` : stdout
  },
  mapToolResultToToolResultBlockParam(
    {
      interrupted,
      stdout,
      stderr,
      isImage,
      backgroundTaskId,
      backgroundedByUser,
      assistantAutoBackgrounded,
      structuredContent,
      persistedOutputPath,
      persistedOutputSize,
    },
    toolUseID,
  ): ToolResultBlockParam {
    // Handle structured content
    if (structuredContent && structuredContent.length > 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: structuredContent,
      }
    }

    // For image data, format as image content block for Claude
    if (isImage) {
      const block = buildImageToolResult(stdout, toolUseID)
      if (block) return block
    }

    let processedStdout = stdout
    if (stdout) {
      // Replace any leading newlines or lines with only whitespace
      processedStdout = stdout.replace(/^(\s*\n)+/, '')
      // Still trim the end as before
      processedStdout = processedStdout.trimEnd()
    }

    // For large output that was persisted to disk, build <persisted-output>
    // message for the model. The UI never sees this — it uses data.stdout.
    if (persistedOutputPath) {
      const preview = generatePreview(processedStdout, PREVIEW_SIZE_BYTES)
      processedStdout = buildLargeToolResultMessage({
        filepath: persistedOutputPath,
        originalSize: persistedOutputSize ?? 0,
        isJson: false,
        preview: preview.preview,
        hasMore: preview.hasMore,
      })
    }

    let errorMessage = stderr.trim()
    if (interrupted) {
      if (stderr) errorMessage += EOL
      errorMessage += '<error>Command was aborted before completion</error>'
    }

    let backgroundInfo = ''
    if (backgroundTaskId) {
      const outputPath = getTaskOutputPath(backgroundTaskId)
      if (assistantAutoBackgrounded) {
        backgroundInfo = `Command exceeded the assistant-mode blocking budget (${ASSISTANT_BLOCKING_BUDGET_MS / 1000}s) and was moved to the background with ID: ${backgroundTaskId}. It is still running — you will be notified when it completes. Output is being written to: ${outputPath}. In assistant mode, delegate long-running work to a subagent or use run_in_background to keep this conversation responsive.`
      } else if (backgroundedByUser) {
        backgroundInfo = `Command was manually backgrounded by user with ID: ${backgroundTaskId}. Output is being written to: ${outputPath}`
      } else {
        backgroundInfo = `Command running in background with ID: ${backgroundTaskId}. Output is being written to: ${outputPath}`
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [processedStdout, errorMessage, backgroundInfo]
        .filter(Boolean)
        .join('\n'),
      is_error: interrupted,
    }
  },
  async call(
    input: BashToolInput,
    toolUseContext,
    _canUseTool?: CanUseToolFn,
    parentMessage?: AssistantMessage,
    onProgress?: ToolCallProgress<BashProgress>,
  ) {
    const virtualProjectRoot = (getVirtualProjectRoot() || '').trim()
    if (virtualProjectRoot) {
    const virtualResult = await runVirtualBashCommand(
        input.command,
        virtualProjectRoot,
        input.path,
        input.timeout || getDefaultTimeoutMs(),
      )
      const interpretation = interpretCommandResult(
        input.command,
        virtualResult.code,
        virtualResult.stdout,
        virtualResult.stderr,
      )
      return {
        data: {
          stdout: virtualResult.stdout,
          stderr: virtualResult.stderr,
          interrupted: false,
          isImage: false,
          returnCodeInterpretation:
            interpretation.message,
          noOutputExpected: false,
          backgroundTaskId: undefined,
          backgroundedByUser: undefined,
          assistantAutoBackgrounded: undefined,
          dangerouslyDisableSandbox:
            'dangerouslyDisableSandbox' in input
              ? (input.dangerouslyDisableSandbox as boolean | undefined)
              : undefined,
        },
      }
    }

    // Handle simulated sed edit - apply directly instead of running sed
    // This ensures what the user previewed is exactly what gets written
    if (input._simulatedSedEdit) {
      return applySedEdit(
        input._simulatedSedEdit,
        toolUseContext,
        parentMessage,
      )
    }

    const { abortController, getAppState, setAppState, setToolJSX } =
      toolUseContext
    const shouldTrackFilesystemWrites = !this.isReadOnly(input)
    const fsRootsForDiff = shouldTrackFilesystemWrites
      ? collectBashFilesystemRoots(toolUseContext)
      : []
    const fsSnapshotBefore = shouldTrackFilesystemWrites
      ? snapshotFilesystemMtimeByPath(fsRootsForDiff)
      : null

    const stdoutAccumulator = new EndTruncatingAccumulator()
    let stderrForShellReset = ''
    let interpretationResult:
      | ReturnType<typeof interpretCommandResult>
      | undefined

    let progressCounter = 0
    let wasInterrupted = false
    let result: ExecResult
    let completedResult: ExecResult | undefined

    const isMainThread = !toolUseContext.agentId
    const preventCwdChanges = !isMainThread

    try {
      // Use the new async generator version of runShellCommand
      const commandGenerator = runShellCommand({
        input,
        abortController,
        // Use the always-shared task channel so async agents' background
        // bash tasks are actually registered (and killable on agent exit).
        setAppState: toolUseContext.setAppStateForTasks ?? setAppState,
        setToolJSX,
        preventCwdChanges,
        isMainThread,
        toolUseId: toolUseContext.toolUseId,
        agentId: toolUseContext.agentId,
      })

      // Consume the generator and capture the return value
      let generatorResult
      do {
        generatorResult = await commandGenerator.next()
        if (!generatorResult.done && onProgress) {
          const progress = generatorResult.value
          onProgress({
            toolUseID: `bash-progress-${progressCounter++}`,
            data: {
              type: 'bash_progress',
              output: progress.output,
              fullOutput: progress.fullOutput,
              elapsedTimeSeconds: progress.elapsedTimeSeconds,
              totalLines: progress.totalLines,
              totalBytes: progress.totalBytes,
              taskId: progress.taskId,
              timeoutMs: progress.timeoutMs,
            },
          })
        }
      } while (!generatorResult.done)

      // Get the final result from the generator's return value
      result = generatorResult.value
      completedResult = result

      trackGitOperations(input.command, result.code, result.stdout)

      const isInterrupt =
        result.interrupted && abortController.signal.reason === 'interrupt'

      // stderr is interleaved in stdout (merged fd) — result.stdout has both
      stdoutAccumulator.append((result.stdout || '').trimEnd() + EOL)

      // Interpret the command result using semantic rules
      interpretationResult = interpretCommandResult(
        input.command,
        result.code,
        result.stdout || '',
        '',
      )

      // Check for git index.lock error (stderr is in stdout now)
      if (
        result.stdout &&
        result.stdout.includes(".git/index.lock': File exists")
      ) {
        logEvent('tengu_git_index_lock_error', {})
      }

      if (interpretationResult.isError && !isInterrupt) {
        // Only add exit code if it's actually an error
        if (result.code !== 0) {
          stdoutAccumulator.append(`Exit code ${result.code}`)
        }
      }

      if (!preventCwdChanges) {
        const appState = getAppState()
        if (resetCwdIfOutsideProject(appState.toolPermissionContext)) {
          stderrForShellReset = stdErrAppendShellResetMessage('')
        }
      }

      // Annotate output with sandbox violations if any (stderr is in stdout)
      const outputWithSbFailures =
        SandboxManager.annotateStderrWithSandboxFailures(
          input.command,
          result.stdout || '',
        )

      if (result.preSpawnError) {
        throw new Error(result.preSpawnError)
      }
      if (interpretationResult.isError && !isInterrupt) {
        // stderr is merged into stdout (merged fd); outputWithSbFailures
        // already has the full output. Pass '' for stdout to avoid
        // duplication in getErrorParts() and processBashCommand.
        throw new ShellError(
          '',
          outputWithSbFailures,
          result.code,
          result.interrupted,
        )
      }
      wasInterrupted = result.interrupted
    } finally {
      if (
        fsSnapshotBefore &&
        completedResult &&
        completedResult.backgroundTaskId === undefined
      ) {
        notifyBashFilesystemUpdates(
          fsSnapshotBefore,
          fsRootsForDiff,
          toolUseContext.readFileState,
          undefined,
          {
            commandType: getCommandTypeForLogging(input.command),
            toolName:
              'Bash' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            permissionMode: toolUseContext.getAppState().toolPermissionContext
              .mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          },
        )
      }
      if (setToolJSX) setToolJSX(null)
    }

    // Get final string from accumulator
    const stdout = stdoutAccumulator.toString()

    // Large output: the file on disk has more than getMaxOutputLength() bytes.
    // stdout already contains the first chunk (from getStdout()). Copy the
    // output file to the tool-results dir so the model can read it via
    // FileRead. If > 64 MB, truncate after copying.
    const MAX_PERSISTED_SIZE = 64 * 1024 * 1024
    let persistedOutputPath: string | undefined
    let persistedOutputSize: number | undefined
    if (result.outputFilePath && result.outputTaskId) {
      try {
        const fileStat = await fsStat(result.outputFilePath)
        persistedOutputSize = fileStat.size

        await ensureToolResultsDir()
        const dest = getToolResultPath(result.outputTaskId, false)
        if (fileStat.size > MAX_PERSISTED_SIZE) {
          await fsTruncate(result.outputFilePath, MAX_PERSISTED_SIZE)
        }
        try {
          await link(result.outputFilePath, dest)
        } catch {
          await copyFile(result.outputFilePath, dest)
        }
        persistedOutputPath = dest
      } catch {
        // File may already be gone — stdout preview is sufficient
      }
    }

    const commandType = input.command.split(' ')[0]

    logEvent('tengu_bash_tool_command_executed', {
      command_type:
        commandType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      stdout_length: stdout.length,
      stderr_length: 0,
      exit_code: result.code,
      interrupted: wasInterrupted,
    })

    // Log code indexing tool usage
    const codeIndexingTool = detectCodeIndexingFromCommand(input.command)
    if (codeIndexingTool) {
      logEvent('tengu_code_indexing_tool_used', {
        tool: codeIndexingTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source:
          'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: result.code === 0,
      })
    }

    let strippedStdout = stripEmptyLines(stdout)

    // Claude Code hints protocol: CLIs/SDKs gated on CLAUDECODE=1 emit a
    // `<claude-code-hint />` tag to stderr (merged into stdout here). Scan,
    // record for useClaudeCodeHintRecommendation to surface, then strip
    // so the model never sees the tag — a zero-token side channel.
    // Stripping runs unconditionally (subagent output must stay clean too);
    // only the dialog recording is main-thread-only.
    const extracted = extractClaudeCodeHints(strippedStdout, input.command)
    strippedStdout = extracted.stripped
    if (isMainThread && extracted.hints.length > 0) {
      for (const hint of extracted.hints) maybeRecordPluginHint(hint)
    }

    let isImage = isImageOutput(strippedStdout)

    // Cap image dimensions + size if present (CC-304 — see
    // resizeShellImageOutput). Scope the decoded buffer so it can be reclaimed
    // before we build the output Out object.
    let compressedStdout = strippedStdout
    if (isImage) {
      const resized = await resizeShellImageOutput(
        strippedStdout,
        result.outputFilePath,
        persistedOutputSize,
      )
      if (resized) {
        compressedStdout = resized
      } else {
        // Parse failed or file too large (e.g. exceeds MAX_IMAGE_FILE_SIZE).
        // Keep isImage in sync with what we actually send so the UI label stays
        // accurate — mapToolResultToToolResultBlockParam's defensive
        // fallthrough will send text, not an image block.
        isImage = false
      }
    }

    const data: Out = {
      stdout: compressedStdout,
      stderr: stderrForShellReset,
      interrupted: wasInterrupted,
      isImage,
      returnCodeInterpretation: interpretationResult?.message,
      noOutputExpected: isSilentBashCommand(input.command),
      backgroundTaskId: result.backgroundTaskId,
      backgroundedByUser: result.backgroundedByUser,
      assistantAutoBackgrounded: result.assistantAutoBackgrounded,
      dangerouslyDisableSandbox:
        'dangerouslyDisableSandbox' in input
          ? (input.dangerouslyDisableSandbox as boolean | undefined)
          : undefined,
      persistedOutputPath,
      persistedOutputSize,
    }

    return {
      data,
    }
  },
  renderToolUseErrorMessage,
  isResultTruncated(output: Out): boolean {
    return (
      isOutputLineTruncated(output.stdout) ||
      isOutputLineTruncated(output.stderr)
    )
  },
} satisfies ToolDef<InputSchema, Out, BashProgress>)

async function* runShellCommand({
  input,
  abortController,
  setAppState,
  setToolJSX,
  preventCwdChanges,
  isMainThread,
  toolUseId,
  agentId,
}: {
  input: BashToolInput
  abortController: AbortController
  setAppState: (f: (prev: AppState) => AppState) => void
  setToolJSX?: SetToolJSXFn
  preventCwdChanges?: boolean
  isMainThread?: boolean
  toolUseId?: string
  agentId?: AgentId
}): AsyncGenerator<
  {
    type: 'progress'
    output: string
    fullOutput: string
    elapsedTimeSeconds: number
    totalLines: number
    totalBytes?: number
    taskId?: string
    timeoutMs?: number
  },
  ExecResult,
  void
> {
  const { command, description, timeout, run_in_background } = input
  const timeoutMs = timeout || getDefaultTimeoutMs()

  let fullOutput = ''
  let lastProgressOutput = ''
  let lastTotalLines = 0
  let lastTotalBytes = 0
  let backgroundShellId: string | undefined = undefined
  let assistantAutoBackgrounded = false

  // Progress signal: resolved by onProgress callback from the shared poller,
  // waking the generator to yield a progress update.
  let resolveProgress: (() => void) | null = null
  function createProgressSignal(): Promise<null> {
    return new Promise<null>(resolve => {
      resolveProgress = () => resolve(null)
    })
  }

  // Determine if auto-backgrounding should be enabled
  // Only enable for commands that are allowed to be auto-backgrounded
  // and when background tasks are not disabled
  const shouldAutoBackground =
    !isBackgroundTasksDisabled && isAutobackgroundingAllowed(command)

  const shellCommand = await exec(command, abortController.signal, 'bash', {
    timeout: timeoutMs,
    onProgress(lastLines, allLines, totalLines, totalBytes, isIncomplete) {
      lastProgressOutput = lastLines
      fullOutput = allLines
      lastTotalLines = totalLines
      lastTotalBytes = isIncomplete ? totalBytes : 0
      // Wake the generator so it yields the new progress data
      const resolve = resolveProgress
      if (resolve) {
        resolveProgress = null
        resolve()
      }
    },
    preventCwdChanges,
    shouldUseSandbox: shouldUseSandbox(input),
    shouldAutoBackground,
  })

  // Start the command execution
  const resultPromise = shellCommand.result

  // Helper to spawn a background task and return its ID
  async function spawnBackgroundTask(): Promise<string> {
    const handle = await spawnShellTask(
      {
        command,
        description: description || command,
        shellCommand,
        toolUseId,
        agentId,
      },
      {
        abortController,
        getAppState: () => {
          // We don't have direct access to getAppState here, but spawn doesn't
          // actually use it during the spawn process
          throw new Error(
            'getAppState not available in runShellCommand context',
          )
        },
        setAppState,
      },
    )
    return handle.taskId
  }

  // Helper to start backgrounding with optional logging
  function startBackgrounding(
    eventName: string,
    backgroundFn?: (shellId: string) => void,
  ): void {
    // If a foreground task is already registered (via registerForeground in the
    // progress loop), background it in-place instead of re-spawning. Re-spawning
    // would overwrite tasks[taskId], emit a duplicate task_started SDK event,
    // and leak the first cleanup callback.
    if (foregroundTaskId) {
      if (
        !backgroundExistingForegroundTask(
          foregroundTaskId,
          shellCommand,
          description || command,
          setAppState,
          toolUseId,
        )
      ) {
        return
      }
      backgroundShellId = foregroundTaskId
      logEvent(eventName, {
        command_type: getCommandTypeForLogging(command),
      })
      backgroundFn?.(foregroundTaskId)
      return
    }

    // No foreground task registered — spawn a new background task
    // Note: spawn is essentially synchronous despite being async
    void spawnBackgroundTask().then(shellId => {
      backgroundShellId = shellId

      // Wake the generator's Promise.race so it sees backgroundShellId.
      // Without this, if the poller has stopped ticking for this task
      // (no output + shared-poller race with sibling stopPolling calls)
      // and the process is hung on I/O, the race at line ~1357 never
      // resolves and the generator deadlocks despite being backgrounded.
      const resolve = resolveProgress
      if (resolve) {
        resolveProgress = null
        resolve()
      }

      logEvent(eventName, {
        command_type: getCommandTypeForLogging(command),
      })

      if (backgroundFn) {
        backgroundFn(shellId)
      }
    })
  }

  // Set up auto-backgrounding on timeout if enabled
  // Only background commands that are allowed to be auto-backgrounded (not sleep, etc.)
  if (shellCommand.onTimeout && shouldAutoBackground) {
    shellCommand.onTimeout(backgroundFn => {
      startBackgrounding(
        'tengu_bash_command_timeout_backgrounded',
        backgroundFn,
      )
    })
  }

  // In assistant mode, the main agent should stay responsive. Auto-background
  // blocking commands after ASSISTANT_BLOCKING_BUDGET_MS so the agent can keep
  // coordinating instead of waiting. The command keeps running — no state loss.
  if (
    feature('KAIROS') &&
    getKairosActive() &&
    isMainThread &&
    !isBackgroundTasksDisabled &&
    run_in_background !== true
  ) {
    setTimeout(() => {
      if (
        shellCommand.status === 'running' &&
        backgroundShellId === undefined
      ) {
        assistantAutoBackgrounded = true
        startBackgrounding('tengu_bash_command_assistant_auto_backgrounded')
      }
    }, ASSISTANT_BLOCKING_BUDGET_MS).unref()
  }

  // Handle Claude asking to run it in the background explicitly
  // When explicitly requested via run_in_background, always honor the request
  // regardless of the command type (isAutobackgroundingAllowed only applies to automatic backgrounding)
  // Skip if background tasks are disabled - run in foreground instead
  if (run_in_background === true && !isBackgroundTasksDisabled) {
    const shellId = await spawnBackgroundTask()

    logEvent('tengu_bash_command_explicitly_backgrounded', {
      command_type: getCommandTypeForLogging(command),
    })

    return {
      stdout: '',
      stderr: '',
      code: 0,
      interrupted: false,
      backgroundTaskId: shellId,
    }
  }

  // Wait for the initial threshold before showing progress
  const startTime = Date.now()
  let foregroundTaskId: string | undefined = undefined

  {
    const initialResult = await Promise.race([
      resultPromise,
      new Promise<null>(resolve => {
        const t = setTimeout(
          (r: (v: null) => void) => r(null),
          PROGRESS_THRESHOLD_MS,
          resolve,
        )
        t.unref()
      }),
    ])

    if (initialResult !== null) {
      shellCommand.cleanup()
      return initialResult
    }

    if (backgroundShellId) {
      return {
        stdout: '',
        stderr: '',
        code: 0,
        interrupted: false,
        backgroundTaskId: backgroundShellId,
        assistantAutoBackgrounded,
      }
    }
  }

  // Start polling the output file for progress. The poller's #tick calls
  // onProgress every second, which resolves progressSignal below.
  TaskOutput.startPolling(shellCommand.taskOutput.taskId)

  // Progress loop: wake is driven by the shared poller calling onProgress,
  // which resolves the progressSignal.
  try {
    while (true) {
      const progressSignal = createProgressSignal()
      const result = await Promise.race([resultPromise, progressSignal])

      if (result !== null) {
        // Race: backgrounding fired (15s timer / onTimeout / Ctrl+B) but the
        // command completed before the next poll tick. #handleExit sets
        // backgroundTaskId but skips outputFilePath (it assumes the background
        // message or <task_notification> will carry the path). Strip
        // backgroundTaskId so the model sees a clean completed command,
        // reconstruct outputFilePath for large outputs, and suppress the
        // redundant <task_notification> from the .then() handler.
        // Check result.backgroundTaskId (not the closure var) to also cover
        // Ctrl+B, which calls shellCommand.background() directly.
        if (result.backgroundTaskId !== undefined) {
          markTaskNotified(result.backgroundTaskId, setAppState)
          const fixedResult: ExecResult = {
            ...result,
            backgroundTaskId: undefined,
          }
          // Mirror ShellCommand.#handleExit's large-output branch that was
          // skipped because #backgroundTaskId was set.
          const { taskOutput } = shellCommand
          if (taskOutput.stdoutToFile && !taskOutput.outputFileRedundant) {
            fixedResult.outputFilePath = taskOutput.path
            fixedResult.outputFileSize = taskOutput.outputFileSize
            fixedResult.outputTaskId = taskOutput.taskId
          }
          shellCommand.cleanup()
          return fixedResult
        }
        // Command has completed - return the actual result
        // If we registered as a foreground task, unregister it
        if (foregroundTaskId) {
          unregisterForeground(foregroundTaskId, setAppState)
        }
        // Clean up stream resources for foreground commands
        // (backgrounded commands are cleaned up by LocalShellTask)
        shellCommand.cleanup()
        return result
      }

      // Check if command was backgrounded (either via old mechanism or new backgroundAll)
      if (backgroundShellId) {
        return {
          stdout: '',
          stderr: '',
          code: 0,
          interrupted: false,
          backgroundTaskId: backgroundShellId,
          assistantAutoBackgrounded,
        }
      }

      // Check if this foreground task was backgrounded via backgroundAll()
      if (foregroundTaskId) {
        // shellCommand.status becomes 'backgrounded' when background() is called
        if (shellCommand.status === 'backgrounded') {
          return {
            stdout: '',
            stderr: '',
            code: 0,
            interrupted: false,
            backgroundTaskId: foregroundTaskId,
            backgroundedByUser: true,
          }
        }
      }

      // Time for a progress update
      const elapsed = Date.now() - startTime
      const elapsedSeconds = Math.floor(elapsed / 1000)

      // Show minimal backgrounding UI if available
      // Skip if background tasks are disabled
      if (
        !isBackgroundTasksDisabled &&
        backgroundShellId === undefined &&
        elapsedSeconds >= PROGRESS_THRESHOLD_MS / 1000 &&
        setToolJSX
      ) {
        // Register this command as a foreground task so it can be backgrounded via Ctrl+B
        if (!foregroundTaskId) {
          foregroundTaskId = registerForeground(
            {
              command,
              description: description || command,
              shellCommand,
              agentId,
            },
            setAppState,
            toolUseId,
          )
        }

        setToolJSX({
          jsx: <BackgroundHint />,
          shouldHidePromptInput: false,
          shouldContinueAnimation: true,
          showSpinner: true,
        })
      }
      yield {
        type: 'progress',
        fullOutput,
        output: lastProgressOutput,
        elapsedTimeSeconds: elapsedSeconds,
        totalLines: lastTotalLines,
        totalBytes: lastTotalBytes,
        taskId: shellCommand.taskOutput.taskId,
        ...(timeout ? { timeoutMs } : undefined),
      }
    }
  } finally {
    TaskOutput.stopPolling(shellCommand.taskOutput.taskId)
  }
}
