export type FileTreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: FileTreeNode[];
};

export const buildFileTree = (paths: string[]): FileTreeNode[] => {
  type BuildNode = {
    name: string;
    path: string;
    type: "dir" | "file";
    children: Map<string, BuildNode>;
  };

  const root = new Map<string, BuildNode>();

  for (const filePath of paths) {
    const segments = filePath.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let current = root;
    let currentPath = "";

    for (let i = 0; i < segments.length; i += 1) {
      const name = segments[i];
      currentPath = `${currentPath}/${name}`;
      const isFile = i === segments.length - 1;
      if (!current.has(name)) {
        current.set(name, {
          name,
          path: currentPath,
          type: isFile ? "file" : "dir",
          children: new Map<string, BuildNode>(),
        });
      }
      const target = current.get(name);
      if (!target) break;
      current = target.children;
    }
  }

  const toOutputNodes = (nodeMap: Map<string, BuildNode>): FileTreeNode[] =>
    [...nodeMap.values()]
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((node) =>
        node.type === "dir"
          ? {
              name: node.name,
              path: node.path,
              type: "dir",
              children: toOutputNodes(node.children),
            }
          : {
              name: node.name,
              path: node.path,
              type: "file",
            }
      );

  return toOutputNodes(root);
};

export const getAncestorDirs = (filePath: string): string[] => {
  const segments = filePath.split("/").filter(Boolean);
  const dirs: string[] = [];
  let current = "";
  for (let i = 0; i < segments.length - 1; i += 1) {
    current = `${current}/${segments[i]}`;
    dirs.push(current);
  }
  return dirs;
};

