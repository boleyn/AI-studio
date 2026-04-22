import { Box, Flex, Icon, Menu, MenuButton, MenuItem, MenuList, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "@/components/common/Icon";
import MyTooltip from "@/components/ui/MyTooltip";
import { useCopyData } from "@/hooks/useCopyData";

type CopyFormat = "text" | "markdown";

const COPY_SUCCESS_TIMEOUT_MS = 2000;

const convertMarkdownToPlainText = (markdown: string): string => {
  let plainText = markdown.replace(/\r\n/g, "\n");
  const codeBlocks: string[] = [];
  plainText = plainText.replace(/```[\w-]*\n([\s\S]*?)```/g, (_match, code: string) => {
    const placeholder = `@@CODEBLOCK${codeBlocks.length}@@`;
    codeBlocks.push(code.replace(/\n$/, ""));
    return placeholder;
  });
  plainText = plainText.replace(/`([^`]+)`/g, "$1");
  plainText = plainText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1");
  plainText = plainText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  plainText = plainText.replace(/^>\s?/gm, "");
  plainText = plainText.replace(/^#{1,6}\s+/gm, "");
  plainText = plainText.replace(/^[-*+]\s+/gm, "");
  plainText = plainText.replace(/^\d+\.\s+/gm, "");
  plainText = plainText.replace(/(\*\*|__)(.*?)\1/g, "$2");
  plainText = plainText.replace(/(\*|_)(.*?)\1/g, "$2");
  plainText = plainText.replace(/~~(.*?)~~/g, "$1");
  plainText = plainText.replace(/<\/?[^>]+(>|$)/g, "");
  plainText = plainText.replace(/\n{3,}/g, "\n\n");
  plainText = plainText.replace(/@@CODEBLOCK(\d+)@@/g, (_match, index: string) => codeBlocks[Number(index)] ?? "");
  return plainText.trim();
};

const MessageCopyControl = ({
  content,
  messageType,
}: {
  content: string;
  messageType: "user" | "assistant";
}) => {
  const { copyData } = useCopyData();
  const canSelectCopyFormat = messageType === "assistant";
  const defaultFormat: CopyFormat = canSelectCopyFormat ? "markdown" : "text";
  const [selectedFormat, setSelectedFormat] = useState<CopyFormat>(defaultFormat);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSelectedFormat(defaultFormat);
  }, [defaultFormat]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copyFormatOptions = useMemo(
    () => [
      { format: "markdown" as const, label: "复制为 Markdown" },
      { format: "text" as const, label: "复制为纯文本" },
    ],
    []
  );

  const copyPayload = useMemo(() => {
    if (selectedFormat === "markdown") return content;
    return convertMarkdownToPlainText(content);
  }, [content, selectedFormat]);

  const toneColor = "myGray.500";
  const hoverColor = "primary.600";
  const formatTag = selectedFormat === "markdown" ? "MD" : "TXT";

  const handleCopy = async () => {
    if (!copyPayload.trim()) return;
    await copyData(copyPayload);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), COPY_SUCCESS_TIMEOUT_MS);
  };

  return (
    <Flex align="center" gap={0.5}>
      <MyTooltip label={copied ? "已复制" : "复制"}>
        <Flex
          align="center"
          borderRadius="6px"
          color={toneColor}
          cursor="pointer"
          gap={1}
          onClick={() => void handleCopy()}
          px={1}
          py={0.5}
          _hover={{ color: hoverColor, bg: "myGray.100" }}
        >
          {copied ? <Box as={CheckIcon} boxSize="14px" /> : <Box as={CopyIcon} boxSize="14px" />}
          <Text fontSize="10px" fontWeight="700" lineHeight="1" textTransform="uppercase">
            {formatTag}
          </Text>
        </Flex>
      </MyTooltip>

      {canSelectCopyFormat ? (
        <Menu isLazy>
          <MyTooltip label="选择复制格式">
            <MenuButton
              as={Flex}
              align="center"
              borderRadius="6px"
              color={toneColor}
              cursor="pointer"
              h="20px"
              justify="center"
              minW="20px"
              px={1}
              py={0.5}
              _hover={{ color: hoverColor, bg: "myGray.100" }}
            >
              <Icon as={ChevronDownIcon} boxSize="12px" color="currentColor" />
            </MenuButton>
          </MyTooltip>
          <MenuList minW="148px" p={1}>
            {copyFormatOptions.map((option) => {
              const isSelected = option.format === selectedFormat;
              return (
                <MenuItem
                  key={option.format}
                  borderRadius="8px"
                  icon={isSelected ? <Box as={CheckIcon} boxSize="12px" /> : undefined}
                  onClick={() => setSelectedFormat(option.format)}
                >
                  {option.label}
                </MenuItem>
              );
            })}
          </MenuList>
        </Menu>
      ) : null}
    </Flex>
  );
};

export default MessageCopyControl;
