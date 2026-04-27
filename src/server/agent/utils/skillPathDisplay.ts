import path from 'path'
import { getProjectRoot } from '../bootstrap/state.js'
import { getVirtualProjectRoot } from './fsOperations.js'
import { maskVirtualPathForDisplay } from './file.js'
import { maskAbsolutePathsInText } from './virtualPathMasking.js'

function toVirtualSubpath(
  inputPath: string,
  rootPath: string,
  prefix = '/',
): string | null {
  const normalizedInput = path.resolve(inputPath)
  const normalizedRoot = path.resolve(rootPath)

  if (normalizedInput === normalizedRoot) {
    return prefix
  }

  if (!normalizedInput.startsWith(`${normalizedRoot}${path.sep}`)) {
    return null
  }

  const rel = path.relative(normalizedRoot, normalizedInput).replaceAll('\\', '/')
  if (!rel) return prefix
  return prefix === '/' ? `/${rel}` : `${prefix}/${rel}`.replace(/\/{2,}/g, '/')
}

function inferVirtualPathFromHostAbsolute(
  inputPath: string,
  projectRoot: string,
  virtualRoot: string,
): string | null {
  return (
    toVirtualSubpath(inputPath, path.join(projectRoot, '.aistudio', 'skills'), '/.aistudio/skills') ||
    toVirtualSubpath(inputPath, path.join(projectRoot, 'skills'), '/skills') ||
    toVirtualSubpath(inputPath, virtualRoot, '/')
  )
}

export function toModelVisibleSkillPath(inputPath: string): string {
  const virtualRoot = (getVirtualProjectRoot() || '').trim()
  const projectRoot = getProjectRoot()
  const normalizedProjectRoot = path.resolve(projectRoot)

  if (!virtualRoot) {
    return process.platform === 'win32'
      ? inputPath.replace(/\\/g, '/')
      : inputPath
  }

  const normalizedRoot = path.resolve(virtualRoot)
  const normalizedInput = path.resolve(inputPath)
  const inferredVirtualPath = inferVirtualPathFromHostAbsolute(
    normalizedInput,
    normalizedProjectRoot,
    normalizedRoot,
  )

  if (inferredVirtualPath) {
    return inferredVirtualPath
  }

  if (
    normalizedInput === normalizedRoot ||
    normalizedInput.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    const rel = path.relative(normalizedRoot, normalizedInput).replaceAll('\\', '/')
    return rel ? `/${rel}` : '/'
  }

  if (
    normalizedProjectRoot &&
    (normalizedInput === normalizedProjectRoot ||
      normalizedInput.startsWith(`${normalizedProjectRoot}${path.sep}`))
  ) {
    const relToProjectRoot = path
      .relative(normalizedProjectRoot, normalizedInput)
      .replaceAll('\\', '/')
    return relToProjectRoot ? `/${relToProjectRoot}` : '/'
  }

  return maskVirtualPathForDisplay(inputPath)
}

export function withSkillBaseDirForModel(
  content: string,
  runtimeSkillDir?: string | null,
): string {
  if (!runtimeSkillDir) return content
  const normalizedRuntimeSkillDir =
    process.platform === 'win32'
      ? runtimeSkillDir.replace(/\\/g, '/')
      : runtimeSkillDir
  const displaySkillDir = toModelVisibleSkillPath(normalizedRuntimeSkillDir)
  const withBaseDir = `Base directory for this skill: ${displaySkillDir}\n\n${content}`
  return maskAbsolutePathsInText(withBaseDir, toModelVisibleSkillPath)
}
