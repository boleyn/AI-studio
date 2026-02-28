import { Button, Flex, Input } from "@chakra-ui/react";

type TopBarTokenInputProps = {
  token: string;
  loading: boolean;
  onTokenChange: (value: string) => void;
  onLoad: () => void;
};

const TopBarTokenInput = ({ token, loading, onTokenChange, onLoad }: TopBarTokenInputProps) => {
  return (
    <Flex
      align="center"
      gap={2}
      border="1px solid"
      borderColor="gray.200"
      borderRadius="full"
      px={3}
      py={1}
      bg="white"
      minW={{ base: "100%", md: "360px" }}
    >
      <Input
        size="sm"
        variant="unstyled"
        placeholder="输入编码 / code token"
        value={token}
        onChange={(event) => onTokenChange(event.target.value)}
      />
      <Button size="sm" colorScheme="blue" borderRadius="full" onClick={onLoad} isLoading={loading}>
        加载
      </Button>
    </Flex>
  );
};

export default TopBarTokenInput;
