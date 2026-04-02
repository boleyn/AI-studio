import { Box, Flex, Text } from "@chakra-ui/react";
import { AgentSkillsIcon } from "@components/common/Icon";
import type { RefObject } from "react";

import { PickerPanel } from "./SlashFilePicker";

type SkillOption = {
  name: string;
  description?: string;
};

type SkillMentionPickerProps = {
  options: SkillOption[];
  activeIndex: number;
  pickerRef: RefObject<HTMLDivElement>;
  onPick: (skillName: string) => void;
};

const SkillMentionPicker = ({ options, activeIndex, pickerRef, onPick }: SkillMentionPickerProps) => {
  return (
    <PickerPanel
      icon={<Box as={AgentSkillsIcon} color="myGray.500" h="14px" w="14px" />}
      pickerRef={pickerRef}
      title="选择技能"
      zIndex={30}
    >
      <Flex direction="column" gap={1} p={1.5}>
        {options.map((item, index) => {
          const isActive = index === activeIndex;
          return (
            <Flex
              key={item.name}
              data-skill-option-index={index}
              align="center"
              gap={2}
              border="1px solid"
              borderColor={isActive ? "primary.300" : "transparent"}
              bg={isActive ? "primary.1" : "transparent"}
              boxShadow={isActive ? "inset 0 0 0 1px var(--chakra-colors-primary-300)" : "none"}
              borderRadius="12px"
              cursor="pointer"
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(item.name);
              }}
              px={2}
              py={1.5}
              transition="all 0.18s ease"
              _hover={{
                bg: isActive ? "primary.1" : "myGray.50",
                borderColor: isActive ? "primary.300" : "myGray.250",
              }}
            >
              <Box as={AgentSkillsIcon} color={isActive ? "primary.600" : "myGray.500"} h="13px" w="13px" flexShrink={0} />
              <Box minW={0}>
                <Text color="myGray.600" fontSize="13px" fontWeight={600} noOfLines={1}>
                  {item.name}
                </Text>
                <Text color="myGray.500" fontSize="10px" mt="1px" noOfLines={1}>
                  {item.description || "无描述"}
                </Text>
              </Box>
            </Flex>
          );
        })}
      </Flex>
    </PickerPanel>
  );
};

export default SkillMentionPicker;
