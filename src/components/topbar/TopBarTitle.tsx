import { Flex, Text } from "@chakra-ui/react";

import { PencilIcon } from "../common/Icon";

const TopBarTitle = () => {
  return (
    <Flex align="center" gap={2} minW="220px">
      <Text fontSize="sm" fontWeight="600" color="gray.700">
        AsianInfo Digital AIGC Platform
      </Text>
      <Flex
        align="center"
        justify="center"
        w="22px"
        h="22px"
        borderRadius="full"
        border="1px solid"
        borderColor="gray.200"
        fontSize="xs"
        color="gray.500"
      >
        <PencilIcon />
      </Flex>
    </Flex>
  );
};

export default TopBarTitle;
