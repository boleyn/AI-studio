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
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Textarea,
  Tooltip,
  useDisclosure,
} from "@chakra-ui/react";

import UnifiedEntityCard from "./UnifiedEntityCard";
import { CloseIcon, CopyIcon, EditIcon } from "../common/Icon";

type DashboardEntityCardProps = {
  index: number;
  title: string;
  topBadges?: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
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

  return (
    <>
      <UnifiedEntityCard
        index={index}
        title={title}
        topBadges={topBadges}
        description={description}
        meta={meta}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("[data-card-actions]")) return;
          onOpen();
        }}
        actions={
          <>
            <Tooltip label="编辑">
              <IconButton
                aria-label="编辑"
                variant="ghost"
                size="sm"
                borderRadius="md"
                color="myGray.500"
                _hover={{ bg: "myGray.100", color: "primary.600" }}
                icon={<Box as={EditIcon} w={4} h={4} />}
                onClick={onRename ? handleRenameOpen : onOpen}
              />
            </Tooltip>
            {onDuplicate ? (
              <Tooltip label="复制">
                <IconButton
                  aria-label="复制"
                  variant="ghost"
                  size="sm"
                  borderRadius="md"
                  color="myGray.500"
                  _hover={{ bg: "myGray.100", color: "primary.600" }}
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
                variant="ghost"
                size="sm"
                borderRadius="md"
                color="myGray.500"
                _hover={{ bg: "red.50", color: "red.500" }}
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
