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
    Array<{ value: string; label: string; channel: string; scope?: "user" | "system"; icon?: string; reasoning?: boolean }>
  >([{ value: "agent", label: "agent", channel: "aiproxy", scope: "system" }]);
  const [modelGroups, setModelGroups] = useState<
    Array<{ id: "user" | "system"; label: string; options: Array<{ value: string; label: string; channel: string; scope?: "user" | "system"; icon?: string; reasoning?: boolean }> }>
  >([]);
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
                scope: item.scope || "system",
                icon: item.icon,
                reasoning: item.reasoning,
              };
            })
          : [
              {
                value: catalog.defaultModel || catalog.toolCallModel || "agent",
                label: catalog.defaultModel || catalog.toolCallModel || "agent",
                channel: catalog.defaultChannel || "aiproxy",
                scope: "system" as const,
              },
            ];
        setModelOptions(options);
        const groupFromCatalog = Array.isArray(catalog.groups)
          ? catalog.groups
              .filter((group): group is { id: "user" | "system"; label: string; models: string[] } =>
                group.id === "user" || group.id === "system"
              )
              .map((group) => ({
                id: group.id,
                label: group.label,
                options: options.filter((item) => group.models.includes(item.value)),
              }))
              .filter((group) => group.options.length > 0)
          : [];
        const derivedGroups =
          groupFromCatalog.length > 0
            ? groupFromCatalog
            : [
                {
                  id: "user" as const,
                  label: "用户模型",
                  options: options.filter((item) => item.scope === "user"),
                },
                {
                  id: "system" as const,
                  label: "系统模型",
                  options: options.filter((item) => item.scope !== "user"),
                },
              ].filter((group) => group.options.length > 0);
        setModelGroups(derivedGroups);
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
        setModelOptions([{ value: "agent", label: "agent", channel: "aiproxy", scope: "system" }]);
        setModelGroups([{ id: "system", label: "系统模型", options: [{ value: "agent", label: "agent", channel: "aiproxy", scope: "system" }] }]);
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
    modelGroups,
    modelLoading,
    modelCatalog,
  };
};
