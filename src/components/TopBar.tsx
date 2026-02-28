import { useState, useEffect, useRef } from "react";
import { Flex, IconButton, Input, useToast } from "@chakra-ui/react";
import { useRouter } from "next/router";

import TopBarActions from "./topbar/TopBarActions";
import MyTooltip from "./ui/MyTooltip";
import type { SaveStatus } from "./CodeChangeListener";
import { BackIcon, CheckIcon, CloseIcon, EditIcon } from "./common/Icon";

type TopBarProps = {
  projectName?: string;
  saveStatus?: SaveStatus;
  onSave?: () => void;
  onDownload?: () => void;
  onCopy?: () => void;
  onShare?: () => void;
  onRefresh?: () => void;
  onOpenInNew?: () => void;
  onProjectNameChange?: (name: string) => void;
};

const TopBar = ({
  projectName = "未命名项目",
  saveStatus,
  onSave,
  onDownload,
  onCopy,
  onShare,
  onRefresh,
  onOpenInNew,
  onProjectNameChange,
}: TopBarProps) => {
  const router = useRouter();
  const toast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(projectName);
  const isSubmittingNameRef = useRef(false);

  // 当projectName更新时，同步更新editValue（如果不在编辑状态）
  useEffect(() => {
    if (!isEditing) {
      setEditValue(projectName);
    }
  }, [projectName, isEditing]);

  const handleBack = () => {
    router.push("/");
  };

  const handleEditStart = () => {
    setEditValue(projectName);
    setIsEditing(true);
  };

  const handleEditCancel = () => {
    setEditValue(projectName);
    setIsEditing(false);
  };

  const handleEditSubmit = async (): Promise<boolean> => {
    if (isSubmittingNameRef.current) {
      return true;
    }
    isSubmittingNameRef.current = true;
    const trimmedValue = editValue.trim();
    if (!trimmedValue) {
      toast({
        title: "项目名称不能为空",
        status: "error",
        duration: 2000,
        isClosable: true,
      });
      isSubmittingNameRef.current = false;
      return false;
    }

    if (trimmedValue !== projectName) {
      try {
        // 调用回调更新项目名称
        await onProjectNameChange?.(trimmedValue);
        // 成功后关闭编辑模式，projectName会通过props更新，useEffect会同步editValue
        setIsEditing(false);
        isSubmittingNameRef.current = false;
        return true;
      } catch (error) {
        toast({
          title: "保存失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
        // 保存失败时保持编辑状态
        isSubmittingNameRef.current = false;
        return false;
      }
    } else {
      // 没有变化，直接关闭编辑模式
      setIsEditing(false);
      isSubmittingNameRef.current = false;
      return true;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleEditSubmit();
    } else if (e.key === "Escape") {
      handleEditCancel();
    }
  };

  return (
    <Flex
      as="header"
      align="center"
      justify="space-between"
      gap={4}
      wrap="wrap"
      border="1px solid rgba(255,255,255,0.7)"
      bg="rgba(255,255,255,0.75)"
      backdropFilter="blur(18px)"
      borderRadius="2xl"
      px={4}
      py={3}
      boxShadow="0 18px 40px -24px rgba(15, 23, 42, 0.25)"
    >
      <Flex align="center" gap={3} flex="1" minW="0">
        <MyTooltip label="返回列表">
          <IconButton
            aria-label="返回列表"
            size="sm"
            variant="ghost"
            icon={<BackIcon />}
            onClick={handleBack}
          />
        </MyTooltip>
        
        {isEditing ? (
          <Flex align="center" gap={2} flex="1" minW="0">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleEditSubmit}
              autoFocus
              px={3}
              py={1}
              fontSize="md"
              fontWeight="600"
              borderRadius="md"
              flex="1"
              minW="0"
              bg="white"
              border="1px solid"
              borderColor="gray.300"
              _focus={{
                borderColor: "blue.500",
                boxShadow: "0 0 0 1px var(--chakra-colors-blue-500)",
              }}
            />
            <IconButton
              aria-label="确认"
              icon={<CheckIcon />}
              onClick={handleEditSubmit}
              size="xs"
              variant="ghost"
            />
            <IconButton
              aria-label="取消"
              icon={<CloseIcon />}
              onClick={handleEditCancel}
              size="xs"
              variant="ghost"
            />
          </Flex>
        ) : (
          <Flex align="center" gap={2} flex="1" minW="0">
            <Flex
              px={3}
              py={1}
              borderRadius="md"
              fontSize="md"
              fontWeight="600"
              _hover={{ bg: "gray.50" }}
              cursor="pointer"
              onClick={handleEditStart}
              flex="1"
              minW="0"
              align="center"
            >
              {projectName}
            </Flex>
            <IconButton
              aria-label="编辑项目名称"
              icon={<EditIcon />}
              onClick={handleEditStart}
              size="xs"
              variant="ghost"
            />
          </Flex>
        )}
      </Flex>
      
      <TopBarActions
        saveStatus={saveStatus}
        onSave={async () => {
          if (isEditing) {
            const ok = await handleEditSubmit();
            if (!ok) {
              return;
            }
          }
          onSave?.();
        }}
        onDownload={onDownload}
        onCopy={onCopy}
        onShare={onShare}
        onRefresh={onRefresh}
        onOpenInNew={onOpenInNew}
      />
    </Flex>
  );
};

export default TopBar;
