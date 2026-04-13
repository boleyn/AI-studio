import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { useSandpack } from "@codesandbox/sandpack-react";
import { withAuthHeaders } from "@features/auth/client/authClient";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export type CodeChangeListenerHandle = {
  save: () => Promise<void>;
};

type CodeChangeListenerProps = {
  token: string;
  template: string;
  dependencies?: Record<string, string>;
  transientPaths?: string[];
  onSaveStatusChange?: (status: SaveStatus) => void;
  onFilesChange?: (files: Record<string, { code: string }>) => void;
  onPersistFiles?: (files: Record<string, { code: string }>) => Promise<void>;
  autoSaveDelay?: number; // 防抖延迟（毫秒）
};

/**
 * 防抖hook
 */
function useDebounce<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    }) as T,
    [callback, delay]
  );
}

const CodeChangeListener = forwardRef<CodeChangeListenerHandle, CodeChangeListenerProps>(({
  token,
  template,
  dependencies = {},
  transientPaths = [],
  onSaveStatusChange,
  onFilesChange,
  onPersistFiles,
  autoSaveDelay = 2000, // 默认2秒延迟
}, ref) => {
  const { sandpack } = useSandpack();
  const previousFilesRef = useRef<string>("");
  const isInitialMountRef = useRef(true);
  const suppressAutoSaveUntilRef = useRef<number>(Date.now() + 3000);
  const sanitizeFiles = useCallback(
    (input: Record<string, { code: string }> | undefined) => {
      if (!input) return {};
      if (!transientPaths.length) return input;
      const transientSet = new Set(transientPaths);
      return Object.fromEntries(Object.entries(input).filter(([filePath]) => !transientSet.has(filePath)));
    },
    [transientPaths]
  );

  const saveProject = useCallback(async () => {
    if (!token || !sandpack.files) {
      return;
    }

    onSaveStatusChange?.("saving");

    try {
      const sanitizedFiles = sanitizeFiles(sandpack.files);

      if (onPersistFiles) {
        await onPersistFiles(sanitizedFiles);
        onSaveStatusChange?.("saved");
        return;
      }

      // 只传文件内容，不传template和dependencies
      const response = await fetch(`/api/code?token=${encodeURIComponent(token)}&action=files`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          files: sanitizedFiles,
        }),
      });

      if (!response.ok) {
        throw new Error(`保存失败: ${response.status}`);
      }

      onSaveStatusChange?.("saved");
    } catch (error) {
      console.error("Failed to save project:", error);
      onSaveStatusChange?.("error");
    }
  }, [onPersistFiles, token, sandpack.files, onSaveStatusChange, sanitizeFiles]);

  // 暴露手动保存方法
  useImperativeHandle(ref, () => ({
    save: saveProject,
  }), [saveProject]);

  const debouncedSave = useDebounce(saveProject, autoSaveDelay);

  useEffect(() => {
    // 跳过初始挂载，避免在加载项目时触发保存
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      const initialFiles = sanitizeFiles(sandpack.files);
      previousFilesRef.current = JSON.stringify(initialFiles);
      return;
    }

    // 将当前文件状态序列化为字符串进行比较
    const sanitizedFiles = sanitizeFiles(sandpack.files);
    const currentFilesString = JSON.stringify(sanitizedFiles);

    // 如果文件没有变化，不触发保存
    if (currentFilesString === previousFilesRef.current) {
      return;
    }

    // 更新之前的文件状态
    previousFilesRef.current = currentFilesString;
    onFilesChange?.(sanitizedFiles);

    // 初始化期间忽略 Sandpack 模板补齐带来的文件波动
    if (Date.now() < suppressAutoSaveUntilRef.current) {
      return;
    }

    // 触发防抖保存
    debouncedSave();
  }, [sandpack.files, debouncedSave, onFilesChange, sanitizeFiles]);

  // 组件不渲染任何内容，只负责监听和保存
  return null;
});

CodeChangeListener.displayName = "CodeChangeListener";

export default CodeChangeListener;
export type { SaveStatus };
