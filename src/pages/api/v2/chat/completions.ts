import "module-alias/register";
import type {
  ChatCompletionMessageParam,
} from "@aistudio/ai/compat/global/core/ai/type";
import { getAgentRuntimeConfig } from "@server/agent/runtimeConfig";
import { requireAuth } from "@server/auth/session";
import { getProject, updateFile } from "@server/projects/projectStorage";
import {
  appendConversationMessages,
  type ConversationMessage,
} from "@server/conversations/conversationStorage";
import {
  registerActiveConversationRun,
  unregisterActiveConversationRun,
} from "@server/chat/activeRuns";
import { bindAgentAbortToConnection } from "@server/chat/completions/agentConnectionLifecycle";
import { runClaudeQueryAdapter } from "@server/agent/runtime/claudeQueryAdapter";
import { resolveRuntimeStrategy } from "@server/agent/runtime/runtimeStrategy";
import { createDataId } from "@shared/chat/ids";
import { extractText } from "@shared/chat/messages";
import {
  createSdkMessage,
  sdkContentToText,
  type SdkContentBlock,
  type SdkMessage,
} from "@shared/chat/sdkMessages";
import { SdkStreamEventEnum, type SdkStreamEventName } from "@shared/network/sdkStreamEvents";
import { sendSseEvent, startSse, startSseHeartbeat } from "@server/http/sse";
import type { NextApiRequest, NextApiResponse } from "next";

type RequestBodyMessage = {
  type?: string;
  role?: string;
  uuid?: string;
  timestamp?: string;
  content?: unknown;
  message?: {
    role?: string;
    content?: unknown;
  };
  meta?: Record<string, unknown>;
};

const getToken = (req: NextApiRequest): string | null => {
  const headerToken =
    typeof req.headers["x-project-token"] === "string"
      ? req.headers["x-project-token"]
      : null;
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
  return headerToken ?? bodyToken ?? queryToken;
};

const toSdkMessages = (messages: unknown): SdkMessage[] => {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const msg = item as RequestBodyMessage;
      const role = (msg.type || msg.role || msg.message?.role || "").trim();
      if (!role || !["user", "assistant", "system", "tool"].includes(role)) return null;
      return createSdkMessage({
        type: role === "tool" ? "assistant" : (role as SdkMessage["type"]),
        uuid: typeof msg.uuid === "string" ? msg.uuid : undefined,
        timestamp: typeof msg.timestamp === "string" ? msg.timestamp : undefined,
        message: {
          role: role as "user" | "assistant" | "system" | "tool",
          content: (() => {
            const raw = msg.message?.content ?? msg.content;
            if (typeof raw === "string") return raw;
            if (Array.isArray(raw)) return raw as SdkContentBlock[];
            return extractText(raw);
          })(),
        },
        ...(msg.meta ? { meta: msg.meta } : {}),
      });
    })
    .filter((item): item is SdkMessage => Boolean(item));
};

const toAgentMessages = (messages: SdkMessage[]): ChatCompletionMessageParam[] =>
  messages
    .map((message) => {
      const role = message.message?.role || "user";
      if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") {
        return null;
      }
      const content = message.message?.content;
      if (role === "tool") {
        return {
          role: "tool",
          tool_call_id: createDataId(),
          content: sdkContentToText(content),
        } as ChatCompletionMessageParam;
      }
      return {
        role,
        content:
          typeof content === "string"
            ? content
            : Array.isArray(content)
            ? content
            : sdkContentToText(content),
      } as ChatCompletionMessageParam;
    })
    .filter((item): item is ChatCompletionMessageParam => Boolean(item));

const toConversationMessage = (message: SdkMessage): ConversationMessage => {
  const role = message.message?.role || "assistant";
  const content = message.message?.content ?? "";
  return {
    type: message.type,
    role: role === "tool" ? "assistant" : (role as ConversationMessage["role"]),
    content,
    id: message.uuid,
    time: new Date(message.timestamp),
    uuid: message.uuid,
    timestamp: message.timestamp,
    message: message.message,
    meta: message.meta,
    additional_kwargs: {
      sdkMessage: message,
    },
  };
};

const streamEvent = (
  res: NextApiResponse,
  event: SdkStreamEventName,
  data: Record<string, unknown>
) => {
  sendSseEvent(res, event, JSON.stringify(data));
};

