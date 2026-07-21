import type { Attachment } from '../../utils/attachments.js'
import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { extractTextContent } from '../../utils/messages.js'
import { isSkillSearchEnabled } from './featureCheck.js'
import { searchSkills } from './localSearch.js'
import { createDiscoverySignal } from './signals.js'

const isLikelySkillDiscoveryInput = (input: string | null): boolean => {
  if (!input) return false
  const normalized = input.toLowerCase()
  return (
    normalized.includes('/')
    || normalized.includes('skill')
    || normalized.includes('workflow')
    || normalized.includes('验证')
    || normalized.includes('发布')
    || normalized.includes('review')
    || normalized.includes('测试')
    || normalized.includes('部署')
  )
}

const extractLatestUserText = (messages: Message[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.type !== 'user') continue
    return extractTextContent(msg.message?.content).trim()
  }
  return ''
}

const buildSkillDiscoveryAttachment = async (
  query: string,
  context: ToolUseContext,
  signalType: 'turn_zero_user_input' | 'assistant_turn_prefetch'
): Promise<Attachment | null> => {
  const cwd = getCwd()
  const skills = await searchSkills(cwd, query, 6)
  if (skills.length === 0) return null

  if (context.discoveredSkillNames) {
    for (const skill of skills) context.discoveredSkillNames.add(skill.name)
  }

  return {
    type: 'skill_discovery',
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description || 'No description',
    })),
    signal: createDiscoverySignal(signalType, query),
    source: 'native',
  }
}

export const startSkillDiscoveryPrefetch: (
  input: string | null,
  messages: Message[],
  toolUseContext: ToolUseContext,
) => Promise<Attachment[]> = (async (input, messages, toolUseContext) => {
  if (!isSkillSearchEnabled()) return []
  const candidate = (input || extractLatestUserText(messages) || '').trim()
  if (!candidate) return []
  if (!isLikelySkillDiscoveryInput(candidate)) return []

  const attachment = await buildSkillDiscoveryAttachment(
    candidate,
    toolUseContext,
    'assistant_turn_prefetch'
  )
  return attachment ? [attachment] : []
});

export const collectSkillDiscoveryPrefetch: (
  pending: Promise<Attachment[]>,
) => Promise<Attachment[]> = (async (pending) => {
  try {
    return await pending
  } catch {
    return []
  }
});

export const getTurnZeroSkillDiscovery: (
  input: string,
  messages: Message[],
  context: ToolUseContext,
) => Promise<Attachment | null> = (async (input, _messages, context) => {
  if (!isSkillSearchEnabled()) return null
  const query = (input || '').trim()
  if (!query) return null
  if (!isLikelySkillDiscoveryInput(query)) return null
  return buildSkillDiscoveryAttachment(query, context, 'turn_zero_user_input')
});
