import {
  Box,
  Divider,
  Flex,
  IconButton,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import MyTooltip from "@/components/ui/MyTooltip";
import { useTranslation } from "next-i18next";
import { useEffect, useMemo, useState } from "react";

import type { ChatInputModelGroup, ChatInputModelOption } from "../types/chatInput";

const DEFAULT_MODEL_ICON = "/icons/llms/auto.svg";

const inferModelIcon = (option?: Pick<ChatInputModelOption, "value" | "label">) => {
  if (!option) return DEFAULT_MODEL_ICON;
  const hint = `${option.value} ${option.label}`.toLowerCase();
  if (hint.includes("minimax")) return "/icons/llms/minimax.svg";
  if (hint.includes("gemini")) return "/icons/llms/gemini.svg";
  if (hint.includes("openai") || hint.includes("gpt")) return "/icons/llms/openai.svg";
  return DEFAULT_MODEL_ICON;
};

const resolveModelIcon = (option?: ChatInputModelOption) => {
  if (!option) return DEFAULT_MODEL_ICON;
  const icon = option.icon?.trim();
  if (!icon) return inferModelIcon(option);
  if (icon.startsWith("/") || icon.startsWith("http://") || icon.startsWith("https://")) return icon;
  return `/icons/llms/${icon.replace(/^\/+/, "")}`;
};

const ModelCascader = ({
  disabled,
  loading,
  model,
  modelOptions,
  modelGroups,
  onChangeModel,
}: {
  disabled: boolean;
  loading?: boolean;
  model: string;
  modelOptions: ChatInputModelOption[];
  modelGroups?: ChatInputModelGroup[];
  onChangeModel: (model: string) => void;
}) => {
  const { t } = useTranslation();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [activeGroup, setActiveGroup] = useState<"user" | "system">("user");

  const selectedModelOption = useMemo(
    () => modelOptions.find((item) => item.value === model),
    [modelOptions, model]
  );
  const computedGroups = useMemo(() => {
    const groups = (modelGroups || []).filter((group) => group.options.length > 0);
    if (groups.length > 0) return groups;
    const userOptions = modelOptions.filter((item) => item.scope === "user");
    const systemOptions = modelOptions.filter((item) => item.scope !== "user");
    return [
      { id: "user" as const, label: "用户模型", options: userOptions },
      { id: "system" as const, label: "系统模型", options: systemOptions },
    ].filter((group) => group.options.length > 0);
  }, [modelGroups, modelOptions]);
  const selectedScope = selectedModelOption?.scope === "user" ? "user" : "system";
  const currentGroupId =
    computedGroups.find((group) => group.id === activeGroup)?.id ||
    selectedScope ||
    computedGroups[0]?.id ||
    "system";
  const currentOptions = computedGroups.find((group) => group.id === currentGroupId)?.options || [];

  useEffect(() => {
    if (!isOpen) return;
    setActiveGroup(selectedScope);
  }, [isOpen, selectedScope]);

  const selectedModelIcon = resolveModelIcon(selectedModelOption);
  const selectedModelLabel = selectedModelOption?.label || "auto";

  return (
    <Popover isOpen={isOpen} onClose={onClose} onOpen={onOpen} placement="top-start" gutter={8}>
      <PopoverTrigger>
        <Box>
          <MyTooltip
            fontSize="12px"
            label={`当前模型: ${selectedModelLabel}`}
            openDelay={180}
          >
            <IconButton
              _hover={{ bg: "rgba(0, 0, 0, 0.04)" }}
              aria-label={t("chat:tool_call_model", { defaultValue: "工具调用模型" })}
              borderRadius="8px"
              h="30px"
              icon={
                <Box
                  alt={selectedModelLabel}
                  as="img"
                  borderRadius="999px"
                  h="18px"
                  objectFit="cover"
                  src={selectedModelIcon}
                  w="18px"
                />
              }
              isDisabled={disabled || modelOptions.length === 0}
              minW="30px"
              variant="ghost"
            />
          </MyTooltip>
        </Box>
      </PopoverTrigger>

      <PopoverContent borderRadius="12px" maxW="420px" minW="260px" p={0}>
        <PopoverBody p={2}>
          {modelOptions.length === 0 ? (
            <Box px={2} py={1.5}>
              <Text color="gray.500" fontSize="sm">
                {loading
                  ? t("chat:model_loading", { defaultValue: "加载模型中..." })
                  : t("chat:model_empty", { defaultValue: "暂无可用模型" })}
              </Text>
            </Box>
          ) : (
            <Flex minW="320px">
              <VStack align="stretch" maxH="320px" minW="108px" overflowY="auto" spacing={1}>
                {computedGroups.map((group) => (
                  <Box
                    key={group.id}
                    bg={group.id === currentGroupId ? "#EFF6FF" : "transparent"}
                    border={group.id === currentGroupId ? "1px solid #3B82F6" : "1px solid transparent"}
                    borderRadius="8px"
                    cursor="pointer"
                    px={2.5}
                    py={2}
                    onMouseEnter={() => setActiveGroup(group.id)}
                    onClick={() => setActiveGroup(group.id)}
                  >
                    <Text fontSize="sm" fontWeight={group.id === currentGroupId ? "700" : "500"}>
                      {group.label}
                    </Text>
                  </Box>
                ))}
              </VStack>

              <Divider orientation="vertical" mx={2} />

              <VStack align="stretch" maxH="320px" minW="210px" overflowY="auto" spacing={1}>
                {currentOptions.map((item) => (
                  <Box
                    key={item.value}
                    bg={item.value === model ? "#EFF6FF" : "transparent"}
                    border={item.value === model ? "1px solid #3B82F6" : "1px solid transparent"}
                    borderRadius="10px"
                    cursor="pointer"
                    px={3}
                    py={2}
                    onClick={() => {
                      onChangeModel(item.value);
                      onClose();
                    }}
                  >
                    <Flex align="center" gap={2} minW={0}>
                      <Box
                        alt={item.label}
                        as="img"
                        borderRadius="999px"
                        flexShrink={0}
                        h="16px"
                        objectFit="cover"
                        src={resolveModelIcon(item)}
                        w="16px"
                      />
                      <Text className="textEllipsis" fontSize="sm" fontWeight={item.value === model ? "700" : "500"}>
                        {item.label}
                      </Text>
                    </Flex>
                  </Box>
                ))}
              </VStack>
            </Flex>
          )}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
};

export default ModelCascader;
