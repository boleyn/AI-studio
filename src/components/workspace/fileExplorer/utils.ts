import type { FileNode, FolderNode, SandpackFilesPayload } from "./types";

export const normalizeRelativePath = (rawPath: string): string | null => {
  const normalized = rawPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");

  if (!normalized || normalized.includes("..") || normalized.includes("\0")) {
    return null;
  }

  return normalized;
};

export const toSandpackPath = (rawPath: string): string | null => {
  const relativePath = normalizeRelativePath(rawPath);
  if (!relativePath) return null;
  return `/${relativePath}`;
};

export const joinPath = (parentPath: string, name: string): string | null => {
  const normalizedName = normalizeRelativePath(name);
  if (!normalizedName) return null;

  const base = parentPath === "/" ? "" : parentPath;
  return toSandpackPath(`${base.replace(/^\/+/, "")}/${normalizedName}`.replace(/^\/+/, ""));
};

export const getParentPath = (path: string): string => {
  const normalized = path.replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) return "/";
  return normalized.slice(0, slashIndex);
};

export const buildInitialFileCode = (filePath: string): string => {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith(".tsx") || lowerPath.endsWith(".jsx")) {
    return `export default function Component() {\n  return <div>New component</div>;\n}\n`;
  }
  if (lowerPath.endsWith(".ts")) {
    return `export {};\n`;
  }
  if (lowerPath.endsWith(".js")) {
    return `export default function main() {\n  return null;\n}\n`;
  }
  if (lowerPath.endsWith(".json")) {
    return `{}\n`;
  }
  if (lowerPath.endsWith(".css")) {
    return `/* new styles */\n`;
  }
  if (lowerPath.endsWith(".md")) {
    return `# New file\n`;
  }
  return "";
};

const createFolderNode = (name: string, path: string): FolderNode => ({
  type: "folder",
  name,
  path,
  folderMap: new Map(),
  fileMap: new Map(),
  entries: [],
});

export const buildTree = (files: SandpackFilesPayload): FolderNode => {
  const root = createFolderNode("", "/");

  const ensureFolder = (parent: FolderNode, name: string): FolderNode => {
    const existing = parent.folderMap.get(name);
    if (existing) return existing;

    const folderPath = parent.path === "/" ? `/${name}` : `${parent.path}/${name}`;
    const next = createFolderNode(name, folderPath);
    parent.folderMap.set(name, next);
    parent.entries.push({ kind: "folder", path: next.path });
    return next;
  };

  Object.keys(files).forEach((filePath) => {
    const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
    const segments = normalizedPath.replace(/^\/+/, "").split("/").filter(Boolean);
    if (segments.length === 0) return;

    let folderCursor = root;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (!isLast) {
        folderCursor = ensureFolder(folderCursor, segment);
        continue;
      }

      if (segment === ".gitkeep") {
        return;
      }

      if (!folderCursor.fileMap.has(segment)) {
        const absolutePath = folderCursor.path === "/" ? `/${segment}` : `${folderCursor.path}/${segment}`;
        const fileNode: FileNode = {
          type: "file",
          name: segment,
          path: absolutePath,
        };
        folderCursor.fileMap.set(segment, fileNode);
        folderCursor.entries.push({ kind: "file", path: fileNode.path });
      }
    }
  });

  return root;
};

export const collectFolderPaths = (folder: FolderNode, result: string[] = []): string[] => {
  result.push(folder.path);
  folder.folderMap.forEach((child) => collectFolderPaths(child, result));
  return result;
};

export const buildFolderMap = (root: FolderNode) => {
  const map = new Map<string, FolderNode>();
  const walk = (node: FolderNode) => {
    map.set(node.path, node);
    node.folderMap.forEach(walk);
  };
  walk(root);
  return map;
};

export const buildFileMap = (root: FolderNode) => {
  const map = new Map<string, FileNode>();
  const walk = (node: FolderNode) => {
    node.fileMap.forEach((fileNode) => map.set(fileNode.path, fileNode));
    node.folderMap.forEach(walk);
  };
  walk(root);
  return map;
};
