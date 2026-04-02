import { Input } from "@chakra-ui/react";
import { useRef, type RefObject } from "react";

type TreeInlineInputProps = {
  inputRef: RefObject<HTMLInputElement>;
  value: string;
  borderRadius: string;
  borderColor: string;
  onValueChange: (value: string) => void;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

const TreeInlineInput = ({
  inputRef,
  value,
  borderRadius,
  borderColor,
  onValueChange,
  onConfirm,
  onCancel,
}: TreeInlineInputProps) => {
  const skipNextBlurConfirmRef = useRef(false);

  return (
    <Input
      ref={inputRef}
      size="sm"
      variant="unstyled"
      value={value}
      px={2}
      py={1}
      borderRadius={borderRadius}
      border="1px solid"
      borderColor={borderColor}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          skipNextBlurConfirmRef.current = true;
          void onConfirm();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          skipNextBlurConfirmRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (skipNextBlurConfirmRef.current) {
          skipNextBlurConfirmRef.current = false;
          return;
        }
        void onConfirm();
      }}
    />
  );
};

export default TreeInlineInput;
