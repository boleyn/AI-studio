import { Box, Image } from "@chakra-ui/react";
import { getFileIcon } from "@fastgpt/global/common/file/icon";

export const FileGlyph = ({ name }: { name?: string }) => {
  const icon = getFileIcon(name || "", "file/fill/file");
  return <Image src={`/icons/chat/${icon}.svg`} w="14px" h="14px" objectFit="contain" alt="" flexShrink={0} />;
};

export const FolderGlyph = () => (
  <Box as="svg" viewBox="0 0 16 12" w="16px" h="12px" flexShrink={0}>
    <path
      d="M1.5 3.25h13v6.75a.9.9 0 0 1-.9.9H2.4a.9.9 0 0 1-.9-.9V3.25z"
      fill="none"
      stroke="#97A2B2"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path
      d="M1.5 3.25V2.2a.9.9 0 0 1 .9-.9h3.3l1 1.1H13.6a.9.9 0 0 1 .9.9v.95"
      fill="none"
      stroke="#97A2B2"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </Box>
);
