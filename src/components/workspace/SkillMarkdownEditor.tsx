import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Tag,
  Text,
  Textarea,
} from "@chakra-ui/react";
import yaml from "js-yaml";
import { useEffect, useMemo, useState } from "react";

type SkillMarkdownEditorProps = {
  activeFile: string;
  code: string;
  onChangeCode: (nextCode: string) => void;
};

type SkillFrontmatter = {
  name: string;
  description: string;
  license: string;
};

const deriveSkillNameFromPath = (filePath: string) => {
  const segments = filePath.split("/").filter(Boolean);
  if (segments.length < 2) return "my-skill";
  return segments[segments.length - 2] || "my-skill";
};

const DEFAULT_FRONTMATTER: SkillFrontmatter = {
  name: "frontend-design",
  description:
    "Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.",
  license: "Complete terms in LICENSE.txt",
};

const parseSkillMarkdown = (code: string, fallbackName: string) => {
  const match = code.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const defaultFrontmatter: SkillFrontmatter = { ...DEFAULT_FRONTMATTER };

  if (!match) {
    return {
      frontmatter: defaultFrontmatter,
      body: code,
      parseError: "缺少 YAML frontmatter，已按表单模式生成默认头部。",
    };
  }

  try {
    const parsed = yaml.load(match[1]);
    const frontmatter = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    return {
      frontmatter: {
        name:
          typeof frontmatter.name === "string" && frontmatter.name.trim()
            ? frontmatter.name
            : fallbackName || defaultFrontmatter.name,
        description:
          typeof frontmatter.description === "string"
            ? frontmatter.description
            : defaultFrontmatter.description,
        license: typeof frontmatter.license === "string" ? frontmatter.license : defaultFrontmatter.license,
      },
      body: code.slice(match[0].length),
      parseError: "",
    };
  } catch (error) {
    return {
      frontmatter: defaultFrontmatter,
      body: code.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, ""),
      parseError: error instanceof Error ? `frontmatter 解析失败: ${error.message}` : "frontmatter 解析失败",
    };
  }
};

const composeSkillMarkdown = (frontmatter: SkillFrontmatter, body: string) => {
  const yamlText = yaml
    .dump(
      {
        name: frontmatter.name.trim(),
        description: frontmatter.description.trim(),
        license: frontmatter.license.trim(),
      },
      { lineWidth: 1000, noRefs: true }
    )
    .trimEnd();

  const normalizedBody = body.replace(/^\n+/, "");
  return `---\n${yamlText}\n---\n\n${normalizedBody}`;
};

const SkillMarkdownEditor = ({ activeFile, code, onChangeCode }: SkillMarkdownEditorProps) => {
  const fallbackName = useMemo(() => deriveSkillNameFromPath(activeFile), [activeFile]);
  const parsed = useMemo(() => parseSkillMarkdown(code, fallbackName), [code, fallbackName]);

  const [frontmatter, setFrontmatter] = useState<SkillFrontmatter>(parsed.frontmatter);
  const [body, setBody] = useState(parsed.body);

  useEffect(() => {
    setFrontmatter(parsed.frontmatter);
    setBody(parsed.body);
  }, [parsed.body, parsed.frontmatter]);

  const updateAndEmit = (nextFrontmatter: SkillFrontmatter, nextBody: string) => {
    setFrontmatter(nextFrontmatter);
    setBody(nextBody);
    onChangeCode(composeSkillMarkdown(nextFrontmatter, nextBody));
  };

  return (
    <Box h="100%" minH="0" bg="var(--ws-surface-strong)" p={3} display="flex" flexDirection="column" gap={3}>
      <Accordion
        allowToggle
        defaultIndex={[]}
        border="1px solid"
        borderColor="var(--ws-border)"
        borderRadius="10px"
        bg="white"
        flexShrink={0}
      >
        <AccordionItem border="none">
          <AccordionButton px={3} py={2.5} _hover={{ bg: "rgba(148,163,184,0.08)" }}>
            <Box flex="1" textAlign="left">
              <HStack spacing={2} align="center" flexWrap="wrap">
                <Text fontSize="sm" fontWeight="700" color="var(--ws-text-main)">
                  SKILL Front Matter
                </Text>
                <Tag size="sm" colorScheme="blue">name: {frontmatter.name || "-"}</Tag>
                <Tag size="sm" colorScheme="green">license: {frontmatter.license || "-"}</Tag>
              </HStack>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pt={1} pb={3}>
            {parsed.parseError ? (
              <Text fontSize="xs" color="orange.600" mb={2}>
                {parsed.parseError}
              </Text>
            ) : null}
            <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={3}>
              <FormControl>
                <FormLabel fontSize="xs" color="var(--ws-text-subtle)" mb={1}>
                  name
                </FormLabel>
                <Input
                  size="sm"
                  value={frontmatter.name}
                  onChange={(event) =>
                    updateAndEmit(
                      {
                        ...frontmatter,
                        name: event.target.value,
                      },
                      body
                    )
                  }
                />
              </FormControl>
              <FormControl>
                <FormLabel fontSize="xs" color="var(--ws-text-subtle)" mb={1}>
                  license
                </FormLabel>
                <Input
                  size="sm"
                  value={frontmatter.license}
                  onChange={(event) =>
                    updateAndEmit(
                      {
                        ...frontmatter,
                        license: event.target.value,
                      },
                      body
                    )
                  }
                />
              </FormControl>
              <FormControl gridColumn={{ base: "auto", md: "1 / -1" }}>
                <FormLabel fontSize="xs" color="var(--ws-text-subtle)" mb={1}>
                  description
                </FormLabel>
                <Input
                  size="sm"
                  value={frontmatter.description}
                  onChange={(event) =>
                    updateAndEmit(
                      {
                        ...frontmatter,
                        description: event.target.value,
                      },
                      body
                    )
                  }
                />
              </FormControl>
            </Box>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      <Box
        flex="1"
        minH="0"
        border="1px solid"
        borderColor="var(--ws-border)"
        borderRadius="10px"
        bg="white"
        display="flex"
        flexDirection="column"
      >
        <Box px={3} py={2} borderBottom="1px solid" borderColor="var(--ws-border)">
          <Text fontSize="sm" fontWeight="700" color="var(--ws-text-main)">
            Markdown 内容
          </Text>
        </Box>
        <Textarea
          value={body}
          onChange={(event) => updateAndEmit(frontmatter, event.target.value)}
          flex="1"
          minH="0"
          h="100%"
          resize="none"
          border="none"
          borderRadius="0 0 10px 10px"
          _focusVisible={{ boxShadow: "inset 0 0 0 1px var(--chakra-colors-blue-400)" }}
          fontFamily="'Menlo', 'Monaco', 'Consolas', monospace"
          fontSize="13px"
          lineHeight="1.65"
          p={3}
        />
      </Box>
    </Box>
  );
};

export default SkillMarkdownEditor;
