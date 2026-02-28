import type {
  AppTTSConfigType,
  AppFileSelectConfigType,
  AppWhisperConfigType,
  AppAutoExecuteConfigType,
  AppQGConfigType,
  AppUpdateConfigType,
  PrivateDatasetConfigType,
  AppWordCloud3DConfigType
} from './type';

export enum AppTypeEnum {
  folder = 'folder',
  toolFolder = 'toolFolder',
  simple = 'simple',
  agent = 'agent',
  workflow = 'advanced',
  workflowTool = 'plugin',
  mcpToolSet = 'toolSet', // 'mcp'
  httpToolSet = 'httpToolSet',
  hidden = 'hidden',

  // deprecated
  tool = 'tool',
  httpPlugin = 'httpPlugin'
}

export const AppFolderTypeList = [
  AppTypeEnum.folder,
  AppTypeEnum.toolFolder,
  AppTypeEnum.httpPlugin
];

export const ToolTypeList = [
  AppTypeEnum.mcpToolSet,
  AppTypeEnum.httpToolSet,
  AppTypeEnum.workflowTool
];
export const AppTypeList = [AppTypeEnum.simple, AppTypeEnum.agent, AppTypeEnum.workflow];

export const defaultTTSConfig: AppTTSConfigType = { type: 'web' };

export const defaultAutoExecuteConfig: AppAutoExecuteConfigType = {
  open: false,
  defaultPrompt: ''
};

export const defaultWhisperConfig: AppWhisperConfigType = {
  open: false,
  autoSend: false,
  autoTTSResponse: false
};

export const defaultQGConfig: AppQGConfigType = {
  open: false,
  model: 'gpt-5',
  customPrompt: ''
};

export const defaultChatInputGuideConfig = {
  open: false,
  textList: [],
  customUrl: ''
};

export const defaultAppSelectFileConfig: AppFileSelectConfigType = {
  canSelectFile: false,
  canSelectImg: false,
  maxFiles: 10,
  canSelectVideo: false,
  canSelectAudio: false,
  canSelectCustomFileExtension: false,
  customFileExtensionList: []
};

export const defaultUpdateConfig: AppUpdateConfigType = {
  open: false,
  updateUrl: '',
  version: ''
};

export const defaultPrivateDatasetConfig: PrivateDatasetConfigType = {
  enabled: false
};

export enum AppTemplateTypeEnum {
  recommendation = 'recommendation',
  writing = 'writing',
  imageGeneration = 'image-generation',
  webSearch = 'web-search',
  roleplay = 'roleplay',
  officeServices = 'office-services',

  // special type
  contribute = 'contribute'
}

// 添加默认3D词云配置
export const defaultWordCloud3DConfig: AppWordCloud3DConfigType = {
  open: false,
  questions: [],
  autoRotate: true,
  showOnStart: true // 改为 true
};

export const defaultFileExtensionTypes = {
  canSelectFile: ['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.html', '.csv'],
  canSelectImg: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'],
  canSelectVideo: ['.mp4', '.mov', '.avi', '.mpeg', '.webm'],
  canSelectAudio: ['.mp3', '.wav', '.ogg', '.m4a', '.amr', '.mpga'],
  canSelectCustomFileExtension: []
};
export type FileExtensionKeyType = keyof typeof defaultFileExtensionTypes;
export const getUploadFileType = ({
  canSelectFile,
  canSelectImg,
  canSelectVideo,
  canSelectAudio,
  canSelectCustomFileExtension,
  customFileExtensionList
}: {
  canSelectFile?: boolean;
  canSelectImg?: boolean;
  canSelectVideo?: boolean;
  canSelectAudio?: boolean;
  canSelectCustomFileExtension?: boolean;
  customFileExtensionList?: string[];
}) => {
  const types: string[] = [];
  if (canSelectFile) {
    types.push(...defaultFileExtensionTypes.canSelectFile);
  }
  if (canSelectImg) {
    types.push(...defaultFileExtensionTypes.canSelectImg);
  }
  if (canSelectVideo) {
    types.push(...defaultFileExtensionTypes.canSelectVideo);
  }
  if (canSelectAudio) {
    types.push(...defaultFileExtensionTypes.canSelectAudio);
  }
  if (canSelectCustomFileExtension && customFileExtensionList) {
    types.push(...customFileExtensionList);
  }
  return types.join(', ');
};
