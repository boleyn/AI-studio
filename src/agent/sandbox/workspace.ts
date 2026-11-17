import {
  mkdir as fsMkdir,
  readdir as fsReaddir,
  readFile as fsReadFile,
  rm as fsRm,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'fs/promises'
import path from 'node:path'
import {
  deleteStorageObjects,
  getObjectFromStorage,
  listStorageObjectKeysByPrefix,
  normalizeStorageKey,
  uploadObjectToStorage,
} from '@server/storage/s3'

export type ProjectFilesInput = Record<string, { code?: string }>

const STORAGE_ENV_KEYS = [
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_PRIVATE_BUCKET',
]

const S3_PREFIX =
  (process.env.AGENT_SANDBOX_S3_PREFIX || 'agent_sandbox_workspaces').trim()

function isS3PersistenceEnabled(): boolean {
  const explicit = (process.env.AGENT_SANDBOX_S3_ENABLED || '').trim().toLowerCase()
  if (explicit === '0' || explicit === 'false' || explicit === 'no') return false
  if (explicit === '1' || explicit === 'true' || explicit === 'yes') return true
  return STORAGE_ENV_KEYS.every(k => (process.env[k] || '').trim().length > 0)
}

function normalizeProjectFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').trim()
  if (!normalized) return '/'
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function toVirtualAbsoluteFilePath(projectRoot: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').trim()
  if (!normalized) return projectRoot
  const relative = normalized.startsWith('/') ? normalized.slice(1) : normalized
  return path.resolve(projectRoot, relative)
}

function sanitizeWorkspaceKey(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'default'
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'default'
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath)
  const normalizedRoot = path.resolve(rootPath)
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  )
}

function decodeDataUrlToBuffer(value: string): Buffer | null {
  const trimmed = (value || '').trim()
  const matched = trimmed.match(/^data:([^;,]+)?;base64,(.+)$/is)
  if (!matched || !matched[2]) return null
  try {
    return Buffer.from(matched[2], 'base64')
  } catch {
    return null
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsMkdir(dirPath, { recursive: true })
}

async function writeProjectFilesToWorkspace(
  workspaceRoot: string,
  projectFiles: ProjectFilesInput,
  options?: { overwrite?: boolean },
): Promise<void> {
  for (const [rawPath, file] of Object.entries(projectFiles || {})) {
    const normalizedPath = normalizeProjectFilePath(rawPath)
    const absolutePath = toVirtualAbsoluteFilePath(workspaceRoot, normalizedPath)
    if (!isPathInsideRoot(absolutePath, workspaceRoot)) continue
    if (!options?.overwrite) {
      try {
        const existing = await fsStat(absolutePath)
        if (existing.isFile()) {
          // Preserve latest sandbox/S3 state across turns; projectFiles are initial seed input.
          continue
        }
      } catch {
        // File does not exist yet; proceed to seed it.
      }
    }
    await ensureDir(path.dirname(absolutePath))
    const rawCode = typeof file?.code === 'string' ? file.code : ''
    const binary = decodeDataUrlToBuffer(rawCode)
    await fsWriteFile(absolutePath, binary ?? rawCode)
  }
}

function toS3Prefix(workspaceKey: string): string {
  return normalizeStorageKey(`${S3_PREFIX}/${workspaceKey}`)
}

function toS3ObjectKey(workspaceKey: string, relativePath: string): string {
  return normalizeStorageKey(`${toS3Prefix(workspaceKey)}/files/${relativePath}`)
}

function toRelativeFromS3ObjectKey(
  workspaceKey: string,
  objectKey: string,
): string | null {
  const normalized = normalizeStorageKey(objectKey)
  const prefix = `${toS3Prefix(workspaceKey)}/files/`
  if (!normalized.startsWith(prefix)) return null
  const relative = normalized.slice(prefix.length)
  if (!relative || relative.includes('..')) return null
  return relative
}

function shouldSkipPersistenceRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized) return false
  // /skills contains repository-provided runtime dependencies. Bash and other
  // tools open their own workspace handles, so this must be a global rule
  // rather than relying only on the runtimeFiles set from the query adapter.
  if (normalized === 'skills' || normalized.startsWith('skills/')) return true
  const segments = normalized.split('/').filter(Boolean)
  return segments.some(segment => segment.startsWith('.'))
}

async function hydrateWorkspaceFromS3(
  workspaceRoot: string,
  workspaceKey: string,
): Promise<void> {
  if (!isS3PersistenceEnabled()) return
  const prefix = `${toS3Prefix(workspaceKey)}/files`
  let keys: string[] = []
  try {
    keys = await listStorageObjectKeysByPrefix({ prefix, bucketType: 'private' })
  } catch (error) {
    console.warn('[agent-sandbox] restore from S3 failed:', error)
    return
  }

  for (const key of keys) {
    const relativePath = toRelativeFromS3ObjectKey(workspaceKey, key)
    if (!relativePath) continue
    if (shouldSkipPersistenceRelativePath(relativePath)) continue
    const destination = path.resolve(workspaceRoot, relativePath)
    if (!isPathInsideRoot(destination, workspaceRoot)) continue
    try {
      const { buffer } = await getObjectFromStorage({ key, bucketType: 'private' })
      await ensureDir(path.dirname(destination))
      await fsWriteFile(destination, buffer)
    } catch (error) {
      console.warn('[agent-sandbox] restore object failed:', key, error)
    }
  }
}

