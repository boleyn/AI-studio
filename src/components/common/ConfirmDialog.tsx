import { useRef } from "react";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
} from "@chakra-ui/react";

type ConfirmDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  colorScheme?: "red" | "blue" | "green" | "orange" | "gray";
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
};

const ConfirmDialog = ({
  isOpen,
  onClose,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  colorScheme = "red",
  onConfirm,
  isLoading = false,
}: ConfirmDialogProps) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog isOpen={isOpen} onClose={onClose} leastDestructiveRef={cancelRef} isCentered>
      <AlertDialogOverlay bg="blackAlpha.400">
        <AlertDialogContent
          borderRadius="xl"
          border="1px solid rgba(255,255,255,0.65)"
          bg="rgba(255,255,255,0.96)"
          backdropFilter="blur(18px)"
        >
          <AlertDialogHeader color="myGray.800">{title}</AlertDialogHeader>
          {description ? <AlertDialogBody color="myGray.600">{description}</AlertDialogBody> : null}
          <AlertDialogFooter gap={2}>
            <Button ref={cancelRef} variant="ghost" onClick={onClose}>
              {cancelText}
            </Button>
            <Button colorScheme={colorScheme} onClick={() => void onConfirm()} isLoading={isLoading}>
              {confirmText}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
};

export default ConfirmDialog;
