import yaml from "js-yaml";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import styles from "./SkillDetailPreview.module.css";

type SandpackFileEntry = string | { code?: unknown };

type SkillDetailPreviewProps = {
  files: Record<string, SandpackFileEntry>;
  activeFile: string;
  onSelectFile?: (path: string) => void;
  flat?: boolean;
};

type SkillFrontmatter = {
  name?: string;
  description?: string;
  license?: string;
};

const getFileCode = (entry: SandpackFileEntry | undefined): string => {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && "code" in entry && typeof entry.code === "string") {
    return entry.code;
  }
  return "";
};

const stripFrontmatter = (content: string) => {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return content;
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return content;
  return normalized.slice(endIndex + 4).replace(/^\n+/, "");
};

const parseSkillFrontmatter = (content: string): SkillFrontmatter => {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};
  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== "object") return {};
    const obj = parsed as Record<string, unknown>;
    return {
      name: typeof obj.name === "string" ? obj.name : undefined,
      description: typeof obj.description === "string" ? obj.description : undefined,
      license: typeof obj.license === "string" ? obj.license : undefined,
    };
  } catch {
    return {};
  }
};

const extToLang = (path: string) => {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "ts" || ext === "tsx") return "ts";
  if (ext === "js" || ext === "jsx") return "js";
  if (ext === "py") return "python";
  if (ext === "json") return "json";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "sh") return "bash";
  if (ext === "md") return "markdown";
  return "text";
};

const SkillDetailPreview = ({ files, activeFile, onSelectFile, flat = false }: SkillDetailPreviewProps) => {
  const skillRoots = useMemo(() => {
    const roots = new Set<string>();
    Object.keys(files).forEach((path) => {
      const match = path.match(/^\/skills\/[^/]+/i);
      if (match) roots.add(match[0]);
    });
    return Array.from(roots).sort((a, b) => a.localeCompare(b));
  }, [files]);

  const currentRoot = useMemo(() => {
    if (activeFile) {
      const activeRoot = skillRoots.find((root) => activeFile === root || activeFile.startsWith(`${root}/`));
      if (activeRoot) return activeRoot;
    }
    return skillRoots[0] || "";
  }, [activeFile, skillRoots]);

  const rootFiles = useMemo(() => {
    if (!currentRoot) return [] as Array<{ path: string; code: string; relPath: string }>;
    return Object.entries(files)
      .filter(([path]) => path === currentRoot || path.startsWith(`${currentRoot}/`))
      .map(([path, entry]) => {
        const relPath = path.startsWith(`${currentRoot}/`) ? path.slice(currentRoot.length + 1) : path;
        return {
          path,
          relPath,
          code: getFileCode(entry),
        };
      })
      .sort((a, b) => a.relPath.localeCompare(b.relPath));
  }, [currentRoot, files]);

  const skillEntry = useMemo(
    () => rootFiles.find((file) => /(^|\/)SKILL\.md$/i.test(file.relPath || file.path)) || null,
    [rootFiles]
  );

  const frontmatter = useMemo(() => parseSkillFrontmatter(skillEntry?.code || ""), [skillEntry?.code]);

  const [selectedPath, setSelectedPath] = useState<string>("");

  useEffect(() => {
    if (activeFile && rootFiles.some((file) => file.path === activeFile)) {
      setSelectedPath(activeFile);
      return;
    }
    setSelectedPath(skillEntry?.path || rootFiles[0]?.path || "");
  }, [activeFile, rootFiles, skillEntry?.path]);

  const selectedFile = useMemo(
    () => rootFiles.find((file) => file.path === selectedPath) || null,
    [rootFiles, selectedPath]
  );

  const previewContent = useMemo(() => {
    if (!selectedFile) return "";
    const isMarkdown = /\.(md|markdown)$/i.test(selectedFile.relPath);
    if (isMarkdown) {
      const body = /(^|\/)SKILL\.md$/i.test(selectedFile.relPath)
        ? stripFrontmatter(selectedFile.code)
        : selectedFile.code;
      return body;
    }
    const lang = extToLang(selectedFile.relPath);
    return `\`\`\`${lang}\n${selectedFile.code}\n\`\`\``;
  }, [selectedFile]);

  const description = frontmatter.description?.trim() || "暂无描述";

  if (!currentRoot) {
    return (
      <div className={styles.emptyStateWrap}>
        <div className={styles.emptyStateCard}>先在左侧创建 /skills/&lt;name&gt;/SKILL.md 后再预览</div>
      </div>
    );
  }

  return (
    <div className={`${styles.previewRoot}${flat ? ` ${styles.previewRootFlat}` : ""}`}>
      <div className={`${styles.detailCard}${flat ? ` ${styles.detailCardFlat}` : ""}`}>
        <p className={styles.detailDesc}>{description}</p>

        <div className={styles.filePills}>
          {rootFiles.map((file) => (
            <button
              key={file.path}
              className={`${styles.filePill}${selectedPath === file.path ? ` ${styles.filePillActive}` : ""}`}
              type="button"
              onClick={() => {
                setSelectedPath(file.path);
                onSelectFile?.(file.path);
              }}
            >
              {file.relPath}
            </button>
          ))}
        </div>

        <div className={styles.divider} />

        <div className={styles.previewPane}>
          {/\bSKILL\.md$/i.test(selectedFile?.relPath || "") ? (
            <div className={styles.metaLine}>
              <strong>name:</strong> {frontmatter.name || "-"} <strong>description:</strong>{" "}
              {frontmatter.description || "-"}
            </div>
          ) : null}
          <div className={styles.markdown}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={{
                pre({ children }) {
                  return <pre className={styles.codePre}>{children}</pre>;
                },
                code({ inline, children, ...props }) {
                  if (inline) {
                    return (
                      <code className={styles.inlineCode} {...props}>
                        {children}
                      </code>
                    );
                  }
                  return <code {...props}>{children}</code>;
                },
              }}
            >
              {previewContent || "(empty)"}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SkillDetailPreview;