async function persistWorkspaceToS3(
  workspaceRoot: string,
  workspaceKey: string,
  excludedRelativePaths: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (!isS3PersistenceEnabled()) return

  const prefix = `${toS3Prefix(workspaceKey)}/files`
  let existingKeys: string[] = []
  try {
    existingKeys = await listStorageObjectKeysByPrefix({ prefix, bucketType: 'private' })
  } catch (error) {
    console.warn('[agent-sandbox] list S3 prefix failed:', error)
  }

  const currentObjectKeys = new Set<string>()
  const walk = async (dir: string) => {
    const entries = await fsReaddir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (!entry.isFile()) continue

      const relative = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/')
      if (!relative || relative.includes('..')) continue
      if (shouldSkipPersistenceRelativePath(relative)) continue
      if (excludedRelativePaths.has(relative)) continue
      const objectKey = toS3ObjectKey(workspaceKey, relative)
      currentObjectKeys.add(objectKey)

      try {
        const content = await fsReadFile(absolutePath)
        await uploadObjectToStorage({
          key: objectKey,
          body: content,
          bucketType: 'private',
        })
      } catch (error) {
        console.warn('[agent-sandbox] upload object failed:', objectKey, error)
      }
    }
  }

  await walk(workspaceRoot)

  const staleKeys = existingKeys.filter(key => !currentObjectKeys.has(key))
  if (staleKeys.length > 0) {
    try {
      await deleteStorageObjects({ keys: staleKeys, bucketType: 'private' })
    } catch (error) {
      console.warn('[agent-sandbox] delete stale objects failed:', error)
    }
  }
}

export type AgentSandboxWorkspace = {
  workspaceRoot: string
  projectRoot: string
  workspaceKey: string
  persistToS3: () => Promise<void>
}

export async function prepareAgentSandboxWorkspace(params: {
  baseCwd: string
  workspaceIdentity: string
  projectSubdir?: string
  hostProjectRoot?: string
  projectFiles?: ProjectFilesInput
  runtimeFiles?: ProjectFilesInput
  forceHydrate?: boolean
}): Promise<AgentSandboxWorkspace> {
  const workspaceKey = sanitizeWorkspaceKey(params.workspaceIdentity)
  const workspaceRoot = path.resolve(
    params.baseCwd,
    '.aistudio',
    'sandboxes',
    workspaceKey,
  )
  const safeSubdir = params.projectSubdir
    ? params.projectSubdir.replace(/^\/+|\/+$/g, '')
    : ''
  const projectRoot = safeSubdir
    ? path.resolve(workspaceRoot, safeSubdir)
    : workspaceRoot

  await ensureDir(workspaceRoot)
  const hydratedMarker = path.join(workspaceRoot, '.hydrated')
  const alreadyHydrated = await fsStat(hydratedMarker).then(s => s.isFile()).catch(() => false)
  if (params.forceHydrate || !alreadyHydrated) {
    await hydrateWorkspaceFromS3(workspaceRoot, workspaceKey)
    await fsWriteFile(hydratedMarker, `${Date.now()}\n`, 'utf8').catch(() => undefined)
  }
  if (projectRoot !== workspaceRoot) {
    await ensureDir(projectRoot)
  }

  // /workspace/<token> was produced by the pre-agent-sandbox cwd adapter. It
  // is a reserved runtime path and otherwise gets rehydrated from persisted
  // state after a user deletes it in the editor.
  await fsRm(path.join(workspaceRoot, 'workspace'), {
    recursive: true,
    force: true,
  })

  if (params.projectFiles && Object.keys(params.projectFiles).length > 0) {
    await writeProjectFilesToWorkspace(projectRoot, params.projectFiles)
  }

  // Runtime dependencies (for example repository-provided skills) must be
  // refreshed on every turn. They are mounted into the sandbox for tools and
  // command discovery, but are not user project state and must not enter S3.
  if (params.runtimeFiles && Object.keys(params.runtimeFiles).length > 0) {
    await writeProjectFilesToWorkspace(workspaceRoot, params.runtimeFiles, {
      overwrite: true,
    })
  }

  const runtimeRelativePaths = new Set(
    Object.keys(params.runtimeFiles || {})
      .map(normalizeProjectFilePath)
      .map(filePath => filePath.replace(/^\/+/, ''))
      .filter(Boolean),
  )

  return {
    workspaceRoot,
    projectRoot,
    workspaceKey,
    persistToS3: async () => {
      await persistWorkspaceToS3(
        workspaceRoot,
        workspaceKey,
        runtimeRelativePaths,
      )
    },
  }
}

export async function clearAgentSandboxWorkspace(params: {
  baseCwd: string
  workspaceIdentity: string
}): Promise<void> {
  const workspaceKey = sanitizeWorkspaceKey(params.workspaceIdentity)
  const workspaceRoot = path.resolve(
    params.baseCwd,
    '.aistudio',
    'sandboxes',
    workspaceKey,
  )
  await fsRm(workspaceRoot, { recursive: true, force: true })
}
