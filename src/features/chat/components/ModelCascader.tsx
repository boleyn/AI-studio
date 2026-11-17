import {
  Box,
  Button,
  Divider,
  Flex,
  HStack,
  IconButton,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { Atom, Check, ChevronRight } from "lucide-react";
import MyTooltip from "@/components/ui/MyTooltip";
import { useTranslation } from "next-i18next";
import { useEffect, useMemo, useState } from "react";

import type {
  ChatInputModelGroup,
  ChatInputModelOption,
  ReasoningEffortLevel,
} from "../types/chatInput";

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

const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffortLevel; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
  { value: "off", label: "关闭" },
];

const ModelCascader = ({
  disabled,
  showLabel = false,
  rightSuffix,
  loading,
  model,
  modelOptions,
  modelGroups,
  onChangeModel,
  reasoningEffort,
  onChangeReasoningEffort,
}: {
  disabled: boolean;
  showLabel?: boolean;
  rightSuffix?: string;
  loading?: boolean;
  model: string;
  modelOptions: ChatInputModelOption[];
  modelGroups?: ChatInputModelGroup[];
  onChangeModel: (model: string) => void;
  reasoningEffort?: ReasoningEffortLevel;
  onChangeReasoningEffort?: (effort: ReasoningEffortLevel) => void;
}) => {
  const { t } = useTranslation();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [effortSubmenuOpen, setEffortSubmenuOpen] = useState(false);

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

  useEffect(() => {
    if (!isOpen) setEffortSubmenuOpen(false);
  }, [isOpen]);

  const selectedModelIcon = resolveModelIcon(selectedModelOption);
  const selectedModelLabel = selectedModelOption?.label || "auto";
  const currentEffort = reasoningEffort || "high";
  const currentEffortLabel =
    REASONING_EFFORT_OPTIONS.find((item) => item.value === currentEffort)?.label || "高";

  return (
    <Popover isOpen={isOpen} onClose={onClose} onOpen={onOpen} placement="top-end" gutter={8}>
      <PopoverTrigger>
        <Box>
          <MyTooltip
            fontSize="12px"
            label={`当前模型: ${selectedModelLabel}`}
            openDelay={180}
          >
            {showLabel ? (
              <Button
                size="sm"
                variant="ghost"
                fontWeight="500"
                fontSize="13px"
                h="30px"
                px={2}
                borderRadius="full"
                color="#374151"
                _hover={{ bg: "#f4f4f5" }}
                maxW={{ base: "150px", md: "220px" }}
                aria-label={t("chat:tool_call_model", { defaultValue: "工具调用模型" })}
                isDisabled={disabled || modelOptions.length === 0}
              >
                <Text isTruncated>{selectedModelLabel}</Text>
                {rightSuffix ? (
                  <Text as="span" ml={1.5} color="#9ca3af" fontWeight="400" flexShrink={0}>
                    {rightSuffix}
                  </Text>
                ) : null}
                <Box as="span" ml={1} color="#9ca3af" fontSize="14px" lineHeight="1" aria-hidden="true">
                  ›
                </Box>
              </Button>
            ) : (
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
            )}
          </MyTooltip>
        </Box>
      </PopoverTrigger>

      <PopoverContent
        borderRadius="14px"
        border="1px solid rgba(0, 0, 0, 0.06)"
        boxShadow="0 4px 20px rgba(0, 0, 0, 0.08)"
        minW="220px"
        w="fit-content"
        p={0}
        overflow="visible"
        position="relative"
      >
        <PopoverBody p={1.5} overflow="visible">
          {modelOptions.length === 0 ? (
            <Box px={2.5} py={2}>
              <Text color="gray.500" fontSize="13px">
                {loading
                  ? t("chat:model_loading", { defaultValue: "加载模型中..." })
                  : t("chat:model_empty", { defaultValue: "暂无可用模型" })}
              </Text>
            </Box>
          ) : (
            <VStack align="stretch" spacing={0.5} maxH="320px" overflowY="auto">
              {computedGroups.map((group, groupIndex) => (
                <Box key={group.id}>
                  {computedGroups.length > 1 && (
                    <Text
                      fontSize="11px"
                      fontWeight="500"
                      color="gray.400"
                      px={2.5}
                      pt={groupIndex > 0 ? 1.5 : 0.5}
                      pb={0.5}
                    >
                      {group.label}
                    </Text>
                  )}
                  {group.options.map((item) => {
                    const isSelected = item.value === model;
                    return (
                      <Flex
                        key={item.value}
                        align="center"
                        justify="space-between"
                        gap={4}
                        px={2.5}
                        py={2}
                        borderRadius="9px"
                        cursor="pointer"
                        _hover={{ bg: "#f4f4f5" }}
                        onMouseEnter={() => setEffortSubmenuOpen(false)}
                        onClick={() => {
                          onChangeModel(item.value);
                          onClose();
                        }}
                      >
                        <HStack spacing={2.5} minW={0}>
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
                          <Text
                            fontSize="13.5px"
                            fontWeight={isSelected ? "500" : "400"}
                            color="#18181b"
                            whiteSpace="nowrap"
                          >
                            {item.label}
                          </Text>
                        </HStack>
                        {isSelected && (
                          <Box color="#18181b" flexShrink={0}>
                            <Check size={15} strokeWidth={2} />
                          </Box>
                        )}
                      </Flex>
                    );
                  })}
                </Box>
              ))}
            </VStack>
          )}

          {onChangeReasoningEffort && (
            <>
              <Divider my={1} borderColor="rgba(0, 0, 0, 0.06)" />
              <Box position="relative">
                <Flex
                  align="center"
                  justify="space-between"
                  gap={4}
                  px={2.5}
                  py={2}
                  borderRadius="9px"
                  cursor="pointer"
                  bg={effortSubmenuOpen ? "#f4f4f5" : "transparent"}
                  _hover={{ bg: "#f4f4f5" }}
                  onMouseEnter={() => setEffortSubmenuOpen(true)}
                  onClick={() => setEffortSubmenuOpen((v) => !v)}
                >
                  <HStack spacing={2.5}>
                    <Box color="#18181b" flexShrink={0}>
                      <Atom size={15} strokeWidth={1.8} />
                    </Box>
                    <Text fontSize="13.5px" fontWeight="400" color="#18181b" whiteSpace="nowrap">
                      推理强度
                    </Text>
                  </HStack>
                  <HStack spacing={1} color="#9ca3af">
                    <Text fontSize="13px">{currentEffortLabel}</Text>
                    <ChevronRight size={14} />
                  </HStack>
                </Flex>

                {effortSubmenuOpen && (
                  <Box
                    position="absolute"
                    left="calc(100% + 10px)"
                    bottom="-6px"
                    bg="white"
                    borderRadius="14px"
                    border="1px solid rgba(0, 0, 0, 0.06)"
                    boxShadow="0 4px 20px rgba(0, 0, 0, 0.08)"
                    p={1.5}
                    minW="124px"
                    zIndex={20}
                  >
                    <VStack align="stretch" spacing={0.5}>
                      {REASONING_EFFORT_OPTIONS.map((opt) => {
                        const active = currentEffort === opt.value;
                        return (
                          <Flex
                            key={opt.value}
                            align="center"
                            justify="space-between"
                            gap={3}
                            px={2.5}
                            py={1.5}
                            borderRadius="9px"
                            cursor="pointer"
                            _hover={{ bg: "#f4f4f5" }}
                            onClick={() => {
                              onChangeReasoningEffort(opt.value);
                              setEffortSubmenuOpen(false);
                              onClose();
                            }}
                          >
                            <Text
                              fontSize="13.5px"
                              fontWeight={active ? "500" : "400"}
                              color="#18181b"
                            >
                              {opt.label}
                            </Text>
                            {active && (
                              <Box color="#18181b" flexShrink={0}>
                                <Check size={14} strokeWidth={2} />
                              </Box>
                            )}
                          </Flex>
                        );
                      })}
                    </VStack>
                  </Box>
                )}
              </Box>
            </>
          )}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
};

export default ModelCascader;
