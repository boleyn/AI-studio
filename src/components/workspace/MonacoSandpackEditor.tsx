import dynamic from "next/dynamic";
import { Box, Text } from "@chakra-ui/react";

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
          <Box
            height="100%"
            display="flex"
            alignItems="center"
            justifyContent="center"
            p={4}
          >
            <Text fontSize="sm" color="gray.600">
              暂无可编辑文件
            </Text>
          </Box>
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
