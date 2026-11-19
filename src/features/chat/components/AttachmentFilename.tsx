import { Box, Flex } from "@chakra-ui/react";

export default function AttachmentFilename({name}: {name: string}) {
  const suffix = /\.[a-z0-9]{1,12}$/i.exec(name);
  const split = suffix && suffix.index > 0 ? suffix.index : name.length;
  return <Flex as="span" minW={0} align="baseline" fontSize="xs" title={name}>
    <Box as="span" minW={0} isTruncated>{name.slice(0, split)}</Box>
    <Box as="span" flexShrink={0}>{name.slice(split)}</Box>
  </Flex>;
}
