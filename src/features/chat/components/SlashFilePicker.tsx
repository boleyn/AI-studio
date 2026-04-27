import { Box, Flex, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { getFileIcon } from "@fastgpt/global/common/file/icon";
import type { ReactNode, RefObject } from "react";

const slashPickerEnter = keyframes`
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.995);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

type SlashFilePickerProps = {
  options: string[];
  activeIndex: number;
  pickerRef: RefObject<HTMLDivElement>;
  onPick: (filePath: string) => void;
};

type PickerPanelProps = {
  title: string;
  icon: ReactNode;
  pickerRef: RefObject<HTMLDivElement>;
  children: ReactNode;
  zIndex?: number;
};

export const PickerPanel = ({ title, icon, pickerRef, children, zIndex = 31 }: PickerPanelProps) => (
  <Box
    bg="var(--ws-surface)"
    border="1px solid"
    borderColor="var(--ws-border)"
    borderRadius="16px"
    boxShadow="0 10px 28px rgba(15, 23, 42, 0.12)"
    left={0}
    maxH="260px"
    overflow="hidden"
    position="absolute"
    right={0}
    bottom="calc(100% + 6px)"
    zIndex={zIndex}
    animation={`${slashPickerEnter} 0.2s ease-out`}
    backdropFilter="blur(6px)"
  >
    <Flex
      align="center"
      borderBottom="1px solid"
      borderColor="var(--ws-border)"
      gap={2}
      bg="var(--ws-surface)"
      position="sticky"
      top={0}
      zIndex={1}
      px={3}
      py={2}
    >
      {icon}
      <Text color="myGray.500" fontSize="11px" fontWeight={600} letterSpacing="0.01em">
        {title}
      </Text>
    </Flex>
    <Box ref={pickerRef} maxH="214px" overflowY="auto">
      {children}
    </Box>
  </Box>
);

const SlashFilePicker = ({ options, activeIndex, pickerRef, onPick }: SlashFilePickerProps) => {
  return (
    <PickerPanel
      icon={<Box as="img" h="14px" opacity={0.75} src="/icons/chat/fileSelect.svg" w="14px" />}
      pickerRef={pickerRef}
      title="选择文件"
      zIndex={31}
    >
      <Flex direction="column" gap={1} p={1.5}>
        {options.map((item, index) => {
          const isActive = index === activeIndex;
          const parts = item.split("/").filter(Boolean);
          const fileName = parts[parts.length - 1] || item;
          const parentPath = parts.slice(0, -1).join("/");
          const fileIcon = getFileIcon(fileName || item, "file/fill/file");
          return (
            <Flex
              align="center"
              border="1px solid"
              borderColor={isActive ? "primary.300" : "transparent"}
              key={item}
              data-file-option-index={index}
              bg={isActive ? "primary.1" : "transparent"}
              boxShadow={isActive ? "inset 0 0 0 1px var(--chakra-colors-primary-300)" : "none"}
              borderRadius="12px"
              cursor="pointer"
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(item);
              }}
              px={2}
              py={1.5}
              transition="all 0.18s ease"
              _hover={{
                bg: isActive ? "primary.1" : "myGray.50",
                borderColor: isActive ? "primary.300" : "myGray.250",
              }}
            >
              <Box as="img" h="16px" mr={2.5} src={`/icons/chat/${fileIcon}.svg`} w="16px" />
              <Box minW={0}>
                <Text color="myGray.600" fontSize="13px" fontWeight={600} noOfLines={1}>
                  {fileName}
                </Text>
                {parentPath ? (
                  <Text color="myGray.500" fontSize="10px" mt="1px" noOfLines={1}>
                    /{parentPath}
                  </Text>
                ) : (
                  <Text color="myGray.500" fontSize="10px" mt="1px" noOfLines={1}>
                    根目录
                  </Text>
                )}
              </Box>
              {isActive ? <Box bg="primary.300" borderRadius="999px" h="6px" ml="auto" w="6px" /> : null}
            </Flex>
          );
        })}
      </Flex>
    </PickerPanel>
  );
};

export default SlashFilePicker;
