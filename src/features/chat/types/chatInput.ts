import type { UploadedFileArtifact } from "./fileArtifact";

export interface ChatInputFile {
  id: string;
  file: File;
}

export interface ChatInputSubmitPayload {
  text: string;
  files: ChatInputFile[];
  uploadedFiles: UploadedFileArtifact[];
  planModeApprovalResponse?: {
    action: "enter" | "exit";
    decision: "approve" | "reject";
  };
  selectedSkill?: string;
  selectedSkills?: string[];
  selectedFilePaths?: string[];
  thinkingEnabled?: boolean;
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

export interface ChatInputProps {
  isSending: boolean;
  model: string;
  modelOptions: ChatInputModelOption[];
  modelGroups?: ChatInputModelGroup[];
  modelLoading?: boolean;
  thinkingEnabled?: boolean;
  showThinkingToggle?: boolean;
  mode?: "default" | "plan";
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
  onChangeModel: (model: string) => void;
  onChangeThinkingEnabled?: (enabled: boolean) => void;
  onChangeSelectedSkill?: (skillName?: string) => void;
  onChangeSelectedSkills?: (skillNames: string[]) => void;
  onUploadFiles: (files: ChatInputFile[]) => Promise<UploadedFileArtifact[]>;
  onStop?: () => void;
  onSend: (payload: ChatInputSubmitPayload) => Promise<void> | void;
}
