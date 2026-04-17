function normalizeAnsiCode(code) {
  if (!code) return { type: 'ansi', code: '', endCode: '' }
  return {
    type: 'ansi',
    code: String(code.code || ''),
    endCode: String(code.endCode || ''),
  }
}

export function tokenize(input = '') {
  return Array.from(String(input)).map((value) => ({
    type: 'char',
    value,
    fullWidth: false,
    styles: [],
  }))
}

export function reduceAnsiCodes(codes = []) {
  return (codes || []).map(normalizeAnsiCode)
}

export function ansiCodesToString(codes = []) {
  return codes.map((c) => c.code || '').join('')
}

export function undoAnsiCodes(codes = []) {
  return (codes || [])
    .map(normalizeAnsiCode)
    .reverse()
    .map((c) => ({ type: 'ansi', code: c.endCode, endCode: c.code }))
}

export function diffAnsiCodes(_from = [], to = []) {
  return reduceAnsiCodes(to)
}

export function styledCharsFromTokens(tokens = []) {
  return (tokens || [])
    .filter((t) => t && t.type === 'char')
    .map((t) => ({
      value: String(t.value || ''),
      styles: Array.isArray(t.styles) ? t.styles.map(normalizeAnsiCode) : [],
    }))
}
