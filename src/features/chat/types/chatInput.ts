import type { CloudHostStatus } from "@shared/sandbox/cloudHostStatus";
import type { UploadedFileArtifact } from "./fileArtifact";

export type ReasoningEffortLevel = "off" | "low" | "medium" | "high" | "xhigh";

export const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffortLevel;
  label: string;
  shortLabel: string;
}> = [
  { value: "low", label: "低", shortLabel: "低" },
  { value: "medium", label: "中", shortLabel: "中" },
  { value: "high", label: "高", shortLabel: "高" },
  { value: "xhigh", label: "超高", shortLabel: "超高" },
  { value: "off", label: "关闭", shortLabel: "关" },
];

export const getReasoningEffortLabel = (
  effort?: ReasoningEffortLevel,
  short = false,
): string => {
  const found = REASONING_EFFORT_OPTIONS.find((item) => item.value === (effort || "high"));
  if (!found) return "高";
  return short ? found.shortLabel : found.label;
};

export interface ChatInputFile {
  id: string;
  file: File;
}

export interface ChatInputSubmitPayload {
  text: string;
  files: ChatInputFile[];
  uploadedFiles: UploadedFileArtifact[];
  permissionApprovalResponse?: {
    requestId?: string;
    toolName: string;
    toolUseId?: string;
    decision: "approve" | "reject";
    note?: string;
  };
  planQuestionResponse?: {
    requestId: string;
    answers: Record<string, string>;
    note?: string;
  };
  planModeApprovalResponse?: {
    requestId: string;
    action: "enter" | "exit";
    decision: "approve" | "reject";
    note?: string;
  };
  selectedSkill?: string;
  selectedSkills?: string[];
  selectedFilePaths?: string[];
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffortLevel;
}

export interface ChatInputModelOption {
  value: string;
  label: string;
  channel: string;
  scope?: "user" | "system";
  icon?: string;
  reasoning?: boolean;
}

export interface ChatInputModelGroup {
  id: "user" | "system";
  label: string;
  options: ChatInputModelOption[];
}

export interface WorkspaceComposerDeviceOption {
  platform?: string;
  deviceId: string;
  name: string;
  online: boolean;
}

export interface WorkspaceComposerConfig {
  deviceAccessKind?: "remote-vm" | "connector";
  deviceAccessLabel?: string;
  selectedDeviceId?: string;
  cloudHostStatus?: CloudHostStatus;
  devices?: WorkspaceComposerDeviceOption[];
  requestingDeviceAccess?: boolean;
  onClearDeviceAccess?: () => void;
  onSelectCloudHost?: () => void;
  onOpenHostMenu?: () => void;
  onSelectDeviceHost?: (device: WorkspaceComposerDeviceOption) => void;
  onOpenDeviceManagement?: () => void;
  projectToken?: string;
  projectName?: string;
  projects?: Array<{ token: string; name: string }>;
  onSelectProject?: (token: string) => void;
  onCreateProject?: () => void;
}

export interface ChatInputProps {
  placeholder?: string;
  artifactRevision?: { text: string; onApplied: () => void };
  draftStorageKey?: string;
  workspaceLayout?: boolean;
  workspaceComposer?: WorkspaceComposerConfig;
  isSending: boolean;
  model: string;
  modelOptions: ChatInputModelOption[];
  modelGroups?: ChatInputModelGroup[];
  modelLoading?: boolean;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffortLevel;
  showThinkingToggle?: boolean;
  mode?: "default" | "plan" | "goal";
  thinkingTooltipEnabled?: string;
  thinkingTooltipDisabled?: string;
  selectedSkill?: string;
  selectedSkills?: string[];
  skillOptions?: Array<{
    name: string;
    description?: string;
  }>;
  fileOptions?: string[];
  prefillText?: string;
  prefillVersion?: number;
  addFileRequest?: { path: string; version: number } | null;
  onChangeModel: (model: string) => void;
  onChangeMode?: (mode: "default" | "plan" | "goal") => void;
  onChangeThinkingEnabled?: (enabled: boolean) => void;
  onChangeReasoningEffort?: (effort: ReasoningEffortLevel) => void;
  onChangeSelectedSkill?: (skillName?: string) => void;
  onChangeSelectedSkills?: (skillNames: string[]) => void;
  onUploadFiles: (files: ChatInputFile[]) => Promise<UploadedFileArtifact[]>;
  onStop?: () => void;
  onSend: (payload: ChatInputSubmitPayload) => Promise<void> | void;
}
