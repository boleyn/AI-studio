import { Box, Flex } from "@chakra-ui/react";

export default function AttachmentFilename({name, fontSize = "xs"}: {name: string; fontSize?: "xs" | "sm" | "inherit"}) {
  const suffix = /\.[a-z0-9]{1,12}$/i.exec(name);
  const split = suffix && suffix.index > 0 ? suffix.index : name.length;
  return <Flex as="span" minW={0} align="baseline" fontSize={fontSize} title={name}>
    <Box as="span" minW={0} isTruncated>{name.slice(0, split)}</Box>
    <Box as="span" flexShrink={0}>{name.slice(split)}</Box>
  </Flex>;
}
