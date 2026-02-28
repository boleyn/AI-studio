import React from "react";
import { Input, Textarea } from "@chakra-ui/react";

const InputRender = ({ inputType, value, onChange, isDisabled, ...props }: any) => {
  if (inputType === "textarea") {
    return (
      <Textarea
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        isDisabled={isDisabled}
        {...props}
      />
    );
  }

  return (
    <Input
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      isDisabled={isDisabled}
      {...props}
    />
  );
};

export default InputRender;
