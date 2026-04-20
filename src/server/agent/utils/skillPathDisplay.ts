import path from 'path'
import { getProjectRoot } from '../bootstrap/state.js'
import { getVirtualProjectRoot } from './fsOperations.js'
import { maskVirtualPathForDisplay } from './file.js'
import { maskAbsolutePathsInText } from './virtualPathMasking.js'

function inferVirtualPathFromHostAbsolute(inputPath: string): string | null {
  const normalized = inputPath.replace(/\\/g, '/')

  const projectSkillMatch = normalized.match(/\/\.aistudio\/skills\/(.+)$/)
  if (projectSkillMatch?.[1]) {
    return `/.aistudio/skills/${projectSkillMatch[1]}`
  }

  const builtinSkillMatch = normalized.match(/\/skills\/(.+)$/)
  if (builtinSkillMatch?.[1]) {
    return `/skills/${builtinSkillMatch[1]}`
  }

  const virtualProjectMatch = normalized.match(/\/\.aistudio-virtual\/[^/]+\/(.+)$/)
  if (virtualProjectMatch?.[1]) {
    return `/${virtualProjectMatch[1]}`
  }

  return null
}

export function toModelVisibleSkillPath(inputPath: string): string {
  const virtualRoot = (getVirtualProjectRoot() || '').trim()
  const projectRoot = getProjectRoot()
  const normalizedProjectRoot = path.resolve(projectRoot)
  const inferredVirtualPath = inferVirtualPathFromHostAbsolute(inputPath)

  if (inferredVirtualPath) {
    return inferredVirtualPath
  }

  if (!virtualRoot) {
    return process.platform === 'win32'
      ? inputPath.replace(/\\/g, '/')
      : inputPath
  }

  const normalizedRoot = path.resolve(virtualRoot)
  const normalizedInput = path.resolve(inputPath)

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
