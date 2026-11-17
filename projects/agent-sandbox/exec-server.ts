import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { resolveVirtualWorkspacePaths } from './virtual-paths'

type ExecResponse = {
  code: number
  stdout: string
  stderr: string
}

const PORT = Number(process.env.FASTGPT_EXEC_PORT || 8091)
const WORKDIR = process.env.FASTGPT_WORKDIR || '/workspace'
const AUTH_TOKEN = (process.env.FASTGPT_EXEC_TOKEN || '').trim()
const PROTOCOL_VERSION = 1
const ALLOW_UNAUTHENTICATED =
  (process.env.FASTGPT_ALLOW_UNAUTHENTICATED_EXEC || '').trim().toLowerCase() ===
  'true'
if (!AUTH_TOKEN && !ALLOW_UNAUTHENTICATED) {
  throw new Error(
    'FASTGPT_EXEC_TOKEN is required (or explicitly set FASTGPT_ALLOW_UNAUTHENTICATED_EXEC=true)',
  )
}
const positiveEnvInt = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
const SANDBOX_UID = positiveEnvInt('FASTGPT_SANDBOX_UID', 1000)
const SANDBOX_GID = positiveEnvInt('FASTGPT_SANDBOX_GID', 1000)
const MAX_FILES = positiveEnvInt('FASTGPT_SYNC_MAX_FILES', 5000)
const MAX_TOTAL_BYTES = positiveEnvInt(
  'FASTGPT_SYNC_MAX_TOTAL_BYTES',
  100 * 1024 * 1024,
)
const MAX_FILE_BYTES = positiveEnvInt(
  'FASTGPT_SYNC_MAX_FILE_BYTES',
  25 * 1024 * 1024,
)
const MAX_REQUEST_BYTES = positiveEnvInt(
  'FASTGPT_EXEC_MAX_REQUEST_BYTES',
  140 * 1024 * 1024,
)

type SnapshotFile = {
  path: string
  contentBase64: string
  mode?: number
}

type WorkspaceSnapshot = {
  files: SnapshotFile[]
}

const workspaceLocks = new Map<string, Promise<void>>()

async function withWorkspaceLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = workspaceLocks.get(key) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const queued = previous.then(() => current)
  workspaceLocks.set(key, queued)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (workspaceLocks.get(key) === queued) workspaceLocks.delete(key)
  }
}

function sanitizeWorkspaceKey(raw: unknown): string {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return 'default'
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'default'
}

function isInsideRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath)
  const normalizedRoot = path.resolve(rootPath)
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  )
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function isAuthorized(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return ALLOW_UNAUTHENTICATED
  const provided = String(req.headers['x-fastgpt-exec-token'] || '').trim()
  const expectedBuffer = Buffer.from(AUTH_TOKEN)
  const providedBuffer = Buffer.from(provided)
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  )
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error('request_too_large')
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw) as Record<string, unknown>
}

function normalizeRelativePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (
    !normalized ||
    normalized === '.' ||
    path.posix.isAbsolute(normalized) ||
    normalized.split('/').some(segment => segment === '..' || segment === '')
  ) {
    throw new Error(`invalid_snapshot_path:${rawPath}`)
  }
  return normalized
}

function shouldSkipSnapshotPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const first = normalized.split('/')[0]
  if (
    first === '.git' ||
    first === '.tmp' ||
    first === '.cache' ||
    first === '.state' ||
    first === '.config' ||
    first === '.npm' ||
    first === '.aistudio-home'
  ) {
    return true
  }
  return (
    normalized.startsWith('.aistudio/') &&
    !normalized.startsWith('.aistudio/skills')
  )
}

function resolveSnapshotPath(workspaceRoot: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  const resolved = path.resolve(workspaceRoot, normalized)
  if (!isInsideRoot(resolved, workspaceRoot) || resolved === path.resolve(workspaceRoot)) {
    throw new Error(`snapshot_path_outside_workspace:${relativePath}`)
  }
  return resolved
}

