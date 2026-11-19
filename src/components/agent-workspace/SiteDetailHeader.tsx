import type { ReactNode } from "react";
import { Box, Button, Flex, Heading, Link } from "@chakra-ui/react";
import { ChevronLeft, ExternalLink, Pencil } from "lucide-react";

type Props = {
  name: string;
  previewPath: string;
  editUrl?: string;
  onBack?: () => void;
  saving?: boolean;
};

export default function SiteDetailHeader({name, previewPath, editUrl, onBack, saving}: Props) {
  const backStyle = {variant:"ghost", size:"sm", mr:"auto", leftIcon:<ChevronLeft size={15}/>};
  return <>
    <Flex align="center" gap={2}>
      {onBack ? <Button {...backStyle} onClick={onBack} isDisabled={saving}>网站</Button>
        : <Button {...backStyle} as="a" href="/?view=library&librarySection=站点">网站</Button>}
      <Button as="a" size="sm" href={previewPath} target="_blank" rel="noopener noreferrer" leftIcon={<ExternalLink size={15}/>}>访问</Button>
      {editUrl && <Button as="a" size="sm" href={editUrl} leftIcon={<Pencil size={15}/>}>编辑</Button>}
    </Flex>
    <Box as="section" aria-label={name} mt={6} mb={4}>
      <Heading as="h1" fontSize="24px" lineHeight="32px" fontWeight={400} overflowWrap="anywhere">{name}</Heading>
      <Link href={previewPath} fontSize="sm" color="gray.600" overflowWrap="anywhere">{previewPath}</Link>
    </Box>
  </>;
}

export function SiteDetailNav({children}:{children:ReactNode}) {
  return <Flex as="nav" aria-label="站点详情" align="stretch" gap={3} overflowX="auto" borderBottomWidth="1px"
    sx={{
      "& > *": {display:"inline-flex", alignItems:"center", flexShrink:0, whiteSpace:"nowrap", minHeight:"36px", paddingInline:"4px",
        fontSize:"sm", fontWeight:"normal", color:"gray.600", borderRadius:0, borderBottom:"2px solid transparent"},
      '& > [aria-current="page"]': {fontWeight:"semibold", color:"gray.900", borderBottomColor:"currentColor"},
      "& > :focus-visible": {outlineOffset:"-2px"},
    }}>{children}</Flex>;
}
