import { z } from 'zod/v4'
import { getProject } from '@server/projects/projectStorage'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getVirtualProjectRoot } from 'src/utils/fsOperations.js'
import { DESCRIPTION, COMPILE_PROJECT_TOOL_NAME, PROMPT } from './prompt.js'

const DEFAULT_LIMIT = 30
const MAX_TEXT_LENGTH = 1200

const ANSI_COLOR_PATTERN = /\x1b\[[0-9;]*m/g
const NOISE_PATTERNS = [
  /hot update/i,
  /hot reload/i,
  /fast refresh/i,
  /hmr/i,
  /rebuild(ing)?/i,
  /compiled successfully/i,
  /waiting for update signal/i,
  /websocket connected/i,
]

const sanitizeText = (text: string): string =>
  text.replace(ANSI_COLOR_PATTERN, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)

const isNoise = (text: string): boolean => {
  if (!text) return true
  return NOISE_PATTERNS.some(pattern => pattern.test(text))
}

const looksLikeError = (text: string): boolean =>
  /\berror\b|\bfailed\b|\bexception\b|\bcannot\b|\bmodule not found\b|\bsyntaxerror\b/i.test(text)

const uniqueRecent = (items: string[], limit: number): string[] => {
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const text = sanitizeText(raw)
    if (!text) continue
    if (seen.has(text)) continue
    seen.add(text)
    deduped.push(text)
  }
  return deduped.slice(-limit)
}

const inputSchema = lazySchema(() =>
  z.object({
    includeLogs: z
      .boolean()
      .optional()
      .describe('Whether to return console logs. Defaults to true.'),
    includeEvents: z
      .boolean()
      .optional()
      .describe('Whether to return compile events. Defaults to true.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Max number of logs/events/errors to return. Defaults to 30.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    ok: z.boolean(),
    message: z.string().optional(),
    status: z
      .enum(['idle', 'compiling', 'success', 'error', 'unknown'])
      .optional(),
    updatedAt: z.string().optional(),
    lastEventType: z.string().optional(),
    lastEventText: z.string().optional(),
    errors: z.array(z.string()).optional(),
    events: z
      .array(
        z.object({
          type: z.string(),
          text: z.string(),
          timestamp: z.string(),
        }),
      )
      .optional(),
    logs: z
      .array(
        z.object({
          method: z.string(),
          text: z.string(),
          timestamp: z.string(),
        }),
      )
      .optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

type Output = z.infer<OutputSchema>

const resolveTokenFromVirtualRoot = (): string | null => {
  const virtualRoot = (getVirtualProjectRoot() || '').trim()
  if (!virtualRoot) return null
  const segments = virtualRoot.split(/[\\/]/).filter(Boolean)
  if (segments.length === 0) return null
  const token = segments[segments.length - 1]
  return token || null
}

export const CompileProjectTool = buildTool({
  name: COMPILE_PROJECT_TOOL_NAME,
  shouldDefer: true,
  searchHint: 'read current project compile/build errors and latest logs',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'compile_project'
  },
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  renderToolUseMessage() {
    return null
  },
  async call(input): Promise<{ data: Output }> {
    const token = resolveTokenFromVirtualRoot()
    if (!token) {
      return {
        data: {
          ok: false,
          message:
            'Project context is unavailable in this runtime. compile_project only works in project-backed sessions.',
        },
      }
    }

    const project = await getProject(token)
    if (!project) {
      return {
        data: {
          ok: false,
          message: 'Project not found for current runtime token.',
        },
      }
    }

    const compileInfo = project.sandpackCompileInfo
    if (!compileInfo) {
      return {
        data: {
          ok: false,
          message:
            'No Sandpack compile info yet. Run the preview once, then call compile_project again.',
        },
      }
    }

    const limit = input.limit ?? DEFAULT_LIMIT
    const includeLogs = input.includeLogs !== false
    const includeEvents = input.includeEvents !== false

    const filteredEvents = compileInfo.events
      .map(event => ({
        ...event,
        text: sanitizeText(event.text),
      }))
      .filter(event => event.text && !isNoise(event.text))
      .slice(-limit)

    const filteredLogs = compileInfo.logs
      .map(log => ({
        ...log,
        text: sanitizeText(log.text),
      }))
      .filter(log => log.text && !isNoise(log.text))
      .slice(-limit)

    let filteredErrors = uniqueRecent(
      compileInfo.errors.map(error => sanitizeText(error)).filter(error => !isNoise(error)),
      limit,
    )

    // Fallback: if explicit errors are empty but status indicates failure,
    // elevate meaningful log/event lines containing strong error signals.
    if (filteredErrors.length === 0 && compileInfo.status === 'error') {
      const fallbackErrorPool = [
        ...filteredEvents.map(event => event.text),
        ...filteredLogs.map(log => log.text),
      ].filter(looksLikeError)
      filteredErrors = uniqueRecent(fallbackErrorPool, limit)
    }

    return {
      data: {
        ok: true,
        status: compileInfo.status,
        updatedAt: compileInfo.updatedAt,
        lastEventType: compileInfo.lastEventType || '',
        lastEventText: sanitizeText(compileInfo.lastEventText || ''),
        errors: filteredErrors,
        events: includeEvents ? filteredEvents : [],
        logs: includeLogs ? filteredLogs : [],
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const result = content as Output
    if (!result.ok) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: result.message || 'compile_project failed',
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(result),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
