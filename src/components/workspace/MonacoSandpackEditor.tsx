import dynamic from "next/dynamic";
import { Box, Flex, Text } from "@chakra-ui/react";

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
  if (!extension) {
    return "plaintext";
  }
  return languageByExt[extension] || "plaintext";
};

type MonacoSandpackEditorProps = {
  code: string;
  activeFile: string;
  onChangeCode: (nextCode: string) => void;
};

const MonacoSandpackEditor = ({ activeFile, code, onChangeCode }: MonacoSandpackEditorProps) => {
  return (
    <Box display="flex" flexDirection="column" flex="1" minH="0">
      <Box flex="1" minH="0" bg="white">
        {!activeFile ? (
          <Flex
            height="100%"
            align="center"
            justify="center"
            p={{ base: 5, md: 8 }}
            bg="linear-gradient(135deg, rgba(246,250,255,0.92) 0%, rgba(255,249,242,0.9) 100%)"
            position="relative"
            overflow="hidden"
          >
            <Box
              position="absolute"
              top="-30%"
              right="-8%"
              width={{ base: "180px", md: "300px" }}
              height={{ base: "180px", md: "300px" }}
              bg="radial-gradient(circle at center, rgba(56,189,248,0.16) 0%, rgba(56,189,248,0) 70%)"
              pointerEvents="none"
            />
            <Box
              position="absolute"
              bottom="-35%"
              left="-8%"
              width={{ base: "210px", md: "340px" }}
              height={{ base: "210px", md: "340px" }}
              bg="radial-gradient(circle at center, rgba(251,146,60,0.16) 0%, rgba(251,146,60,0) 68%)"
              pointerEvents="none"
            />
            <Flex
              direction="column"
              align="center"
              gap={4}
              p={{ base: 6, md: 8 }}
              borderRadius="24px"
              border="1px solid rgba(148,163,184,0.26)"
              bg="rgba(255,255,255,0.76)"
              backdropFilter="blur(12px)"
              boxShadow="0 20px 45px -34px rgba(15,23,42,0.5)"
              textAlign="center"
              maxW="560px"
              className="editor-empty-state"
            >
              <Box
                as="img"
                src="/icon/logo.svg"
                alt="AI Studio"
                width={{ base: "52px", md: "60px" }}
                height={{ base: "52px", md: "60px" }}
                filter="drop-shadow(0 8px 16px rgba(30,64,175,0.2))"
              />
              <Text
                fontSize={{ base: "20px", md: "24px" }}
                lineHeight="1.2"
                fontWeight="800"
                color="#0f172a"
                letterSpacing="-0.02em"
              >
                欢迎来到 AI Studio Workspace
              </Text>
              <Text
                fontSize={{ base: "13px", md: "14px" }}
                color="#475569"
                lineHeight="1.8"
                maxW="440px"
              >
                当前没有打开任何文件。
                <br />
                请在左侧目录树点击一个文件，即可开始编辑或预览内容。
              </Text>
              <Box
                px={4}
                py={2}
                borderRadius="999px"
                bg="rgba(15,23,42,0.06)"
                color="#334155"
                fontSize="12px"
                fontWeight="600"
                letterSpacing="0.02em"
              >
                Tip: 支持直接创建文件、上传文件和导入 zip
              </Box>
            </Flex>
          </Flex>
        ) : (
          <MonacoEditor
            path={activeFile}
            value={code}
            language={getEditorLanguage(activeFile)}
            onChange={(value) => onChangeCode(value ?? "")}
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
        )}
      </Box>
    </Box>
  );
};

export default MonacoSandpackEditor;
