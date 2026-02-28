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
  onSaveStatusChange?: (status: SaveStatus) => void;
  onFilesChange?: (files: Record<string, { code: string }>) => void;
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
  onSaveStatusChange,
  onFilesChange,
  autoSaveDelay = 2000, // 默认2秒延迟
}, ref) => {
  const { sandpack } = useSandpack();
  const previousFilesRef = useRef<string>("");
  const isInitialMountRef = useRef(true);

  const saveProject = useCallback(async () => {
    if (!token || !sandpack.files) {
      return;
    }

    onSaveStatusChange?.("saving");

    try {
      // 只传文件内容，不传template和dependencies
      const response = await fetch(`/api/code?token=${encodeURIComponent(token)}&action=files`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          files: sandpack.files,
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
  }, [token, sandpack.files, onSaveStatusChange]);

  // 暴露手动保存方法
  useImperativeHandle(ref, () => ({
    save: saveProject,
  }), [saveProject]);

  const debouncedSave = useDebounce(saveProject, autoSaveDelay);

  useEffect(() => {
    // 跳过初始挂载，避免在加载项目时触发保存
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    // 将当前文件状态序列化为字符串进行比较
    const currentFilesString = JSON.stringify(sandpack.files);

    // 如果文件没有变化，不触发保存
    if (currentFilesString === previousFilesRef.current) {
      return;
    }

    // 更新之前的文件状态
    previousFilesRef.current = currentFilesString;
    onFilesChange?.(sandpack.files);

    // 触发防抖保存
    debouncedSave();
  }, [sandpack.files, debouncedSave, onFilesChange]);

  // 组件不渲染任何内容，只负责监听和保存
  return null;
});

CodeChangeListener.displayName = "CodeChangeListener";

export default CodeChangeListener;
export type { SaveStatus };
