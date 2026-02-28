import { useMemo } from "react";

export const useSystem = () => {
  const isPc = useMemo(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  }, []);

  return { isPc };
};