async function applyWorkspaceSnapshot(
  workspaceRoot: string,
  rawSnapshot: unknown,
): Promise<void> {
  if (!rawSnapshot || typeof rawSnapshot !== 'object') {
    throw new Error('snapshot_required')
  }
  const files = (rawSnapshot as { files?: unknown }).files
  if (!Array.isArray(files)) throw new Error('invalid_snapshot')
  if (files.length > MAX_FILES) throw new Error('snapshot_file_limit_exceeded')

  const validated: Array<SnapshotFile & { absolutePath: string; content: Buffer }> = []
  const seen = new Set<string>()
  let totalBytes = 0
  for (const item of files) {
    if (!item || typeof item !== 'object') throw new Error('invalid_snapshot_file')
    const file = item as Partial<SnapshotFile>
    if (typeof file.path !== 'string' || typeof file.contentBase64 !== 'string') {
      throw new Error('invalid_snapshot_file')
    }
    const relativePath = normalizeRelativePath(file.path)
    if (seen.has(relativePath)) throw new Error(`duplicate_snapshot_path:${relativePath}`)
    seen.add(relativePath)
    const content = Buffer.from(file.contentBase64, 'base64')
    if (content.length > MAX_FILE_BYTES) throw new Error(`snapshot_file_too_large:${relativePath}`)
    totalBytes += content.length
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('snapshot_total_size_exceeded')
    validated.push({
      path: relativePath,
      contentBase64: file.contentBase64,
      mode: file.mode,
      absolutePath: resolveSnapshotPath(workspaceRoot, relativePath),
      content,
    })
  }

  await fs.mkdir(workspaceRoot, { recursive: true })
  const existing = await fs.readdir(workspaceRoot)
  await Promise.all(
    existing.map(name =>
      fs.rm(path.join(workspaceRoot, name), { recursive: true, force: true }),
    ),
  )
  for (const file of validated) {
    await fs.mkdir(path.dirname(file.absolutePath), { recursive: true })
    await fs.writeFile(file.absolutePath, file.content)
    if (typeof file.mode === 'number') await fs.chmod(file.absolutePath, file.mode & 0o777)
  }

  const chownTree = async (directory: string): Promise<void> => {
    await fs.chown(directory, SANDBOX_UID, SANDBOX_GID)
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await chownTree(absolutePath)
      } else {
        await fs.chown(absolutePath, SANDBOX_UID, SANDBOX_GID)
      }
    }
  }
  await chownTree(workspaceRoot)
}

async function collectWorkspaceSnapshot(workspaceRoot: string): Promise<WorkspaceSnapshot> {
  const files: SnapshotFile[] = []
  let totalBytes = 0
  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/')
      if (shouldSkipSnapshotPath(relativePath) || entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      if (files.length >= MAX_FILES) throw new Error('snapshot_file_limit_exceeded')
      const stats = await fs.stat(absolutePath)
      if (stats.size > MAX_FILE_BYTES) throw new Error(`snapshot_file_too_large:${relativePath}`)
      totalBytes += stats.size
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('snapshot_total_size_exceeded')
      const content = await fs.readFile(absolutePath)
      files.push({
        path: normalizeRelativePath(relativePath),
        contentBase64: content.toString('base64'),
        mode: stats.mode & 0o777,
      })
    }
  }
  await walk(workspaceRoot)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files }
}

