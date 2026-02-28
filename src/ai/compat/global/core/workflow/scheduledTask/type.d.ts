export type ScheduledTaskScheduleType = {
  type: 'none' | 'delay' | 'cron';
  value?: string | number;
  timezone?: string;
};

export type ScheduledTaskStatusType = 'active' | 'paused' | 'completed';
export type ScheduledTaskRunStatusType = 'none' | 'running' | 'success' | 'failed';

export type ScheduledTaskTargetType = 'app' | 'plugin' | 'http' | 'tool';

export type ScheduledTaskTargetTypeInfo = {
  type: ScheduledTaskTargetType;
  nodeId: string;
  appId: string;
  pluginId?: string;
};

export type ScheduledTaskSchemaType = {
  _id: string;
  teamId: string;
  tmbId: string;
  userId?: string;
  outLinkUid?: string;
  appId: string;
  chatId?: string;
  lastChatId?: string;
  lastRunTime?: Date;
  lastRunStatus?: ScheduledTaskRunStatusType;
  lastRunError?: string;
  subWorkflowId?: string;
  target?: ScheduledTaskTargetTypeInfo;
  targetNode?: import('../type/node').StoreNodeItemType;
  targetName?: string;
  targetAvatar?: string;
  sourceNodeId?: string;
  sourceNodeOutputs?: Record<string, any>;
  schedule: ScheduledTaskScheduleType;
  type: ScheduledTaskScheduleType['type'];
  value?: ScheduledTaskScheduleType['value'];
  nextRunTime?: Date;
  inputs?: Record<string, any>;
  status: ScheduledTaskStatusType;
  createTime: Date;
  updateTime: Date;
};

export type ScheduledTaskCardType = {
  taskId: string;
  appId: string;
  tmbId?: string;
  userId?: string;
  outLinkUid?: string;
  sourceAppName?: string;
  sourceAppAvatar?: string;
  sourceMemberName?: string;
  chatId?: string;
  lastChatId?: string;
  lastRunTime?: Date | string;
  lastRunStatus?: ScheduledTaskRunStatusType;
  lastRunError?: string;
  targetType: ScheduledTaskTargetType;
  targetNodeId: string;
  targetName?: string;
  targetAvatar?: string;
  taskTitle?: string;
  schedule: ScheduledTaskScheduleType;
  status: ScheduledTaskStatusType;
  nextRunTime?: Date | string;
  createTime?: Date | string;
};

export type ScheduledTaskListItemType = ScheduledTaskCardType & {
  createTime: Date | string;
  updateTime: Date | string;
};

export type ScheduledTaskRunListItemType = {
  chatId: string;
  status?: ScheduledTaskRunStatusType;
  error?: string;
  inputs?: Record<string, any>;
  createTime: Date | string;
  updateTime: Date | string;
};
