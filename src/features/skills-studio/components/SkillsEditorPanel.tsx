import dynamic from "next/dynamic";
import { Box, Button, Flex, HStack, Input, Text, Textarea } from "@chakra-ui/react";
import yaml from "js-yaml";
import Markdown from "@/components/Markdown";
import { useEffect, useMemo, useState } from "react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

const languageByExt: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  sh: "shell",
  py: "python",
  java: "java",
  go: "go",
  rs: "rust",
};

const getEditorLanguage = (filePath: string): string => {
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (!extension) return "plaintext";
  return languageByExt[extension] || "plaintext";
};

type SkillFrontmatter = {
  name: string;
  description: string;
  version: string;
  compatibility: string;
  license: string;
  metadata: Record<string, string>;
};

const DEFAULT_SKILL_FRONTMATTER: SkillFrontmatter = {
  name: "",
  description: "",
  version: "",
  compatibility: "",
  license: "",
  metadata: {},
};

const parseSkillDocument = (source: string): { frontmatter: SkillFrontmatter; body: string } => {
  const trimmed = source.trimStart();
  const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return {
      frontmatter: { ...DEFAULT_SKILL_FRONTMATTER },
      body: source,
    };
  }

  const frontmatterText = match[1];
  const body = trimmed.slice(match[0].length);
  const parsed = yaml.load(frontmatterText);
  const frontmatterObject =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  const metadataRaw = frontmatterObject.metadata;
  const metadataEntries =
    metadataRaw && typeof metadataRaw === "object" && !Array.isArray(metadataRaw)
      ? Object.entries(metadataRaw).filter(
          (item): item is [string, string] => typeof item[0] === "string" && typeof item[1] === "string"
        )
      : [];

  return {
    frontmatter: {
      name: typeof frontmatterObject.name === "string" ? frontmatterObject.name : "",
      description: typeof frontmatterObject.description === "string" ? frontmatterObject.description : "",
      version: typeof frontmatterObject.version === "string" ? frontmatterObject.version : "",
      compatibility: typeof frontmatterObject.compatibility === "string" ? frontmatterObject.compatibility : "",
      license: typeof frontmatterObject.license === "string" ? frontmatterObject.license : "",
      metadata: Object.fromEntries(metadataEntries),
    },
    body,
  };
};

const stringifySkillDocument = (frontmatter: SkillFrontmatter, body: string) => {
  const payload: Record<string, unknown> = {};
  if (frontmatter.name.trim()) payload.name = frontmatter.name.trim();
  if (frontmatter.description.trim()) payload.description = frontmatter.description.trim();
  if (frontmatter.version.trim()) payload.version = frontmatter.version.trim();
  if (frontmatter.compatibility.trim()) payload.compatibility = frontmatter.compatibility.trim();
  if (frontmatter.license.trim()) payload.license = frontmatter.license.trim();
  const metadataEntries = Object.entries(frontmatter.metadata).filter(
    (item): item is [string, string] => Boolean(item[0].trim()) && Boolean(item[1].trim())
  );
  if (metadataEntries.length > 0) {
    payload.metadata = Object.fromEntries(metadataEntries);
  }

  const frontmatterYaml = yaml.dump(payload, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: true,
  });
  const normalizedBody = body.replace(/^\s+/, "");
  return `---\n${frontmatterYaml}---\n\n${normalizedBody}`;
};

type SkillsEditorPanelProps = {
  activeView: "preview" | "code";
  activeFile: string;
  isMarkdownFile: boolean;
  selectedCode: string;
  draftCode: string;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string;
  onChangeDraft: (value: string) => void;
  onSave: () => void;
};