function buildSandboxEnvironment(workspaceRoot: string): NodeJS.ProcessEnv {
  const allowedKeys = [
    'PATH',
    'LANG',
    'LC_ALL',
    'TERM',
    'TZ',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ]
  const env: NodeJS.ProcessEnv = {}
  for (const key of allowedKeys) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return {
    ...env,
    HOME: workspaceRoot,
    USERPROFILE: workspaceRoot,
    TMPDIR: path.join(workspaceRoot, '.tmp'),
    TMP: path.join(workspaceRoot, '.tmp'),
    TEMP: path.join(workspaceRoot, '.tmp'),
    XDG_CACHE_HOME: path.join(workspaceRoot, '.cache'),
    XDG_STATE_HOME: path.join(workspaceRoot, '.state'),
    XDG_CONFIG_HOME: path.join(workspaceRoot, '.config'),
    SANDBOX_WORKSPACE_ROOT: workspaceRoot,
  }
}

async function executeCommand(params: {
  command: string
  cwd: string
  workspaceRoot: string
  timeoutMs: number
}): Promise<ExecResponse> {
  const { command, cwd, workspaceRoot, timeoutMs } = params
  const tmpDir = path.join(workspaceRoot, '.tmp')
  const cacheDir = path.join(workspaceRoot, '.cache')
  const stateDir = path.join(workspaceRoot, '.state')
  const configDir = path.join(workspaceRoot, '.config')
  await fs.mkdir(cwd, { recursive: true })
  await fs.chown(cwd, SANDBOX_UID, SANDBOX_GID).catch(() => {})
  await fs.mkdir(tmpDir, { recursive: true })
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.mkdir(stateDir, { recursive: true })
  await fs.mkdir(configDir, { recursive: true })

  const env = buildSandboxEnvironment(workspaceRoot)

  return await new Promise<ExecResponse>(resolve => {
    const child = spawn('/bin/bash', ['-lc', command], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      uid: SANDBOX_UID,
      gid: SANDBOX_GID,
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
        hardKillHandle = setTimeout(() => child.kill('SIGKILL'), 2000)
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
          `sandbox-exec failed: ${error.message}`,
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
            `Command timed out after ${timeoutMs}ms in sandbox shell.`,
        })
        return
      }
      resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr })
    })
  })
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method !== 'POST' || req.url !== '/exec') {
      sendJson(res, 404, { error: 'not_found' })
      return
    }

    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    const body = await readJsonBody(req)
    if (body.protocolVersion !== PROTOCOL_VERSION) {
      sendJson(res, 409, {
        error: 'unsupported_protocol_version',
        protocolVersion: PROTOCOL_VERSION,
      })
      return
    }
    const command = typeof body.command === 'string' ? body.command : ''
    const requestedCwdRelative =
      typeof body.cwdRelative === 'string' ? body.cwdRelative.trim() : '.'
    const workspaceKey = sanitizeWorkspaceKey(body.workspaceKey)
    const timeoutMs = Math.max(0, Math.floor(Number(body.timeoutMs || 0)))

    if (!command.trim()) {
      sendJson(res, 400, { error: 'command_required' })
      return
    }

    const result = await withWorkspaceLock(workspaceKey, async () => {
      const workspaceRoot = path.resolve(WORKDIR, workspaceKey)
      await applyWorkspaceSnapshot(workspaceRoot, body.snapshot)

      const resolvedCwd = path.resolve(workspaceRoot, requestedCwdRelative || '.')
      if (!isInsideRoot(resolvedCwd, workspaceRoot)) {
        throw new Error('cwd_outside_workspace')
      }

      const execution = await executeCommand({
        command: resolveVirtualWorkspacePaths(command, workspaceRoot),
        cwd: resolvedCwd,
        workspaceRoot,
        timeoutMs,
      })
      const snapshot = await collectWorkspaceSnapshot(workspaceRoot)
      return { ...execution, protocolVersion: PROTOCOL_VERSION, snapshot }
    })
    sendJson(res, 200, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, message === 'request_too_large' ? 413 : 500, {
      error: 'internal_error',
      message,
    })
  }
})

server.listen(PORT, process.env.FASTGPT_EXEC_HOST || '0.0.0.0', () => {
  process.stdout.write(`[agent-sandbox] exec server listening on ${PORT}\n`)
})
