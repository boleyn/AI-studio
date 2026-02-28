import { Button, Flex, Text } from "@chakra-ui/react";
import { BackIcon } from "@components/common/Icon";

type SkillsPageHeaderProps = {
  onBack: () => void;
};

const iconStyle = { width: 14, height: 14 };

const SkillsPageHeader = ({ onBack }: SkillsPageHeaderProps) => {
  return (
    <Flex
      as="header"
      align="center"
      justify="flex-start"
      gap={3}
      wrap="wrap"
      border="1px solid rgba(255,255,255,0.7)"
      bg="rgba(255,255,255,0.75)"
      backdropFilter="blur(18px)"
      borderRadius="2xl"
      px={4}
      py={3}
      boxShadow="0 18px 40px -24px rgba(15, 23, 42, 0.25)"
    >
      <Button
        size="sm"
        variant="ghost"
        leftIcon={<BackIcon style={iconStyle} />}
        onClick={onBack}
        color="myGray.700"
      >
        返回
      </Button>

      <Text
        color="myGray.800"
        fontSize="md"
        fontWeight="600"
        letterSpacing="-0.01em"
        lineHeight="1.2"
      >
        技能工作台
      </Text>
    </Flex>
  );
};

export default SkillsPageHeader;
