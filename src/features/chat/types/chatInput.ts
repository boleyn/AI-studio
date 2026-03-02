import type { UploadedFileArtifact } from "./fileArtifact";

export interface ChatInputFile {
  id: string;
  file: File;
}

export interface ChatInputSubmitPayload {
  text: string;
  files: ChatInputFile[];
  uploadedFiles: UploadedFileArtifact[];
  selectedSkill?: string;
  selectedSkills?: string[];
  selectedFilePaths?: string[];
}

export interface ChatInputModelOption {
  value: string;
  label: string;
  channel: string;
  icon?: string;
}

export interface ChatInputProps {
  isSending: boolean;
  model: string;
  modelOptions: ChatInputModelOption[];
  modelLoading?: boolean;
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
  onChangeSelectedSkill?: (skillName?: string) => void;
  onChangeSelectedSkills?: (skillNames: string[]) => void;
  onUploadFiles: (files: ChatInputFile[]) => Promise<UploadedFileArtifact[]>;
  onStop?: () => void;
  onSend: (payload: ChatInputSubmitPayload) => Promise<void> | void;
}
