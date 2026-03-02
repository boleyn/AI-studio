import dynamic from "next/dynamic";
import { Box } from "@chakra-ui/react";
import { useActiveCode, useSandpack } from "@codesandbox/sandpack-react";

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

const MonacoSandpackEditor = () => {
  const { code, updateCode } = useActiveCode();
  const { sandpack } = useSandpack();
  const activeFile = sandpack.activeFile;

  return (
    <Box display="flex" flexDirection="column" flex="1" minH="0">
      <Box flex="1" minH="0" bg="white">
        <MonacoEditor
          path={activeFile}
          value={code}
          language={getEditorLanguage(activeFile)}
          onChange={(value) => updateCode(value ?? "")}
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
    </Box>
  );
};

export default MonacoSandpackEditor;
