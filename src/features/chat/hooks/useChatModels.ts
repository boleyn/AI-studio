import { useState, useEffect } from "react";
import { getChatModels } from "../services/models";
import type { ChatModelCatalog } from "../services/models";

export const useChatModels = () => {
  const [modelLoading, setModelLoading] = useState(false);
  const [channel, setChannel] = useState("aiproxy");
  const [model, setModel] = useState("agent");
  const [modelOptions, setModelOptions] = useState<
    Array<{ value: string; label: string; channel: string; icon?: string }>
  >([{ value: "agent", label: "agent", channel: "aiproxy" }]);
  const [modelCatalog, setModelCatalog] = useState<ChatModelCatalog | null>(null);

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
        const nextModel = (() => {
          const prevMatch = options.find((item) => item.value === model);
          if (prevMatch) return prevMatch.value;
          return catalog.defaultModel || catalog.toolCallModel || options[0]?.value || "agent";
        })();

        setModel(nextModel);
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
  }, []);

  useEffect(() => {
    if (!modelCatalog) return;
    const selected = modelCatalog.models.find((item) => item.id === model);
    if (!selected) return;
    if (selected.channel !== channel) {
      setChannel(selected.channel);
    }
  }, [channel, model, modelCatalog]);

  return {
    model,
    setModel,
    channel,
    modelOptions,
    modelLoading,
    modelCatalog,
  };
};
