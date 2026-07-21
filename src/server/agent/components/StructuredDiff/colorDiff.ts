import type { SyntaxTheme } from 'color-diff-napi'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'

export type ColorModuleUnavailableReason = 'env'

type ColorDiffCtor = new (...args: any[]) => { render: (...args: any[]) => string[] | null }
type ColorFileCtor = new (...args: any[]) => { render: (...args: any[]) => string[] | null }
type ColorDiffModule = {
  ColorDiff: ColorDiffCtor
  ColorFile: ColorFileCtor
  getSyntaxTheme: (themeName: string) => SyntaxTheme
}

let cachedModule: ColorDiffModule | null | undefined

const loadColorDiffModule = (): ColorDiffModule | null => {
  if (cachedModule !== undefined) return cachedModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('color-diff-napi') as Partial<ColorDiffModule>
    if (
      mod &&
      typeof mod === 'object' &&
      typeof mod.ColorDiff === 'function' &&
      typeof mod.ColorFile === 'function' &&
      typeof mod.getSyntaxTheme === 'function'
    ) {
      cachedModule = mod as ColorDiffModule
      return cachedModule
    }
  } catch {
    // noop: fallback to null
  }
  cachedModule = null
  return null
}

/**
 * Returns a static reason why the color-diff module is unavailable, or null if available.
 * 'env' = disabled via CLAUDE_CODE_SYNTAX_HIGHLIGHT
 *
 * The TS port of color-diff works in all build modes, so the only way to
 * disable it is via the env var.
 */
export function getColorModuleUnavailableReason(): ColorModuleUnavailableReason | null {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT)) {
    return 'env'
  }
  return null
}

export function expectColorDiff(): ColorDiffCtor | null {
  if (getColorModuleUnavailableReason() !== null) return null
  const mod = loadColorDiffModule()
  return mod ? mod.ColorDiff : null
}

export function expectColorFile(): ColorFileCtor | null {
  if (getColorModuleUnavailableReason() !== null) return null
  const mod = loadColorDiffModule()
  return mod ? mod.ColorFile : null
}

export function getSyntaxTheme(themeName: string): SyntaxTheme | null {
  if (getColorModuleUnavailableReason() !== null) return null
  const mod = loadColorDiffModule()
  return mod ? mod.getSyntaxTheme(themeName) : null
}
