import { useState } from "react";

type SandpackFile = { code: string; hidden?: boolean };
type SandpackFiles = Record<string, SandpackFile>;

export type AgentFilesSyncPayload = {
  version: number;
  files: SandpackFiles;
};

export const useAgentFileUpdates = () => {
  const [agentFilesSyncPayload, setAgentFilesSyncPayload] =
    useState<AgentFilesSyncPayload | null>(null);

  const queueAgentFileSync = (files: SandpackFiles) => {
    setAgentFilesSyncPayload((prev) => ({
      version: (prev?.version || 0) + 1,
      files,
    }));
  };

  return {
    agentFilesSyncPayload,
    queueAgentFileSync,
  };
};
