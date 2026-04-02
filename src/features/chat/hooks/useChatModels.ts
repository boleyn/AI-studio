import { useState, useEffect, useRef } from "react";
import { getChatModels } from "../services/models";
import type { ChatModelCatalog } from "../services/models";

const PREFERRED_CHAT_MODEL_STORAGE_KEY = "aistudio.preferredChatModel";

const readPreferredChatModel = () => {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PREFERRED_CHAT_MODEL_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
};

const persistPreferredChatModel = (model: string) => {
  if (typeof window === "undefined") return;
  try {
    const next = model.trim();
    if (!next) return;
    window.localStorage.setItem(PREFERRED_CHAT_MODEL_STORAGE_KEY, next);
  } catch {
    // Ignore storage failures in private mode or restricted contexts.
  }
};

export const useChatModels = (primaryModel?: string) => {
  const [modelLoading, setModelLoading] = useState(false);
  const [channel, setChannel] = useState("aiproxy");
  const [model, setModel] = useState("agent");
  const [modelOptions, setModelOptions] = useState<
    Array<{ value: string; label: string; channel: string; icon?: string }>
  >([{ value: "agent", label: "agent", channel: "aiproxy" }]);
  const [modelCatalog, setModelCatalog] = useState<ChatModelCatalog | null>(null);
  const appliedPrimaryModelRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setModelLoading(true);
    getChatModels()
      .then((catalog) => {
        if (!active) return;
        setModelCatalog(catalog);

        const options = catalog.models.length
          ? catalog.models.map((item) => {
              return {
                value: item.id,
                label: item.label || item.id,
                channel: item.channel,
                icon: item.icon,
              };
            })
          : [
              {
                value: catalog.defaultModel || catalog.toolCallModel || "agent",
                label: catalog.defaultModel || catalog.toolCallModel || "agent",
                channel: catalog.defaultChannel || "aiproxy",
              },
            ];
        setModelOptions(options);
        const preferredModel = primaryModel?.trim() || readPreferredChatModel();
        const nextModel = (() => {
          if (preferredModel) {
            const preferredMatch = options.find((item) => item.value === preferredModel);
            if (preferredMatch) return preferredMatch.value;
          }
          const prevMatch = options.find((item) => item.value === model);
          if (prevMatch) return prevMatch.value;
          return catalog.defaultModel || catalog.toolCallModel || options[0]?.value || "agent";
        })();

        setModel(nextModel);
        persistPreferredChatModel(nextModel);
        const selectedModel = options.find((item) => item.value === nextModel);
        setChannel(selectedModel?.channel || catalog.defaultChannel || "aiproxy");
      })
      .catch(() => {
        if (!active) return;
        setModelCatalog(null);
        setChannel("aiproxy");
        setModelOptions([{ value: "agent", label: "agent", channel: "aiproxy" }]);
      })
      .finally(() => {
        if (active) setModelLoading(false);
      });

    return () => {
      active = false;
    };
  }, [primaryModel]);

  useEffect(() => {
    if (!modelCatalog) return;
    const selected = modelCatalog.models.find((item) => item.id === model);
    if (!selected) return;
    if (selected.channel !== channel) {
      setChannel(selected.channel);
    }
  }, [channel, model, modelCatalog]);

  useEffect(() => {
    if (!modelCatalog || !primaryModel) return;
    if (appliedPrimaryModelRef.current === primaryModel) return;
    const selected = modelCatalog.models.find((item) => item.id === primaryModel);
    if (!selected) return;

    appliedPrimaryModelRef.current = primaryModel;
    setModel(primaryModel);
    persistPreferredChatModel(primaryModel);
    setChannel(selected.channel);
  }, [modelCatalog, primaryModel]);

  useEffect(() => {
    persistPreferredChatModel(model);
  }, [model]);

  return {
    model,
    setModel,
    channel,
    modelOptions,
    modelLoading,
    modelCatalog,
  };
};
