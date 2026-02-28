import { useCallback, useEffect, useRef } from "react";
import { useSandpack, useSandpackConsole } from "@codesandbox/sandpack-react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import type {
  SandpackCompileEvent,
  SandpackCompileInfo,
  SandpackCompileStatus,
  SandpackConsoleLog,
} from "@shared/sandpack/compileInfo";

type SandpackCompileListenerProps = {
  token: string;
};

const MAX_EVENTS = 120;
const MAX_LOGS = 120;
const MAX_ERRORS = 80;
const PUSH_DELAY_MS = 1200;

const toText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const trimList = <T,>(items: T[], max: number): T[] => {
  if (items.length <= max) return items;
  return items.slice(items.length - max);
};

const inferStatus = (type: string, text: string): SandpackCompileStatus | null => {
  const value = `${type} ${text}`.toLowerCase();
  if (/error|failed|exception|crash/.test(value)) return "error";
  if (/success|done|ready|compiled/.test(value)) return "success";
  if (/compile|compil|build|bundl|start|hmr/.test(value)) return "compiling";
  return null;
};

const toLogText = (entry: unknown): string => {
  if (!entry || typeof entry !== "object") return toText(entry);
  const record = entry as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data.map((item) => toText(item)).join(" ");
  if ("data" in record) return toText(record.data);
  return toText(entry);
};

const extractFromMessage = (message: unknown): { type: string; text: string; status: SandpackCompileStatus | null } => {
  if (!message || typeof message !== "object") {
    const text = toText(message);
    return { type: "unknown", text, status: inferStatus("unknown", text) };
  }
  const record = message as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "unknown";
  const textCandidate = [
    record.message,
    record.title,
    record.error,
    record.reason,
    record.details,
    record.status,
    record.event,
  ]
    .map((item) => toText(item).trim())
    .find((item) => item.length > 0);
  const text = textCandidate || toText(message).slice(0, 800);
  return { type, text, status: inferStatus(type, text) };
};

const SandpackCompileListener = ({ token }: SandpackCompileListenerProps) => {
  const { listen } = useSandpack();
  const { logs } = useSandpackConsole({ resetOnPreviewRestart: false });
  const snapshotRef = useRef<SandpackCompileInfo>({
    status: "idle",
    updatedAt: new Date().toISOString(),
    events: [],
    logs: [],
    errors: [],
  });
  const pushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastLogCountRef = useRef(0);
  const lastSentPayloadRef = useRef("");

  const pushToServer = useCallback(async () => {
    if (!token) return;
    const payload = JSON.stringify(snapshotRef.current);
    if (payload === lastSentPayloadRef.current) return;

    try {
      const response = await fetch(`/api/code?token=${encodeURIComponent(token)}&action=compile-info`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({ compileInfo: snapshotRef.current }),
      });
      if (!response.ok) return;
      lastSentPayloadRef.current = payload;
    } catch {
      // ignore upload failures, next events will trigger retries
    }
  }, [token]);

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current) return;
    pushTimerRef.current = setTimeout(() => {
      pushTimerRef.current = null;
      void pushToServer();
    }, PUSH_DELAY_MS);
  }, [pushToServer]);

  useEffect(() => {
    const unsubscribe = listen((message) => {
      const now = new Date().toISOString();
      const parsed = extractFromMessage(message);
      const nextEvent: SandpackCompileEvent = {
        type: parsed.type,
        text: parsed.text,
        timestamp: now,
      };

      const previous = snapshotRef.current;
      const nextStatus = parsed.status ?? previous.status;
      const nextErrors =
        nextStatus === "error" && parsed.text
          ? trimList([...previous.errors, parsed.text], MAX_ERRORS)
          : previous.errors;

      snapshotRef.current = {
        ...previous,
        status: nextStatus,
        updatedAt: now,
        lastEventType: parsed.type,
        lastEventText: parsed.text,
        events: trimList([...previous.events, nextEvent], MAX_EVENTS),
        errors: nextErrors,
      };
      schedulePush();
    });

    return () => {
      unsubscribe();
    };
  }, [listen, schedulePush]);

  useEffect(() => {
    if (!Array.isArray(logs)) return;

    const start = Math.min(lastLogCountRef.current, logs.length);
    const nextLogs = logs.slice(start);
    if (nextLogs.length === 0) return;
    lastLogCountRef.current = logs.length;

    const now = new Date().toISOString();
    const normalizedLogs: SandpackConsoleLog[] = [];
    const nextErrors: string[] = [];

    nextLogs.forEach((entry) => {
      const record = entry as Record<string, unknown>;
      const method =
        record && typeof record.method === "string"
          ? record.method
          : record && typeof record.level === "string"
          ? record.level
          : "log";
      const text = toLogText(entry).trim();
      if (!text) return;

      normalizedLogs.push({
        method,
        text,
        timestamp: now,
      });

      if (/error|warn/i.test(method)) {
        nextErrors.push(text);
      }
    });

    if (normalizedLogs.length === 0) return;
    const previous = snapshotRef.current;
    snapshotRef.current = {
      ...previous,
      status: nextErrors.length > 0 ? "error" : previous.status,
      updatedAt: now,
      logs: trimList([...previous.logs, ...normalizedLogs], MAX_LOGS),
      errors: trimList([...previous.errors, ...nextErrors], MAX_ERRORS),
    };
    schedulePush();
  }, [logs, schedulePush]);

  useEffect(() => {
    return () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      void pushToServer();
    };
  }, [pushToServer]);

  return null;
};

export default SandpackCompileListener;
