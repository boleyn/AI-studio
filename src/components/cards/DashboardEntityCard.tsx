import { useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Box,
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Flex,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  Text,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Textarea,
  Tooltip,
  useDisclosure,
} from "@chakra-ui/react";

import UnifiedEntityCard from "./UnifiedEntityCard";
import { CloseIcon, CopyIcon, EditIcon } from "../common/Icon";
import { CalendarDays, History } from "lucide-react";

type DashboardEntityCardProps = {
  index: number;
  title: string;
  topBadges?: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  createdMeta?: React.ReactNode;
  fileCount?: number;
  onOpen: () => void;
  onDelete: () => Promise<void>;
  deleteDialogTitle: string;
  deleteDialogBody: string;
  onRename?: (nextName: string, nextDescription?: string) => Promise<void>;
  renameDialogTitle?: string;
  renameFieldLabel?: string;
  renamePlaceholder?: string;
  renameDescLabel?: string;
  renameDescPlaceholder?: string;
  renameNameRegex?: RegExp;
  renameNameErrorMsg?: string;
  initialDescription?: string;
  onDuplicate?: () => Promise<void>;
};

export default function DashboardEntityCard({
  index,
  title,
  topBadges,
  description,
  meta,
  createdMeta,
  fileCount,
  onOpen,
  onDelete,
  deleteDialogTitle,
  deleteDialogBody,
  onRename,
  renameDialogTitle,
  renameFieldLabel,
  renamePlaceholder,
  renameDescLabel,
  renameDescPlaceholder,
  renameNameRegex,
  renameNameErrorMsg,
  initialDescription,
  onDuplicate,
}: DashboardEntityCardProps) {
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const [renameValue, setRenameValue] = useState(title);
  const [renameDescValue, setRenameDescValue] = useState(initialDescription || (typeof description === "string" ? description : ""));
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const isRenameInvalid = renameNameRegex && renameValue.trim() !== "" ? !renameNameRegex.test(renameValue) : false;

  const {
    isOpen: isRenameOpen,
    onOpen: onRenameOpen,
    onClose: onRenameClose,
  } = useDisclosure();
  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
  } = useDisclosure();

  const handleRenameOpen = () => {
    setRenameValue(title);
    setRenameDescValue(initialDescription || (typeof description === "string" ? description : ""));
    onRenameOpen();
  };

  const handleRenameSubmit = async () => {
    if (!onRename) return;
    const name = renameValue.trim();
    const desc = renameDescValue.trim();
    const initialDescTrimmed = (initialDescription || (typeof description === "string" ? description : "")).trim();
    
    if ((!name || name === title) && desc === initialDescTrimmed) {
      onRenameClose();
      return;
    }
    setRenaming(true);
    try {
      await onRename(name, desc);
      onRenameClose();
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      await onDelete();
      onDeleteClose();
    } finally {
      setDeleting(false);
    }
  };

  const handleDuplicate = async () => {
    if (!onDuplicate) return;
    setDuplicating(true);
    try {
      await onDuplicate();
    } finally {
      setDuplicating(false);
    }
  };

  const actionBtnSx = {
    variant: "ghost" as const,
    boxSize: "36px",
    minW: "36px",
    borderRadius: "10px",
    border: "1px solid",
    borderColor: "myGray.250",
    bg: "rgba(255,255,255,0.92)",
    color: "myGray.500",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.92)",
    transition: "all 0.22s cubic-bezier(0.2, 0.65, 0.2, 1)",
    _hover: {
      transform: "translateY(-1px)",
      borderColor: "primary.300",
      bg: "rgba(242,251,244,0.92)",
      color: "primary.700",
      boxShadow: "0 8px 16px -12px rgba(50,165,73,0.45)",
    },
    _active: {
      transform: "translateY(0)",
      boxShadow: "inset 0 1px 2px rgba(17,24,36,0.12)",
    },
  };
  return (
    <>
      <UnifiedEntityCard
        index={index}
        title={title}
        titlePrefix={
          <Box
            w="10px"
            h="10px"
            borderRadius="full"
            bg="primary.400"
            boxShadow="0 0 0 5px rgba(100,218,122,0.16)"
            flexShrink={0}
          />
        }
        topBadges={topBadges}
        description={description}
        footerLeft={
          <HStack spacing={6} color="myGray.600" fontSize="sm" whiteSpace="nowrap" minW="fit-content">
            <HStack spacing={2}>
              <Box as={CalendarDays} w={4} h={4} />
              <Text>创建于 {createdMeta || "--"}</Text>
            </HStack>
            <HStack spacing={2}>
              <Box as={History} w={4} h={4} />
              <Text>{meta || "更新于 --"}</Text>
            </HStack>
          </HStack>
        }
        footerRight={
          <Flex align="center" h="100%">
            <Text color="primary.600" fontSize="sm" fontWeight="500" whiteSpace="nowrap">
              文件数 {typeof fileCount === "number" ? fileCount : "--"}
            </Text>
          </Flex>
        }
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("[data-card-actions]")) return;
          onOpen();
        }}
        actions={
          <>
            <Tooltip label="编辑">
              <IconButton
                aria-label="编辑"
                {...actionBtnSx}
                icon={<Box as={EditIcon} w={4} h={4} />}
                onClick={onRename ? handleRenameOpen : onOpen}
              />
            </Tooltip>
            {onDuplicate ? (
              <Tooltip label="复制">
                <IconButton
                  aria-label="复制"
                  {...actionBtnSx}
                  icon={<Box as={CopyIcon} w={4} h={4} />}
                  onClick={() => {
                    void handleDuplicate();
                  }}
                  isLoading={duplicating}
                />
              </Tooltip>
            ) : null}
            <Tooltip label="删除">
              <IconButton
                aria-label="删除"
                {...actionBtnSx}
                _hover={{
                  ...actionBtnSx._hover,
                  borderColor: "red.300",
                  bg: "rgba(254,243,242,0.92)",
                  color: "red.600",
                  boxShadow: "0 8px 16px -12px rgba(217,45,32,0.45)",
                }}
                icon={<Box as={CloseIcon} w={4} h={4} />}
                onClick={onDeleteOpen}
              />
            </Tooltip>
          </>
        }
      />

      {onRename ? (
        <Modal isOpen={isRenameOpen} onClose={onRenameClose} isCentered size="md">
          <ModalOverlay bg="blackAlpha.400" />
          <ModalContent
            borderRadius="xl"
            border="1px solid rgba(255,255,255,0.65)"
            bg="rgba(255,255,255,0.92)"
            backdropFilter="blur(18px)"
          >
            <ModalHeader color="myGray.800">{renameDialogTitle || "重命名"}</ModalHeader>
            <ModalBody>
              <FormControl mb={4} isInvalid={isRenameInvalid}>
                <FormLabel color="myGray.700">{renameFieldLabel || "名称"}</FormLabel>
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  placeholder={renamePlaceholder || "输入名称"}
                  autoFocus
                />
                <FormErrorMessage>{renameNameErrorMsg}</FormErrorMessage>
              </FormControl>
              <FormControl>
                <FormLabel color="myGray.700">{renameDescLabel || "描述（非必填）"}</FormLabel>
                <Textarea
                  value={renameDescValue}
                  onChange={(e) => setRenameDescValue(e.target.value)}
                  placeholder={renameDescPlaceholder || "输入描述"}
                  rows={3}
                  resize="vertical"
                />
              </FormControl>
            </ModalBody>
            <ModalFooter gap={2}>
              <Button variant="ghost" onClick={onRenameClose}>
                取消
              </Button>
              <Button
                variant="whitePrimary"
                onClick={() => {
                  void handleRenameSubmit();
                }}
                isLoading={renaming}
                isDisabled={
                  !renameValue.trim() ||
                  isRenameInvalid ||
                  (renameValue.trim() === title &&
                    renameDescValue.trim() === (initialDescription || (typeof description === "string" ? description : "")).trim())
                }
              >
                保存
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      ) : null}

      <AlertDialog
        isOpen={isDeleteOpen}
        onClose={onDeleteClose}
        leastDestructiveRef={cancelDeleteRef}
        isCentered
      >
        <AlertDialogOverlay bg="blackAlpha.400">
          <AlertDialogContent
            borderRadius="xl"
            border="1px solid rgba(255,255,255,0.65)"
            bg="rgba(255,255,255,0.95)"
            backdropFilter="blur(18px)"
          >
            <AlertDialogHeader color="myGray.800">{deleteDialogTitle}</AlertDialogHeader>
            <AlertDialogBody color="myGray.600">{deleteDialogBody}</AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelDeleteRef} variant="ghost" onClick={onDeleteClose}>
                取消
              </Button>
              <Button colorScheme="red" onClick={() => void handleDeleteConfirm()} isLoading={deleting}>
                删除
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
}
