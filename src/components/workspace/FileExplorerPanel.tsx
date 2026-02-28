import { Flex, IconButton, Text } from "@chakra-ui/react";
import { SandpackFileExplorer } from "@codesandbox/sandpack-react";

import { AddIcon, SearchIcon } from "../common/Icon";

const FileExplorerPanel = () => {
  return (
    <Flex
      direction="column"
      minW="220px"
      maxW="260px"
      borderRight="1px solid"
      borderColor="gray.200"
      minH="0"
    >
      <Flex align="center" justify="space-between" px={3} py={2} bg="white" borderBottom="1px solid" borderColor="gray.200">
        <Text fontSize="xs" fontWeight="600" color="gray.600" textTransform="uppercase" letterSpacing="0.08em">
          文件
        </Text>
        <Flex gap={1}>
          <IconButton
            aria-label="搜索文件"
            size="xs"
            variant="ghost"
            icon={<SearchIcon />}
          />
          <IconButton
            aria-label="新建文件"
            size="xs"
            variant="ghost"
            icon={<AddIcon />}
          />
        </Flex>
      </Flex>
      <SandpackFileExplorer
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          height: "auto",
          overflow: "auto",
        }}
      />
    </Flex>
  );
};

export default FileExplorerPanel;
