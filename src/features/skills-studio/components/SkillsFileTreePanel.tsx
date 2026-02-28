import { Box, Button, Flex, Input, InputGroup, InputLeftElement, Text } from "@chakra-ui/react";
import { SearchIcon } from "@components/common/Icon";
import type { FileTreeNode } from "./fileTree";

type SkillsFileTreePanelProps = {
  fileQuery: string;
  onChangeQuery: (value: string) => void;
  fileTree: FileTreeNode[];
  expandedDirs: Set<string>;
  onToggleDir: (dirPath: string) => void;
  activeFile: string;
  onSelectFile: (filePath: string) => void;
};

const SkillsFileTreePanel = ({
  fileQuery,
  onChangeQuery,
  fileTree,
  expandedDirs,
  onToggleDir,
  activeFile,
  onSelectFile,
}: SkillsFileTreePanelProps) => {
  const renderNode = (treeNode: FileTreeNode, depth: number) => {
    if (treeNode.type === "dir") {
      const isOpen = expandedDirs.has(treeNode.path);
      return (
        <Box key={treeNode.path}>
          <Button
            justifyContent="flex-start"
            onClick={() => onToggleDir(treeNode.path)}
            size="sm"
            variant="ghost"
            w="full"
            h="28px"
            pl={`${8 + depth * 14}px`}
            color="myGray.700"
            _hover={{ bg: "myGray.100" }}
          >
            <Text as="span" fontFamily="mono" fontSize="12px" mr={2} color="myGray.500">
              {isOpen ? "▾" : "▸"}
            </Text>
            <Text as="span" isTruncated>
              {treeNode.name}
            </Text>
          </Button>
          {isOpen ? (treeNode.children || []).map((child) => renderNode(child, depth + 1)) : null}
        </Box>
      );
    }

    const isActive = activeFile === treeNode.path;
    return (
      <Button
        key={treeNode.path}
        justifyContent="flex-start"
        onClick={() => onSelectFile(treeNode.path)}
        size="sm"
        variant="ghost"
        w="full"
        h="28px"
        pl={`${24 + depth * 14}px`}
        bg={isActive ? "blue.50" : "transparent"}
        color={isActive ? "blue.700" : "myGray.700"}
        border="1px solid"
        borderColor={isActive ? "blue.200" : "transparent"}
        _hover={{ bg: "myGray.100" }}
      >
        <Text as="span" fontFamily="mono" fontSize="12px" mr={2} color="myGray.500">
          ·
        </Text>
        <Text as="span" isTruncated>
          {treeNode.name}
        </Text>
      </Button>
    );
  };

  return (
    <Flex direction="column" h="100%" minH={0} p={2} borderRight="1px solid" borderColor="rgba(226,232,240,0.9)">
      <Text color="myGray.500" fontSize="xs" mb={2} fontWeight="600">
        文件浏览器
      </Text>
      <InputGroup size="sm" mb={2}>
        <InputLeftElement pointerEvents="none">
          <SearchIcon style={{ width: 12, height: 12, opacity: 0.7 }} />
        </InputLeftElement>
        <Input
          placeholder="搜索文件"
          value={fileQuery}
          onChange={(event) => onChangeQuery(event.target.value)}
          bg="white"
          borderColor="rgba(226,232,240,0.9)"
          color="myGray.700"
          _placeholder={{ color: "myGray.400" }}
          _hover={{ borderColor: "rgba(203,213,225,0.95)" }}
          _focusVisible={{ borderColor: "blue.300" }}
        />
      </InputGroup>

      <Box flex="1" minH={0} overflowY="auto">
        <Flex direction="column" gap={0.5}>
          {fileTree.length === 0 ? (
            <Text color="myGray.500" fontSize="sm" px={2} py={1}>
              无匹配文件
            </Text>
          ) : (
            fileTree.map((node) => renderNode(node, 0))
          )}
        </Flex>
      </Box>
    </Flex>
  );
};

export default SkillsFileTreePanel;
