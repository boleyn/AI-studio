import { useCallback, useRef, useState } from "react";

type Options = {
  manual?: boolean;
};

export const useRequest2 = <T, P extends any[]>(
  fn: (...args: P) => Promise<T>,
  options: Options = {}
) => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const argsRef = useRef<P | null>(null);

  const runAsync = useCallback(async (...args: P) => {
    argsRef.current = args;
    setLoading(true);
    try {
      const result = await fn(...args);
      setData(result);
      return result;
    } finally {
      setLoading(false);
    }
  }, [fn]);

  const run = useCallback((...args: P) => {
    void runAsync(...args);
  }, [runAsync]);

  if (!options.manual && argsRef.current === null) {
    void runAsync(...([] as unknown as P));
  }

  return { data, loading, runAsync, run };
};
