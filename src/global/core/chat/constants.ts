export enum ChatItemValueTypeEnum {
  text = 'text',
  reasoning = 'reasoning',
  tool = 'tool',
  paragraph = 'paragraph',
  outline = 'outline',
  interactive = 'interactive',
  scheduledTask = 'scheduledTask'
}

export enum ChatRoleEnum {
  Human = 'Human',
  AI = 'AI'
}

export enum ChatStatusEnum {
  loading = 'loading',
  running = 'running',
  finish = 'finish'
}
