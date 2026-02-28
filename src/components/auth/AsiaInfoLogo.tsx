import { Box, Flex, Text } from "@chakra-ui/react";
import Avatar from "./Avatar";

type AsiaInfoLogoProps = {
  showText?: boolean;
  textColor?: string;
  subTextColor?: string;
  spacing?: number | string;
  titleText?: string;
  subtitleText?: string;
  w?: string | number;
  width?: string | number;
  height?: string | number;
};

const AsiaInfoLogo = ({
  showText = true,
  textColor = "myGray.800",
  subTextColor = "myGray.500",
  spacing = 3,
  titleText = "AI Studio",
  subtitleText = "MODEL LAB",
  w,
  width,
}: AsiaInfoLogoProps) => {
  const logoSize = w ?? width ?? "48px";
  return (
    <Flex align="center" gap={spacing} lineHeight="short" whiteSpace="nowrap">
      <Avatar src="/icon/logo.svg" w={logoSize} />
      {showText && (
        <Box>
          <Text fontSize="lg" fontWeight="extrabold" color={textColor}>
            {titleText}
          </Text>
          {subtitleText && (
            <Text fontSize="xs" letterSpacing="0.28em" color={subTextColor}>
              {subtitleText}
            </Text>
          )}
        </Box>
      )}
    </Flex>
  );
};

export default AsiaInfoLogo;