const normalizeUpdatedFiles = (
  value: unknown
): Record<string, { code: string }> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, { code: string }> = {};
  for (const [rawPath, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!rawPath || typeof rawPath !== "string") continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const code = (entry as { code?: unknown }).code;
    if (typeof code !== "string") continue;
    const normalizedPath = rawPath.trim().replace(/\\/g, "/");
    if (!normalizedPath) continue;
    const workspacePath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
    output[workspacePath] = { code };
  }
  return output;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const token = getToken(req);
  if (!token) {
    res.status(400).json({ error: "缺少 token 参数" });
    return;
  }

  const project = await getProject(token);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }

  const sdkMessages = toSdkMessages(req.body?.messages);
  if (sdkMessages.length === 0) {
    res.status(400).json({ error: "缺少 messages" });
    return;
  }

  const stream = req.body?.stream !== false;
  const conversationId =
    typeof req.body?.conversation_id === "string"
      ? req.body.conversation_id
      : typeof req.body?.conversationId === "string"
      ? req.body.conversationId
      : undefined;
  const selectedModel =
    typeof req.body?.model === "string" && req.body.model.trim()
      ? req.body.model.trim()
      : getAgentRuntimeConfig().toolCallModel;
  const selectedSkills = Array.isArray(req.body?.selectedSkills)
    ? req.body.selectedSkills
        .filter((item: unknown): item is string => typeof item === "string")
        .map((item: string) => item.trim())
        .filter(Boolean)
    : typeof req.body?.selectedSkill === "string" && req.body.selectedSkill.trim()
    ? [req.body.selectedSkill.trim()]
    : [];
  const runtimeStrategy = resolveRuntimeStrategy(req.body?.runtimeStrategy);
  const permissionMode =
    typeof req.body?.permissionMode === "string" && req.body.permissionMode.trim()
      ? req.body.permissionMode.trim()
      : typeof req.body?.mode === "string" && req.body.mode.trim()
      ? req.body.mode.trim()
      : undefined;

  if (!stream) {
    res.status(400).json({ error: "v2 chat requires stream=true" });
    return;
  }

  startSse(res);
  const stopHeartbeat = startSseHeartbeat(res);

  const abortController = new AbortController();
  bindAgentAbortToConnection({
    req,
    res,
    controller: abortController,
    scope: `v2-chat:${token}:${conversationId || "new"}`,
  });

  const chatId = conversationId || `project-${token}`;
  registerActiveConversationRun({ token, chatId, controller: abortController });

  try {
    console.log("[skill-debug][v2-chat-request]", {
      token,
      conversationId,
      selectedModel,
      selectedSkills,
      sdkMessageCount: sdkMessages.length,
      agentMessageCount: toAgentMessages(sdkMessages).length,
    });

    const streamedUpdatedFiles: Record<string, { code: string }> = {};
    const runtimeStatusLog = (event: SdkStreamEventName, data: Record<string, unknown>) => {
      if (
        event === SdkStreamEventEnum.status &&
        (data.phase === "runtime_selected" || data.phase === "query_engine_attempt")
      ) {
        console.info("[v2/chat runtime]", {
          phase: data.phase,
          strategy: data.strategy,
          ok: data.ok,
          error: data.error,
          resultSubtype: data.resultSubtype,
          stopReason: data.stopReason,
        });
      }
    };

    const runResult = await runClaudeQueryAdapter({
      token,
      chatId,
      selectedModel,
      selectedSkills,
      historyMessages: req.body?.messages,
      projectFiles: project.files || {},
      permissionMode,
      messages: toAgentMessages(sdkMessages),
      abortSignal: abortController.signal,
      onEvent: (event, data) => {
        if (event === SdkStreamEventEnum.streamEvent && data.subtype === "files_updated") {
          const normalized = normalizeUpdatedFiles(data.files);
          Object.assign(streamedUpdatedFiles, normalized);
        }
        runtimeStatusLog(event, data);
        streamEvent(res, event, data);
      },
      runtimeStrategy,
    });

    const updatedFiles = {
      ...streamedUpdatedFiles,
      ...normalizeUpdatedFiles(runResult.updatedFiles),
    };

    if (Object.keys(updatedFiles).length > 0) {
      await Promise.all(
        Object.entries(updatedFiles).map(([filePath, file]) =>
          updateFile(token, filePath, file.code)
        )
      );
      streamEvent(res, SdkStreamEventEnum.streamEvent, {
        subtype: "files_updated",
        files: updatedFiles,
      });
    }

    if (selectedSkills.length > 0) {
      streamEvent(res, SdkStreamEventEnum.status, {
        phase: "skills_selected",
        selectedSkills,
      });
    }

    streamEvent(res, SdkStreamEventEnum.message, {
      message: runResult.assistantMessage,
    });

    if (conversationId) {
      const incomingMessages = sdkMessages
        .filter((message) => (message.message?.role || "user") === "user")
        .map(toConversationMessage);
      const assistantStored = toConversationMessage(runResult.assistantMessage);
      await appendConversationMessages(token, conversationId, [
        ...incomingMessages,
        assistantStored,
      ]);
    }

    streamEvent(res, SdkStreamEventEnum.done, {
      reason: "completed",
    });
  } catch (error) {
    streamEvent(res, SdkStreamEventEnum.error, {
      message: error instanceof Error ? error.message : String(error ?? "未知错误"),
    });
  } finally {
    unregisterActiveConversationRun({ token, chatId, controller: abortController });
    stopHeartbeat();
    res.end();
  }
}
