import { useCallback } from "react";

export const useCopyData = () => {
  const copyData = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }, []);

  return { copyData };
};
