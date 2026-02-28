import {
  Box,
  IconButton,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { useTranslation } from "next-i18next";
import { useMemo } from "react";

import type { ChatInputModelOption } from "../types/chatInput";

const ModelCascader = ({
  disabled,
  loading,
  model,
  modelOptions,
  onChangeModel,
}: {
  disabled: boolean;
  loading?: boolean;
  model: string;
  modelOptions: ChatInputModelOption[];
  onChangeModel: (model: string) => void;
}) => {
  const { t } = useTranslation();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const selectedModelOption = useMemo(
    () => modelOptions.find((item) => item.value === model),
    [modelOptions, model]
  );

  return (
    <Popover isOpen={isOpen} onClose={onClose} onOpen={onOpen} placement="top-start" gutter={8}>
      <PopoverTrigger>
        <IconButton
          _hover={{ bg: "rgba(0, 0, 0, 0.04)" }}
          aria-label={t("chat:tool_call_model", { defaultValue: "工具调用模型" })}
          borderRadius="8px"
          h="30px"
          icon={
            selectedModelOption?.icon ? (
              <Box
                alt={selectedModelOption.label}
                as="img"
                borderRadius="999px"
                h="18px"
                objectFit="cover"
                src={selectedModelOption.icon}
                w="18px"
              />
            ) : (
              <Text color="#64748B" fontSize="14px" lineHeight="1">
                AI
              </Text>
            )
          }
          isDisabled={disabled || modelOptions.length === 0}
          minW="30px"
          variant="ghost"
        />
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
            <VStack align="stretch" maxH="320px" minW="220px" overflowY="auto" spacing={1}>
              {modelOptions.map((item) => (
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
                  <Text className="textEllipsis" fontSize="sm" fontWeight={item.value === model ? "700" : "500"}>
                    {item.label}
                  </Text>
                </Box>
              ))}
            </VStack>
          )}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
};

export default ModelCascader;
