import { fetchEventSource, EventStreamContentType } from "@fortaine/fetch-event-source";
import { SdkStreamEventEnum, type SdkStreamEventName } from "@shared/network/sdkStreamEvents";

export { SdkStreamEventEnum };

export type StreamQueueItem = {
  event: SdkStreamEventName;
  [key: string]: unknown;
};

type StreamFetchProps = {
  url: string;
  data: Record<string, any>;
  onMessage: (item: StreamQueueItem) => void;
  abortCtrl: AbortController;
  headers?: HeadersInit;
};

const normalizeHeaders = (headers?: HeadersInit): Record<string, string> => {
  const output: Record<string, string> = {};
  if (!headers) return output;
  if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      output[key] = value;
    });
    return output;
  }
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }
  Object.entries(headers).forEach(([key, value]) => {
    output[key] = String(value);
  });
  return output;
};

export const streamFetch = ({ url, data, onMessage, abortCtrl, headers }: StreamFetchProps) =>
  new Promise<{ responseText: string }>(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      abortCtrl.abort("Time out");
    }, 60000);

    let responseText = "";
    let responseQueue: StreamQueueItem[] = [];
    let finished = false;

    const finish = () => resolve({ responseText });
    const flushQueuedItems = () => {
      if (responseQueue.length === 0) return;
      const queue = responseQueue;
      responseQueue = [];
      queue.forEach((item) => {
        onMessage(item);
        if (item.event === SdkStreamEventEnum.streamEvent && typeof item.text === "string") {
          responseText += item.text;
        }
      });
    };
    const failedFinish = (err?: any) => {
      if (finished) return;
      finished = true;
      flushQueuedItems();
      reject(err);
    };

    const animateResponseText = () => {
      if (abortCtrl.signal.aborted) {
        flushQueuedItems();
        return finish();
      }

      if (responseQueue.length > 0) {
        const fetchCount = Math.max(1, Math.round(responseQueue.length / 30));
        for (let i = 0; i < fetchCount; i++) {
          const item = responseQueue[i];
          onMessage(item);
          if (item.event === SdkStreamEventEnum.streamEvent && typeof item.text === "string") {
            responseText += item.text;
          }
        }
        responseQueue = responseQueue.slice(fetchCount);
      }

      if (finished && responseQueue.length === 0) {
        return finish();
      }

      requestAnimationFrame(animateResponseText);
    };

    animateResponseText();

    const pushDataToQueue = (payload: StreamQueueItem) => {
      responseQueue.push(payload);
      if (document.hidden) {
        animateResponseText();
      }
    };

    try {
      await fetchEventSource(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...normalizeHeaders(headers) },
        signal: abortCtrl.signal,
        body: JSON.stringify(data),
        async onopen(res) {
          clearTimeout(timeoutId);
          const contentType = res.headers.get("content-type");
          if (!res.ok || !contentType?.startsWith(EventStreamContentType) || res.status !== 200) {
            const errText = await res.clone().text();
            failedFinish(new Error(errText || "stream failed"));
          }
        },
        onmessage: ({ event, data }) => {
          if (data === "[DONE]") {
            finished = true;
            return;
          }

          const normalizedEvent = (
            event === SdkStreamEventEnum.message ||
            event === SdkStreamEventEnum.streamEvent ||
            event === SdkStreamEventEnum.status ||
            event === SdkStreamEventEnum.control ||
            event === SdkStreamEventEnum.done ||
            event === SdkStreamEventEnum.error
              ? event
              : SdkStreamEventEnum.status
          ) as SdkStreamEventName;

          let parseJson: unknown = undefined;
          try {
            parseJson = JSON.parse(data);
          } catch {
            parseJson = undefined;
          }

          if (parseJson && typeof parseJson === "object") {
            pushDataToQueue({ event: normalizedEvent, ...(parseJson as Record<string, unknown>) });
          } else {
            pushDataToQueue({ event: normalizedEvent, data: parseJson ?? data });
          }
        },
        onclose() {
          finished = true;
        },
        onerror(err) {
          clearTimeout(timeoutId);
          failedFinish(err);
        },
        openWhenHidden: true,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      failedFinish(err);
    }
  });
