import { useEffect, useId, useRef, useState } from "react";
import { Button, FormControl, FormLabel, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import { AppDialog } from "../ui";

type ProjectSettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  project: {
    token: string;
    name: string;
    description?: string;
  } | null;
  onSave: (token: string, updates: { name: string; description: string }) => Promise<void>;
};

export default function ProjectSettingsModal({
  isOpen,
  onClose,
  project,
  onSave,
}: ProjectSettingsModalProps) {
  const nameInputId = useId();
  const descInputId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && project) {
      setName(project.name || "");
      setDescription(project.description || "");
    }
  }, [isOpen, project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    try {
      await onSave(project.token, {
        name: trimmedName,
        description: description.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        e.preventDefault();
      }
    }
  };

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      title="项目设置"
      subtitle="配置项目名称与上下文说明"
      initialFocusRef={nameRef}
      size="md"
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={saving}
            isDisabled={!name.trim()}
          >
            保存设置
          </Button>
        </>
      }
    >
      <VStack align="stretch" spacing={4}>
        <FormControl isRequired>
          <FormLabel htmlFor={nameInputId} fontSize="13px" fontWeight="500" color="ink.primary">
            项目名称
          </FormLabel>
          <Input
            id={nameInputId}
            ref={nameRef}
            size="md"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            placeholder="输入项目名称"
          />
        </FormControl>

        <FormControl>
          <FormLabel htmlFor={descInputId} fontSize="13px" fontWeight="500" color="ink.primary" mb={1}>
            项目说明 / 上下文备注
          </FormLabel>
          <Text fontSize="12px" color="ink.muted" mb={1.5}>
            用于记录项目目标、技术栈或工作约定。
          </Text>
          <Textarea
            id={descInputId}
            size="sm"
            rows={4}
            resize="vertical"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例如：这是一个基于 Next.js 的数据分析工作区，所有输出报告优先保存为 Markdown 或 Excel。"
          />
        </FormControl>
      </VStack>
    </AppDialog>
  );
}
