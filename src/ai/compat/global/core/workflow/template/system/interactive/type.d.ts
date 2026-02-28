import type { NodeOutputItemType } from '../../../../chat/type';
import type { FlowNodeOutputItemType } from '../../../type/io';
import type { FlowNodeInputTypeEnum } from '../../../node/constant';
import type { WorkflowIOValueTypeEnum } from '../../../constants';
import type { ChatCompletionMessageParam } from '../../../../ai/type';
import type { AppFileSelectConfigType } from '../../../../app/type';

type InteractiveBasicType = {
  entryNodeIds: string[];
  memoryEdges: RuntimeEdgeItemType[];
  nodeOutputs: NodeOutputItemType[];
  variables?: Record<string, any>;
  skipNodeQueue?: { id: string; skippedNodeIdList: string[] }[]; // 需要记录目前在 queue 里的节点

  usageId?: string;
};

type InteractiveNodeType = {
  entryNodeIds?: string[];
  memoryEdges?: RuntimeEdgeItemType[];
  nodeOutputs?: NodeOutputItemType[];
  variables?: Record<string, any>; // 保存全局变量状态
};

type ChildrenInteractive = InteractiveNodeType & {
  type: 'childrenInteractive';
  params: {
    childrenResponse: WorkflowInteractiveResponseType;
  };
};
type ToolCallChildrenInteractive = InteractiveNodeType & {
  type: 'toolChildrenInteractive';
  params: {
    childrenResponse: WorkflowInteractiveResponseType;
    toolParams: {
      memoryRequestMessages: ChatCompletionMessageParam[]; // 这轮工具中，产生的新的 messages
      toolCallId: string; // 记录对应 tool 的id，用于后续交互节点可以替换掉 tool 的 response
    };
  };
};

// Loop bode
type LoopInteractive = InteractiveNodeType & {
  type: 'loopInteractive';
  params: {
    loopResult: any[];
    childrenResponse: WorkflowInteractiveResponseType;
    currentIndex: number;
  };
};

export type UserSelectOptionItemType = {
  key: string;
  value: string;
};
type UserSelectInteractive = InteractiveNodeType & {
  type: 'userSelect';
  params: {
    description: string;
    userSelectOptions: UserSelectOptionItemType[];
    userSelectedVal?: string;
  };
};

export type UserInputFormItemType = {
  type: FlowNodeInputTypeEnum;
  key: string;
  label: string;
  value: any;
  valueType: WorkflowIOValueTypeEnum;
  description?: string;
  defaultValue?: any;
  required: boolean;

  // input & textarea
  maxLength?: number;

  // password
  minLength?: number;

  // numberInput
  max?: number;
  min?: number;
  // select
  list?: { label: string; value: string }[];

  // File
  canLocalUpload?: boolean;
  canUrlUpload?: boolean;
} & AppFileSelectConfigType;
type UserInputInteractive = InteractiveNodeType & {
  type: 'userInput';
  params: {
    description: string;
    inputForm: UserInputFormItemType[];
    submitted?: boolean;
  };
};

// 欠费暂停交互
export type PaymentPauseInteractive = InteractiveNodeType & {
  type: 'paymentPause';
  params: {
    description?: string;
    continue?: boolean;
  };
};

export type InteractiveNodeResponseType =
  | UserSelectInteractive
  | UserInputInteractive
  | ChildrenInteractive
  | ToolCallChildrenInteractive
  | LoopInteractive
  | PaymentPauseInteractive
  | OutlineInteractive;

export type WorkflowInteractiveResponseType = InteractiveBasicType & InteractiveNodeResponseType;

// Outline interactive: 用于长文大纲确认/再生成
export type OutlineInteractive = InteractiveNodeType & {
  type: 'outlineInteractive';
  params: {
    outlineText: string;
    action?: 'confirm' | 'regenerate';
    regeneratePrompt?: string; // 重新生成时的额外提示词
    confirmPrompt?: string; // 确认时的文章写作额外要求
  };
};
