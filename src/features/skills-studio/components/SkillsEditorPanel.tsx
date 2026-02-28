import { Button, Flex, Text, Textarea } from "@chakra-ui/react";
import Markdown from "@/components/Markdown";

type SkillsEditorPanelProps = {
  activeView: "preview" | "code";
  activeFile: string;
  isMarkdownFile: boolean;
  selectedCode: string;
  draftCode: string;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string;
  onChangeDraft: (value: string) => void;
  onSave: () => void;
};

const SkillsEditorPanel = ({
  activeView,
  activeFile,
  isMarkdownFile,
  selectedCode,
  draftCode,
  isDirty,
  isSaving,
  saveError,
  onChangeDraft,
  onSave,
}: SkillsEditorPanelProps) => {
  const content = isDirty ? draftCode : selectedCode;
  const fileStatus = (() => {
    if (saveError) return `文件：${saveError}`;
    if (!activeFile) return "文件：未选择";
    if (isSaving) return "文件：保存中";
    if (isDirty) return "文件：未保存";
    return "文件：已保存";
  })();
  const fileStatusColor = saveError
    ? "red.500"
    : isDirty
    ? "orange.500"
    : isSaving
    ? "blue.500"
    : "green.600";

  if (activeView === "preview") {
    return (
      <Flex direction="column" minH="100%" h="100%">
        <Text color="myGray.700" fontSize="xs" fontWeight="700" mb={2}>
          {activeFile || "请选择文件"}
        </Text>
        {!content ? (
          <Text color="myGray.500" fontSize="sm">
            （空内容）
          </Text>
        ) : isMarkdownFile ? (
          <Markdown source={content} />
        ) : (
          <Text fontFamily="mono" fontSize="12px" color="myGray.700" whiteSpace="pre-wrap">
            {content}
          </Text>
        )}
      </Flex>
    );
  }

  return (
    <Flex direction="column" minH="100%" h="100%">
      <Flex align="center" justify="space-between" mb={2}>
        <Flex align="center" gap={2} minW={0}>
          <Text color="myGray.700" fontSize="xs" fontWeight="700" isTruncated>
            {activeFile || "请选择文件"}
          </Text>
          <Text color={fileStatusColor} fontSize="xs" fontWeight="600" flexShrink={0}>
            {fileStatus}
          </Text>
        </Flex>
        <Flex align="center" gap={2}>
          <Button
            size="xs"
            colorScheme="blue"
            onClick={onSave}
            isDisabled={!activeFile || !isDirty}
            isLoading={isSaving}
          >
            保存
          </Button>
        </Flex>
      </Flex>
      <Textarea
        fontFamily="mono"
        fontSize="12px"
        flex="1"
        minH={0}
        value={draftCode}
        onChange={(event) => onChangeDraft(event.target.value)}
        placeholder={activeFile ? "编辑文件内容..." : "请选择文件"}
        isDisabled={!activeFile}
        resize="vertical"
        bg="transparent"
        color="myGray.700"
        border="0"
        borderRadius={0}
        _placeholder={{ color: "myGray.400" }}
        _hover={{ border: 0 }}
        _focusVisible={{ border: 0, boxShadow: "none" }}
      />
    </Flex>
  );
};

export default SkillsEditorPanel;
