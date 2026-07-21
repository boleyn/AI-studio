import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

type ExecResponse = {
  code: number
  stdout: string
  stderr: string
}

const PORT = Number(process.env.FASTGPT_EXEC_PORT || 8091)
const WORKDIR = process.env.FASTGPT_WORKDIR || '/workspace'
const AUTH_TOKEN = (process.env.FASTGPT_EXEC_TOKEN || '').trim()

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

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw) as Record<string, unknown>
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
  await fs.mkdir(tmpDir, { recursive: true })
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.mkdir(stateDir, { recursive: true })
  await fs.mkdir(configDir, { recursive: true })

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

  return await new Promise<ExecResponse>(resolve => {
    const child = spawn('/bin/bash', ['-lc', command], {
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

    if (AUTH_TOKEN) {
      const provided = String(req.headers['x-fastgpt-exec-token'] || '').trim()
      if (!provided || provided !== AUTH_TOKEN) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
    }

    const body = await readJsonBody(req)
    const command = typeof body.command === 'string' ? body.command : ''
    const requestedCwd = typeof body.cwd === 'string' ? body.cwd : ''
    const workspaceKey = sanitizeWorkspaceKey(body.workspaceKey)
    const timeoutMs = Math.max(0, Math.floor(Number(body.timeoutMs || 0)))

    if (!command.trim()) {
      sendJson(res, 400, { error: 'command_required' })
      return
    }

    const workspaceRoot = path.resolve(WORKDIR, workspaceKey)
    await fs.mkdir(workspaceRoot, { recursive: true })

    const resolvedCwd = requestedCwd ? path.resolve(requestedCwd) : workspaceRoot
    if (!isInsideRoot(resolvedCwd, workspaceRoot)) {
      sendJson(res, 400, { error: 'cwd_outside_workspace' })
      return
    }

    const result = await executeCommand({
      command,
      cwd: resolvedCwd,
      workspaceRoot,
      timeoutMs,
    })
    sendJson(res, 200, result)
  } catch (error) {
    sendJson(res, 500, {
      error: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`[agent-sandbox] exec server listening on ${PORT}\n`)
})
