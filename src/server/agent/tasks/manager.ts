type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "deleted" | "stopped";

type TaskItem = {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  metadata?: Record<string, unknown>;
  status: TaskStatus;
  blocks: string[];
  blockedBy: string[];
  createdAt: number;
  updatedAt: number;
};

type SessionTaskState = {
  tasks: Map<string, TaskItem>;
  nextId: number;
};

const sessions = new Map<string, SessionTaskState>();

const getOrCreateSession = (sessionId: string): SessionTaskState => {
  const existed = sessions.get(sessionId);
  if (existed) return existed;
  const created: SessionTaskState = {
    tasks: new Map(),
    nextId: 1,
  };
  sessions.set(sessionId, created);
  return created;
};

const cloneTask = (task: TaskItem): TaskItem => ({
  ...task,
  blocks: [...task.blocks],
  blockedBy: [...task.blockedBy],
  metadata: task.metadata ? { ...task.metadata } : undefined,
});

export const createTask = (sessionId: string, input: {
  subject: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  metadata?: Record<string, unknown>;
}): TaskItem => {
  const session = getOrCreateSession(sessionId);
  const id = String(session.nextId++);
  const now = Date.now();
  const task: TaskItem = {
    id,
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm,
    owner: input.owner,
    metadata: input.metadata ? { ...input.metadata } : undefined,
    status: "pending",
    blocks: [],
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
  };
  session.tasks.set(id, task);
  return cloneTask(task);
};

export const getTask = (sessionId: string, taskId: string): TaskItem | null => {
  const session = getOrCreateSession(sessionId);
  const task = session.tasks.get(taskId);
  return task ? cloneTask(task) : null;
};

export const listTasks = (sessionId: string, input?: { pendingOnly?: boolean }): TaskItem[] => {
  const session = getOrCreateSession(sessionId);
  const result = [...session.tasks.values()]
    .filter((task) => (input?.pendingOnly ? task.status === "pending" : task.status !== "deleted"))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(cloneTask);
  return result;
};

export const updateTask = (sessionId: string, taskId: string, patch: {
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  metadata?: Record<string, unknown>;
  status?: TaskStatus;
  addBlocks?: string[];
  addBlockedBy?: string[];
}): TaskItem | null => {
  const session = getOrCreateSession(sessionId);
  const task = session.tasks.get(taskId);
  if (!task) return null;

  if (typeof patch.subject === "string" && patch.subject.trim()) task.subject = patch.subject.trim();
  if (typeof patch.description === "string") task.description = patch.description;
  if (typeof patch.activeForm === "string") task.activeForm = patch.activeForm;
  if (typeof patch.owner === "string") task.owner = patch.owner;
  if (patch.metadata && typeof patch.metadata === "object" && !Array.isArray(patch.metadata)) {
    task.metadata = {
      ...(task.metadata || {}),
      ...patch.metadata,
    };
  }
  if (patch.status) task.status = patch.status;
  if (Array.isArray(patch.addBlocks)) {
    for (const id of patch.addBlocks) {
      if (id && !task.blocks.includes(id)) task.blocks.push(id);
    }
  }
  if (Array.isArray(patch.addBlockedBy)) {
    for (const id of patch.addBlockedBy) {
      if (id && !task.blockedBy.includes(id)) task.blockedBy.push(id);
    }
  }
  task.updatedAt = Date.now();
  return cloneTask(task);
};

