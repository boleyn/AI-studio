import { FormControl, FormErrorMessage, Input, InputGroup, InputLeftElement, type InputProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

type AuthInputFieldProps = InputProps & {
  icon?: ReactNode;
  error?: string | null;
  isInvalid?: boolean;
};

const AuthInputField = ({ icon, error, isInvalid, ...props }: AuthInputFieldProps) => {
  return (
    <FormControl isInvalid={isInvalid}>
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
          {...props}
          pl={icon ? "42px" : undefined}
          color="myGray.600"
          fontWeight="500"
          bg="rgba(255,255,255,0.9)"
          borderColor="myGray.250"
          _hover={{ borderColor: "myGray.300" }}
          _focus={{ borderColor: "primary.300", boxShadow: "0 0 0 2px rgba(51,112,255,0.12)" }}
          _focusVisible={{ borderColor: "primary.300", boxShadow: "0 0 0 2px rgba(51,112,255,0.12)" }}
          sx={{
            ":-webkit-autofill, :-webkit-autofill:hover, :-webkit-autofill:focus": {
              WebkitTextFillColor: "#485264",
              WebkitBoxShadow: "0 0 0px 1000px rgba(255,255,255,0.9) inset",
              transition: "background-color 9999s ease-out 0s",
            },
          }}
        />
      </InputGroup>
      {error ? <FormErrorMessage mt={2}>{error}</FormErrorMessage> : null}
    </FormControl>
  );
};

export default AuthInputField;
