import { fetchEventSource, EventStreamContentType } from "@fortaine/fetch-event-source";
import { SseResponseEventEnum } from "@shared/network/sseEvents";
export { SseResponseEventEnum };

export type SseEventName = typeof SseResponseEventEnum[keyof typeof SseResponseEventEnum];

export type StreamQueueItem =
  | {
      event: typeof SseResponseEventEnum.answer;
      text?: string;
      reasoningText?: string;
    }
  | {
      event:
        | typeof SseResponseEventEnum.toolCall
        | typeof SseResponseEventEnum.toolParams
        | typeof SseResponseEventEnum.toolResponse
        | typeof SseResponseEventEnum.flowNodeResponse
        | typeof SseResponseEventEnum.workflowDuration;
      [key: string]: any;
    }
  | {
      event: typeof SseResponseEventEnum.error;
      [key: string]: any;
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
    const failedFinish = (err?: any) => {
      finished = true;
      reject(err);
    };

    const isAnswerEvent = (event: SseEventName) => event === SseResponseEventEnum.answer;

    const animateResponseText = () => {
      if (abortCtrl.signal.aborted) {
        responseQueue.forEach((item) => {
          onMessage(item);
          if (isAnswerEvent(item.event) && item.text) {
            responseText += item.text;
          }
        });
        return finish();
      }

      if (responseQueue.length > 0) {
        const fetchCount = Math.max(1, Math.round(responseQueue.length / 30));
        for (let i = 0; i < fetchCount; i++) {
          const item = responseQueue[i];
          onMessage(item);
          if (isAnswerEvent(item.event) && item.text) {
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
          if (
            !res.ok ||
            !contentType?.startsWith(EventStreamContentType) ||
            res.status !== 200
          ) {
            const errText = await res.clone().text();
            failedFinish(new Error(errText || "stream failed"));
          }
        },
        onmessage: ({ event, data }) => {
          if (data === "[DONE]") {
            finished = true;
            return;
          }

          let parseJson: any = undefined;
          try {
            parseJson = JSON.parse(data);
          } catch {
            parseJson = undefined;
          }

          if (event === SseResponseEventEnum.answer) {
            const text = parseJson?.choices?.[0]?.delta?.content || "";
            const reasoningText = parseJson?.choices?.[0]?.delta?.reasoning_content || "";
            if (reasoningText) {
              pushDataToQueue({ event: SseResponseEventEnum.answer, reasoningText });
            }
            for (const ch of text) {
              pushDataToQueue({ event: SseResponseEventEnum.answer, text: ch });
            }
          } else if (event === SseResponseEventEnum.reasoning) {
            const text = typeof parseJson?.text === "string" ? parseJson.text : "";
            if (text) {
              pushDataToQueue({ event: SseResponseEventEnum.answer, reasoningText: text });
            }
          } else if (
            event === SseResponseEventEnum.toolCall ||
            event === SseResponseEventEnum.toolParams ||
            event === SseResponseEventEnum.toolResponse ||
            event === SseResponseEventEnum.flowNodeResponse ||
            event === SseResponseEventEnum.workflowDuration
          ) {
            if (typeof parseJson === "object") {
              onMessage({ event: event as any, ...parseJson });
            }
          } else if (event === SseResponseEventEnum.error) {
            onMessage({ event: SseResponseEventEnum.error, ...parseJson });
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
