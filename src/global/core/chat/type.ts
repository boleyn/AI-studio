import type { ChatItemValueTypeEnum } from './constants';

export type ToolModuleResponseItemType = {
  id?: string;
  toolName?: string;
  toolAvatar?: string;
  params?: string;
  response?: string;
};

export type AIChatItemValueItemType = {
  type: `${ChatItemValueTypeEnum}` | 'text' | 'reasoning' | 'tool' | 'paragraph' | 'outline' | 'interactive' | 'scheduledTask';
  text?: { content: string };
  reasoning?: { content: string };
  tools?: ToolModuleResponseItemType[];
  paragraph?: any;
  outline?: { text: string };
  interactive?: any;
  scheduledTask?: any;
};

export type UserChatItemValueItemType = {
  type: `${ChatItemValueTypeEnum}` | 'text' | 'interactive';
  text?: { content: string };
  interactive?: any;
};

export type ChatItemValueItemType = AIChatItemValueItemType | UserChatItemValueItemType;
