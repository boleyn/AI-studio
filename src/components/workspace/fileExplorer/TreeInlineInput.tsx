import { Input } from "@chakra-ui/react";
import type { RefObject } from "react";

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
          void onConfirm();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        void onConfirm();
      }}
    />
  );
};

export default TreeInlineInput;
