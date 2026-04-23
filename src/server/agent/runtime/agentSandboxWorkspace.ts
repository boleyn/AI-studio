import {
  mkdir as fsMkdir,
  readdir as fsReaddir,
  readFile as fsReadFile,
  rm as fsRm,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'fs/promises'
import path from 'node:path'
import { NodeFsOperations, type FsOperations } from '../utils/fsOperations.js'
import {
  deleteStorageObjects,
  getObjectFromStorage,
  listStorageObjectKeysByPrefix,
  normalizeStorageKey,
  uploadObjectToStorage,
} from '../../storage/s3.js'

export type ProjectFilesInput = Record<string, { code?: string }>

const STORAGE_ENV_KEYS = [
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_PRIVATE_BUCKET',
]

const S3_PREFIX =
  (process.env.AGENT_SANDBOX_S3_PREFIX || 'agent_sandbox_workspaces').trim()
const EPHEMERAL_ROOT_DIRS = new Set(['.tmp', '.cache', '.state', '.config'])

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
): Promise<void> {
  for (const [rawPath, file] of Object.entries(projectFiles || {})) {
    const normalizedPath = normalizeProjectFilePath(rawPath)
    const absolutePath = toVirtualAbsoluteFilePath(workspaceRoot, normalizedPath)
    if (!isPathInsideRoot(absolutePath, workspaceRoot)) continue
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
  const rootSegment = normalized.split('/')[0] || ''
  return EPHEMERAL_ROOT_DIRS.has(rootSegment)
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

function createScopedFs(
  workspaceRoot: string,
  hostProjectRoot: string,
): FsOperations {
  const routePath = (targetPath: string): string => {
    const normalizedTarget = targetPath.replace(/\\/g, '/').trim()
    if (!normalizedTarget) return workspaceRoot

    const hostAbsolute = path.resolve(normalizedTarget)
    if (path.isAbsolute(normalizedTarget)) {
      if (isPathInsideRoot(hostAbsolute, workspaceRoot)) {
        return hostAbsolute
      }
      if (isPathInsideRoot(hostAbsolute, hostProjectRoot)) {
        const rel = path.relative(hostProjectRoot, hostAbsolute)
        return path.resolve(workspaceRoot, rel)
      }
      return path.resolve(workspaceRoot, `.${hostAbsolute}`)
    }

    return path.resolve(workspaceRoot, normalizedTarget)
  }

  const routePathForRead = (targetPath: string): string => {
    const routed = routePath(targetPath)
    if (!isPathInsideRoot(routed, workspaceRoot)) {
      const error = new Error(
        `ENOENT: no such file or directory, path '${targetPath}'`,
      ) as Error & { code: string }
      error.code = 'ENOENT'
      throw error
    }
    return routed
  }

  return {
    cwd() {
      return workspaceRoot
    },
    existsSync(fsPath) {
      try {
        return NodeFsOperations.existsSync(routePathForRead(fsPath))
      } catch {
        return false
      }
    },
    async stat(fsPath) {
      return NodeFsOperations.stat(routePathForRead(fsPath))
    },
    async readdir(fsPath) {
      return NodeFsOperations.readdir(routePathForRead(fsPath))
    },
    async unlink(fsPath) {
      return NodeFsOperations.unlink(routePath(fsPath))
    },
    async rmdir(fsPath) {
      return NodeFsOperations.rmdir(routePath(fsPath))
    },
    async rm(fsPath, options) {
      return NodeFsOperations.rm(routePath(fsPath), options)
    },
    async mkdir(fsPath, options) {
      return NodeFsOperations.mkdir(routePath(fsPath), options)
    },
    async readFile(fsPath, options) {
      return NodeFsOperations.readFile(routePathForRead(fsPath), options)
    },
    async rename(oldPath, newPath) {
      return NodeFsOperations.rename(routePath(oldPath), routePath(newPath))
    },
    statSync(fsPath) {
      return NodeFsOperations.statSync(routePathForRead(fsPath))
    },
    lstatSync(fsPath) {
      return NodeFsOperations.lstatSync(routePathForRead(fsPath))
    },
    readFileSync(fsPath, options) {
      return NodeFsOperations.readFileSync(routePathForRead(fsPath), options)
    },
    readFileBytesSync(fsPath) {
      return NodeFsOperations.readFileBytesSync(routePathForRead(fsPath))
    },
    readSync(fsPath, options) {
      return NodeFsOperations.readSync(routePathForRead(fsPath), options)
    },
    appendFileSync(fsPath, data, options) {
      return NodeFsOperations.appendFileSync(routePath(fsPath), data, options)
    },
    writeFileSync(fsPath, data, options) {
      return NodeFsOperations.writeFileSync(routePath(fsPath), data, options)
    },
    copyFileSync(src, dest) {
      return NodeFsOperations.copyFileSync(routePath(src), routePath(dest))
    },
    unlinkSync(fsPath) {
      return NodeFsOperations.unlinkSync(routePath(fsPath))
    },
    renameSync(oldPath, newPath) {
      return NodeFsOperations.renameSync(routePath(oldPath), routePath(newPath))
    },
    linkSync(target, fsPath) {
      return NodeFsOperations.linkSync(routePath(target), routePath(fsPath))
    },
    symlinkSync(target, fsPath, type) {
      return NodeFsOperations.symlinkSync(target, routePath(fsPath), type)
    },
    readlinkSync(fsPath) {
      return NodeFsOperations.readlinkSync(routePathForRead(fsPath))
    },
    realpathSync(fsPath) {
      return NodeFsOperations.realpathSync(routePathForRead(fsPath))
    },
    mkdirSync(fsPath, options) {
      return NodeFsOperations.mkdirSync(routePath(fsPath), options)
    },
    readdirSync(fsPath) {
      return NodeFsOperations.readdirSync(routePathForRead(fsPath))
    },
    readdirStringSync(fsPath) {
      return NodeFsOperations.readdirStringSync(routePathForRead(fsPath))
    },
    isDirEmptySync(fsPath) {
      return NodeFsOperations.isDirEmptySync(routePathForRead(fsPath))
    },
    rmdirSync(fsPath) {
      return NodeFsOperations.rmdirSync(routePath(fsPath))
    },
    rmSync(fsPath, options) {
      return NodeFsOperations.rmSync(routePath(fsPath), options)
    },
    createWriteStream(fsPath) {
      return NodeFsOperations.createWriteStream(routePath(fsPath))
    },
    async readFileBytes(fsPath, maxBytes) {
      return NodeFsOperations.readFileBytes(routePathForRead(fsPath), maxBytes)
    },
  }
}

export type AgentSandboxWorkspace = {
  workspaceRoot: string
  workspaceKey: string
  scopedFs: FsOperations
  persistToS3: () => Promise<void>
}

export async function prepareAgentSandboxWorkspace(params: {
  baseCwd: string
  workspaceIdentity: string
  hostProjectRoot: string
  projectFiles?: ProjectFilesInput
}): Promise<AgentSandboxWorkspace> {
  const workspaceKey = sanitizeWorkspaceKey(params.workspaceIdentity)
  const workspaceRoot = path.resolve(
    params.baseCwd,
    '.aistudio',
    'sandboxes',
    workspaceKey,
  )

  await ensureDir(workspaceRoot)
  await hydrateWorkspaceFromS3(workspaceRoot, workspaceKey)

  if (params.projectFiles && Object.keys(params.projectFiles).length > 0) {
    await writeProjectFilesToWorkspace(workspaceRoot, params.projectFiles)
  }

  const scopedFs = createScopedFs(workspaceRoot, params.hostProjectRoot)

  return {
    workspaceRoot,
    workspaceKey,
    scopedFs,
    persistToS3: async () => {
      await persistWorkspaceToS3(workspaceRoot, workspaceKey)
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
