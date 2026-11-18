import { FormLabel, FormControl, FormErrorMessage, Input, InputGroup, InputLeftElement, type InputProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

type AuthInputFieldProps = InputProps & {
  label: string;
  icon?: ReactNode;
  error?: string | null;
  isInvalid?: boolean;
};

const AuthInputField = ({ label, icon, error, isInvalid, ...props }: AuthInputFieldProps) => {
  return (
    <FormControl id={props.name} isInvalid={isInvalid}>
      <FormLabel fontSize="sm" mb={2}>{label}</FormLabel>
      <InputGroup size="lg">
        {icon ? (
          <InputLeftElement
            pointerEvents="none"
            color="myGray.400"
            h="100%"
            pl={1}
          >
            {icon}
          </InputLeftElement>
        ) : null}
        <Input
          required
          {...props}
          pl={icon ? "42px" : undefined}
          fontSize="md"
          borderRadius="12px"
          bg="#fafafa"
          borderColor="#c6c8cb"
          _focusVisible={{ borderColor: "var(--ws-accent)", boxShadow: "0 0 0 1px var(--ws-accent)" }}
        />
      </InputGroup>
      {error ? <FormErrorMessage mt={2}>{error}</FormErrorMessage> : null}
    </FormControl>
  );
};

export default AuthInputField;
