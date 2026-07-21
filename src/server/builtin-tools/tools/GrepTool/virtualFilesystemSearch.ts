import * as nodePath from 'path'
import picomatch from 'picomatch'
import { getFsImplementation } from 'src/utils/fsOperations.js'

const VCS_DIRECTORIES_TO_EXCLUDE = [
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  '.jj',
  '.sl',
] as const

const TYPE_EXTENSION_MAP: Record<string, string[]> = {
  c: ['.c', '.h'],
  cpp: ['.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx'],
  css: ['.css'],
  go: ['.go'],
  html: ['.htm', '.html'],
  java: ['.java'],
  js: ['.cjs', '.js', '.jsx', '.mjs'],
  json: ['.json'],
  md: ['.markdown', '.md', '.mdx'],
  php: ['.php'],
  py: ['.py'],
  rb: ['.rb'],
  rs: ['.rs'],
  sass: ['.sass'],
  scss: ['.scss'],
  sh: ['.bash', '.sh', '.zsh'],
  sql: ['.sql'],
  svelte: ['.svelte'],
  ts: ['.cts', '.mts', '.ts', '.tsx'],
  txt: ['.txt'],
  vue: ['.vue'],
  xml: ['.xml'],
  yaml: ['.yaml', '.yml'],
}

export function splitGlobPatterns(glob: string | undefined): string[] {
  if (!glob) return []

  const globPatterns: string[] = []
  const rawPatterns = glob.split(/\s+/)

  for (const rawPattern of rawPatterns) {
    if (!rawPattern) continue
    if (rawPattern.includes('{') && rawPattern.includes('}')) {
      globPatterns.push(rawPattern)
      continue
    }
    globPatterns.push(...rawPattern.split(',').filter(Boolean))
  }

  return globPatterns
}

function normalizeDirentName(entry: string | { name?: string }): string {
  return typeof entry === 'string' ? entry : entry.name || ''
}

function buildLineStartOffsets(content: string): number[] {
  const offsets = [0]
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

function findLineIndex(lineStarts: number[], index: number): number {
  let low = 0
  let high = lineStarts.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const start = lineStarts[mid]!
    const nextStart =
      mid + 1 < lineStarts.length ? lineStarts[mid + 1]! : Number.POSITIVE_INFINITY

    if (index < start) {
      high = mid - 1
    } else if (index >= nextStart) {
      low = mid + 1
    } else {
      return mid
    }
  }

  return Math.max(0, Math.min(lineStarts.length - 1, low))
}

function collectMatchRanges(
  content: string,
  regex: RegExp,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const matchText = match[0] || ''
    const start = match.index
    const end = start + Math.max(matchText.length, 1)
    ranges.push({ start, end })

    if (matchText.length === 0) {
      regex.lastIndex += 1
    }
  }

  return ranges
}

