'use strict'

function normalizeAnsiCode(code) {
  if (!code) return { type: 'ansi', code: '', endCode: '' }
  return {
    type: 'ansi',
    code: String(code.code || ''),
    endCode: String(code.endCode || ''),
  }
}

function tokenize(input) {
  return Array.from(String(input || '')).map((value) => ({
    type: 'char',
    value,
    fullWidth: false,
    styles: [],
  }))
}

function reduceAnsiCodes(codes) {
  return (codes || []).map(normalizeAnsiCode)
}

function ansiCodesToString(codes) {
  return (codes || []).map((c) => c.code || '').join('')
}

function undoAnsiCodes(codes) {
  return (codes || [])
    .map(normalizeAnsiCode)
    .reverse()
    .map((c) => ({ type: 'ansi', code: c.endCode, endCode: c.code }))
}

function diffAnsiCodes(_from, to) {
  return reduceAnsiCodes(to || [])
}

function styledCharsFromTokens(tokens) {
  return (tokens || [])
    .filter((t) => t && t.type === 'char')
    .map((t) => ({
      value: String(t.value || ''),
      styles: Array.isArray(t.styles) ? t.styles.map(normalizeAnsiCode) : [],
    }))
}

module.exports = {
  tokenize,
  reduceAnsiCodes,
  ansiCodesToString,
  undoAnsiCodes,
  diffAnsiCodes,
  styledCharsFromTokens,
}