const SkillsEditorPanel = ({
  activeView,
  activeFile,
  isMarkdownFile,
  selectedCode,
  draftCode,
  isDirty,
  isSaving,
  saveError,
  onChangeDraft,
  onSave,
}: SkillsEditorPanelProps) => {
  const content = isDirty ? draftCode : selectedCode;
  const isSkillFile = useMemo(() => /\/SKILL\.md$/i.test(activeFile), [activeFile]);
  const [skillFrontmatter, setSkillFrontmatter] = useState<SkillFrontmatter>(DEFAULT_SKILL_FRONTMATTER);
  const [skillBody, setSkillBody] = useState("");
  const fileStatus = (() => {
    if (saveError) return `文件：${saveError}`;
    if (!activeFile) return "文件：未选择";
    if (isSaving) return "文件：保存中";
    if (isDirty) return "文件：未保存";
    return "文件：已保存";
  })();
  const fileStatusColor = saveError
    ? "red.500"
    : isDirty
    ? "orange.500"
    : isSaving
    ? "blue.500"
    : "green.600";

  useEffect(() => {
    if (!isSkillFile) return;
    const parsed = parseSkillDocument(draftCode);
    setSkillFrontmatter(parsed.frontmatter);
    setSkillBody(parsed.body);
  }, [draftCode, isSkillFile]);

  const updateSkillDoc = (next: { frontmatter?: SkillFrontmatter; body?: string }) => {
    const mergedFrontmatter = next.frontmatter || skillFrontmatter;
    const mergedBody = typeof next.body === "string" ? next.body : skillBody;
    const nextDoc = stringifySkillDocument(mergedFrontmatter, mergedBody);
    onChangeDraft(nextDoc);
  };

  if (activeView === "preview") {
    return (
      <Flex direction="column" minH="100%" h="100%">
        <Text color="myGray.700" fontSize="xs" fontWeight="700" mb={2}>
          {activeFile || "请选择文件"}
        </Text>
        {!content ? (
          <Text color="myGray.500" fontSize="sm">
            （空内容）
          </Text>
        ) : isMarkdownFile ? (
          <Markdown source={content} />
        ) : (
          <Text fontFamily="mono" fontSize="12px" color="myGray.700" whiteSpace="pre-wrap">
            {content}
          </Text>
        )}
      </Flex>
    );
  }

  if (isSkillFile) {
    return (
      <Flex direction="column" minH="100%" h="100%">
        <Flex align="center" justify="space-between" px={3} py={2} borderBottom="1px solid" borderColor="myGray.200">
          <Flex align="center" gap={2} minW={0}>
            <Text color="myGray.700" fontSize="xs" fontWeight="700" isTruncated>
              {activeFile || "请选择文件"}
            </Text>
            <Text color={fileStatusColor} fontSize="xs" fontWeight="600" flexShrink={0}>
              {fileStatus}
            </Text>
          </Flex>
          <Button
            size="xs"
            colorScheme="blue"
            onClick={onSave}
            isDisabled={!activeFile || !isDirty}
            isLoading={isSaving}
          >
            保存
          </Button>
        </Flex>

        <Flex direction="column" gap={3} p={3} borderBottom="1px solid" borderColor="myGray.200" bg="white">
          <Text fontSize="xs" fontWeight="700" color="myGray.600">
            Skill 基础信息
          </Text>
          <HStack spacing={3}>
            <Input
              size="sm"
              placeholder="name (例如: example-refactor)"
              value={skillFrontmatter.name}
              onChange={(event) => {
                const nextFrontmatter = { ...skillFrontmatter, name: event.target.value };
                setSkillFrontmatter(nextFrontmatter);
                updateSkillDoc({ frontmatter: nextFrontmatter });
              }}
            />
            <Input
              size="sm"
              placeholder="version (可选)"
              value={skillFrontmatter.version}
              onChange={(event) => {
                const nextFrontmatter = { ...skillFrontmatter, version: event.target.value };
                setSkillFrontmatter(nextFrontmatter);
                updateSkillDoc({ frontmatter: nextFrontmatter });
              }}
            />
          </HStack>
          <Input
            size="sm"
            placeholder="description"
            value={skillFrontmatter.description}
            onChange={(event) => {
              const nextFrontmatter = { ...skillFrontmatter, description: event.target.value };
              setSkillFrontmatter(nextFrontmatter);
              updateSkillDoc({ frontmatter: nextFrontmatter });
            }}
          />
          <HStack spacing={3}>
            <Input
              size="sm"
              placeholder="compatibility (可选)"
              value={skillFrontmatter.compatibility}
              onChange={(event) => {
                const nextFrontmatter = { ...skillFrontmatter, compatibility: event.target.value };
                setSkillFrontmatter(nextFrontmatter);
                updateSkillDoc({ frontmatter: nextFrontmatter });
              }}
            />
            <Input
              size="sm"
              placeholder="license (可选)"
              value={skillFrontmatter.license}
              onChange={(event) => {
                const nextFrontmatter = { ...skillFrontmatter, license: event.target.value };
                setSkillFrontmatter(nextFrontmatter);
                updateSkillDoc({ frontmatter: nextFrontmatter });
              }}
            />
          </HStack>
          <Textarea
            size="sm"
            placeholder={"metadata（YAML对象），例如:\naudience: developers\nworkflow: refactor"}
            minH="90px"
            value={yaml.dump(skillFrontmatter.metadata || {}, { lineWidth: 120, noRefs: true })}
            onChange={(event) => {
              const raw = event.target.value.trim();
              try {
                const parsed = raw
                  ? yaml.load(raw)
                  : {};
                const nextMetadata =
                  parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? Object.fromEntries(
                        Object.entries(parsed as Record<string, unknown>).filter(
                          (item): item is [string, string] =>
                            typeof item[0] === "string" && typeof item[1] === "string"
                        )
                      )
                    : {};
                const nextFrontmatter = { ...skillFrontmatter, metadata: nextMetadata };
                setSkillFrontmatter(nextFrontmatter);
                updateSkillDoc({ frontmatter: nextFrontmatter });
              } catch {
                // ignore temporary invalid YAML while typing
              }
            }}
          />
        </Flex>

        <Box flex="1" minH={0} bg="white">
          <MonacoEditor
            path={activeFile || "SKILL.md"}
            value={skillBody}
            language="markdown"
            onChange={(value) => {
              const nextBody = value ?? "";
              setSkillBody(nextBody);
              updateSkillDoc({ body: nextBody });
            }}
            theme="vs"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              wordWrap: "on",
              automaticLayout: true,
              scrollBeyondLastLine: false,
            }}
            width="100%"
            height="100%"
          />
        </Box>
      </Flex>
    );
  }

  return (
    <Flex direction="column" minH="100%" h="100%">
      <Flex align="center" justify="space-between" px={3} py={2} borderBottom="1px solid" borderColor="myGray.200">
        <Flex align="center" gap={2} minW={0}>
          <Text color="myGray.700" fontSize="xs" fontWeight="700" isTruncated>
            {activeFile || "请选择文件"}
          </Text>
          <Text color={fileStatusColor} fontSize="xs" fontWeight="600" flexShrink={0}>
            {fileStatus}
          </Text>
        </Flex>
        <Button
          size="xs"
          colorScheme="blue"
          onClick={onSave}
          isDisabled={!activeFile || !isDirty}
          isLoading={isSaving}
        >
          保存
        </Button>
      </Flex>
      <Box flex="1" minH={0} bg="white">
        <MonacoEditor
          path={activeFile || "untitled.txt"}
          value={draftCode}
          language={getEditorLanguage(activeFile)}
          onChange={(value) => onChangeDraft(value ?? "")}
          theme="vs"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "on",
            automaticLayout: true,
            scrollBeyondLastLine: false,
          }}
          width="100%"
          height="100%"
        />
      </Box>
    </Flex>
  );
};

export default SkillsEditorPanel;
