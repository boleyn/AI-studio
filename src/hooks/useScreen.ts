import { useEffect, useState } from "react";

export const useScreen = () => {
  const getWidth = () => (typeof window === "undefined" ? 1200 : window.innerWidth);
  const [isPc, setIsPc] = useState(true);
  const [screenWidth, setScreenWidth] = useState(getWidth());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      const width = window.innerWidth;
      setIsPc(width >= 768);
      setScreenWidth(width);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return { isPc, screenWidth };
};
