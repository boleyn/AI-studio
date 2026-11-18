import {
  chmod as fsChmod,
  mkdir as fsMkdir,
  readdir as fsReaddir,
  readFile as fsReadFile,
  rmdir as fsRmdir,
  rm as fsRm,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'node:fs/promises'
import path from 'node:path'

export type SandboxSnapshotFile = {
  path: string
  contentBase64: string
  mode?: number
}

export type SandboxWorkspaceSnapshot = {
  files: SandboxSnapshotFile[]
}

const DEFAULT_MAX_FILES = 5000
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024

const positiveEnvInt = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const limits = () => ({
  maxFiles: positiveEnvInt('AGENT_SANDBOX_SYNC_MAX_FILES', DEFAULT_MAX_FILES),
  maxTotalBytes: positiveEnvInt(
    'AGENT_SANDBOX_SYNC_MAX_TOTAL_BYTES',
    DEFAULT_MAX_TOTAL_BYTES,
  ),
  maxFileBytes: positiveEnvInt(
    'AGENT_SANDBOX_SYNC_MAX_FILE_BYTES',
    DEFAULT_MAX_FILE_BYTES,
  ),
})

const normalizeRelativePath = (rawPath: string): string => {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (
    !normalized ||
    normalized === '.' ||
    path.posix.isAbsolute(normalized) ||
    normalized.split('/').some(segment => segment === '..' || segment === '')
  ) {
    throw new Error(`invalid sandbox snapshot path: ${rawPath}`)
  }
  return normalized
}

const shouldSkipSnapshotPath = (relativePath: string, isDirectory: boolean): boolean => {
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
  if (
    normalized.startsWith('.aistudio/') &&
    !normalized.startsWith('.aistudio/skills') &&
    !normalized.startsWith('.aistudio/context')
  ) {
    return true
  }
  return false
}

const resolveSnapshotPath = (workspaceRoot: string, relativePath: string): string => {
  const root = path.resolve(workspaceRoot)
  const normalized = normalizeRelativePath(relativePath)
  const resolved = path.resolve(root, normalized)
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`sandbox snapshot path escapes workspace: ${relativePath}`)
  }
  return resolved
}

export const collectSandboxWorkspaceSnapshot = async (
  workspaceRoot: string,
): Promise<SandboxWorkspaceSnapshot> => {
  const root = path.resolve(workspaceRoot)
  const configured = limits()
  const files: SandboxSnapshotFile[] = []
  let totalBytes = 0

  const walk = async (directory: string): Promise<void> => {
    const entries = await fsReaddir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/')
      if (shouldSkipSnapshotPath(relativePath, entry.isDirectory())) continue
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      if (files.length >= configured.maxFiles) {
        throw new Error(`sandbox workspace exceeds ${configured.maxFiles} files`)
      }
      const fileStat = await fsStat(absolutePath)
      if (fileStat.size > configured.maxFileBytes) {
        throw new Error(
          `sandbox file exceeds ${configured.maxFileBytes} bytes: ${relativePath}`,
        )
      }
      totalBytes += fileStat.size
      if (totalBytes > configured.maxTotalBytes) {
        throw new Error(
          `sandbox workspace exceeds ${configured.maxTotalBytes} total bytes`,
        )
      }
      const content = await fsReadFile(absolutePath)
      files.push({
        path: normalizeRelativePath(relativePath),
        contentBase64: content.toString('base64'),
        mode: fileStat.mode & 0o777,
      })
    }
  }

  await walk(root)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files }
}

export const applySandboxWorkspaceSnapshot = async (
  workspaceRoot: string,
  snapshot: SandboxWorkspaceSnapshot,
  options?: { preserveExcludedPaths?: boolean },
): Promise<void> => {
  const root = path.resolve(workspaceRoot)
  const configured = limits()
  if (!snapshot || !Array.isArray(snapshot.files)) {
    throw new Error('invalid sandbox workspace snapshot')
  }
  if (snapshot.files.length > configured.maxFiles) {
    throw new Error(`sandbox workspace exceeds ${configured.maxFiles} files`)
  }

  const validated: Array<SandboxSnapshotFile & { absolutePath: string; content: Buffer }> = []
  const seen = new Set<string>()
  let totalBytes = 0
  for (const file of snapshot.files) {
    if (!file || typeof file.path !== 'string' || typeof file.contentBase64 !== 'string') {
      throw new Error('invalid sandbox snapshot file')
    }
    const normalizedPath = normalizeRelativePath(file.path)
    if (seen.has(normalizedPath)) throw new Error(`duplicate sandbox path: ${normalizedPath}`)
    seen.add(normalizedPath)
    const content = Buffer.from(file.contentBase64, 'base64')
    if (content.length > configured.maxFileBytes) {
      throw new Error(`sandbox file exceeds size limit: ${normalizedPath}`)
    }
    totalBytes += content.length
    if (totalBytes > configured.maxTotalBytes) {
      throw new Error('sandbox workspace exceeds total size limit')
    }
    validated.push({
      ...file,
      path: normalizedPath,
      absolutePath: resolveSnapshotPath(root, normalizedPath),
      content,
    })
  }

  await fsMkdir(root, { recursive: true })
  if (options?.preserveExcludedPaths) {
    const clearManagedPaths = async (directory: string): Promise<void> => {
      const entries = await fsReaddir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name)
        const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/')
        if (shouldSkipSnapshotPath(relativePath, entry.isDirectory())) continue
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          await clearManagedPaths(absolutePath)
          await fsRmdir(absolutePath).catch(() => undefined)
          continue
        }
        await fsRm(absolutePath, { force: true })
      }
    }
    await clearManagedPaths(root)
  } else {
    const existing = await fsReaddir(root)
    await Promise.all(
      existing.map(name =>
        fsRm(path.join(root, name), { recursive: true, force: true }),
      ),
    )
  }
  for (const file of validated) {
    await fsMkdir(path.dirname(file.absolutePath), { recursive: true })
    await fsWriteFile(file.absolutePath, file.content)
    if (typeof file.mode === 'number') {
      await fsChmod(file.absolutePath, file.mode & 0o777)
    }
  }
}
