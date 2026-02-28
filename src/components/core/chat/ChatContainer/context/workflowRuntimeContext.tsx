import { createContext } from "use-context-selector";

interface WorkflowRuntimeValue {
  appId: string;
  chatId: string;
  outLinkAuthData: unknown;
}

export const WorkflowRuntimeContext = createContext<WorkflowRuntimeValue>({
  appId: "",
  chatId: "",
  outLinkAuthData: null
});