export async function grepVirtualFilesystem(options: {
  pattern: string
  absolutePath: string
  outputMode: 'content' | 'files_with_matches' | 'count'
  caseInsensitive: boolean
  showLineNumbers: boolean
  globPatterns?: string[]
  fileType?: string
  multiline?: boolean
  contextBefore?: number
  contextAfter?: number
  ignorePatterns?: string[]
  exclusionGlobs?: string[]
}): Promise<string[]> {
  const fs = getFsImplementation()
  const {
    pattern,
    absolutePath,
    outputMode,
    caseInsensitive,
    showLineNumbers,
    globPatterns = [],
    fileType,
    multiline = false,
    contextBefore = 0,
    contextAfter = 0,
    ignorePatterns = [],
    exclusionGlobs = [],
  } = options
  const roots: string[] = []
  let rootStat
  try {
    rootStat = await fs.stat(absolutePath)
  } catch {
    return []
  }
  if (rootStat.isDirectory()) {
    roots.push(absolutePath)
  } else {
    roots.push(absolutePath)
  }

  const regexFlags = `g${caseInsensitive ? 'i' : ''}${multiline ? 's' : ''}`
  const regex = new RegExp(pattern, regexFlags)
  const fileMatches = new Map<string, { contentLines: string[]; count: number }>()
  const includeMatchers = globPatterns.map(pattern =>
    picomatch(pattern, { dot: true }),
  )
  const excludeMatchers = exclusionGlobs
    .map(pattern => pattern.trim())
    .filter(Boolean)
    .map(pattern => (pattern.startsWith('!') ? pattern.slice(1) : pattern))
    .map(pattern => picomatch(pattern, { dot: true }))
  const allowedExtensions = fileType
    ? new Set((TYPE_EXTENSION_MAP[fileType] || []).map(ext => ext.toLowerCase()))
    : null
  const shouldIgnorePath = (fullPath: string): boolean =>
    ignorePatterns.some(pattern => {
      if (!pattern) return false
      if (pattern.startsWith('/')) return fullPath.startsWith(pattern)
      return fullPath.includes(pattern)
    })
  const shouldExcludeByGlob = (relativePath: string): boolean =>
    excludeMatchers.some(matcher => matcher(relativePath))
  const shouldIncludeByGlob = (relativePath: string, basename: string): boolean =>
    includeMatchers.length === 0 ||
    includeMatchers.some(matcher => matcher(relativePath) || matcher(basename))

  const walk = async (target: string): Promise<void> => {
    let stats
    try {
      stats = await fs.stat(target)
    } catch {
      return
    }
    if (stats.isDirectory()) {
      let entries
      try {
        entries = await fs.readdir(target)
      } catch {
        return
      }
      for (const entry of entries) {
        const entryName = normalizeDirentName(entry)
        if (!entryName || entryName === '.' || entryName === '..') continue
        if (
          VCS_DIRECTORIES_TO_EXCLUDE.includes(
            entryName as (typeof VCS_DIRECTORIES_TO_EXCLUDE)[number],
          )
        ) {
          continue
        }
        await walk(nodePath.join(target, entryName))
      }
      return
    }
    if (!stats.isFile()) return

    if (shouldIgnorePath(target)) return

    const relativePath = nodePath
      .relative(absolutePath, target)
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
    const basename = nodePath.basename(target)
    if (shouldExcludeByGlob(relativePath)) return
    if (!shouldIncludeByGlob(relativePath, basename)) return
    if (
      allowedExtensions &&
      !allowedExtensions.has(nodePath.extname(target).toLowerCase())
    ) {
      return
    }

    let content = ''
    try {
      content = await fs.readFile(target, { encoding: 'utf8' })
    } catch {
      return
    }
    regex.lastIndex = 0
    const ranges = collectMatchRanges(content, regex)
    const total = ranges.length
    if (total === 0) return

    const contentLines: string[] = []
    if (outputMode === 'content') {
      const lines = content.split(/\r?\n/)
      const lineStarts = buildLineStartOffsets(content)
      const linesToRender = new Set<number>()

      for (const range of ranges) {
        const startLine = findLineIndex(lineStarts, range.start)
        const inclusiveEndIndex = Math.max(range.start, range.end - 1)
        const endLine = findLineIndex(lineStarts, inclusiveEndIndex)
        const from = Math.max(0, startLine - contextBefore)
        const to = Math.min(lines.length - 1, endLine + contextAfter)
        for (let idx = from; idx <= to; idx += 1) {
          linesToRender.add(idx)
        }
      }

      for (const idx of Array.from(linesToRender).sort((a, b) => a - b)) {
        const line = lines[idx] || ''
        const prefix = showLineNumbers ? `${target}:${idx + 1}:` : `${target}:`
        contentLines.push(`${prefix}${line}`)
      }
    }

    fileMatches.set(target, { contentLines, count: total })
  }

  for (const root of roots) {
    await walk(root)
  }

  if (outputMode === 'content') {
    return Array.from(fileMatches.values()).flatMap(v => v.contentLines)
  }
  if (outputMode === 'count') {
    return Array.from(fileMatches.entries()).map(
      ([filePath, v]) => `${filePath}:${v.count}`,
    )
  }
  return Array.from(fileMatches.keys())
}
