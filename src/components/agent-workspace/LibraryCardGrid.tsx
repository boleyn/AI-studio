import { Box } from "@chakra-ui/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export default function LibraryCardGrid({ masonry, selecting, children }: { masonry: boolean; selecting: boolean; children: ReactNode }) {
  const grid = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = grid.current;
    if (!masonry || !container) return;
    const cards = Array.from(container.children) as HTMLElement[];
    function arrange() {
      if (!container || !container.clientWidth) return;
      const style = getComputedStyle(container);
      const columns = style.gridTemplateColumns.split(" ").length;
      const gap = parseFloat(style.columnGap);
      const heights = Array<number>(columns).fill(0);
      for (const card of cards) {
        const column = heights.indexOf(Math.min(...heights));
        card.style.gridArea = `1 / ${column + 1}`;
        card.style.transform = `translateY(${heights[column]}px)`;
        heights[column] += card.getBoundingClientRect().height + gap;
      }
      container.style.height = Math.max(0, Math.max(...heights) - gap) + "px";
    }
    arrange();
    const observer = new ResizeObserver(arrange);
    observer.observe(container);
    cards.forEach(card => observer.observe(card));
    return () => {
      observer.disconnect();
      container.style.height = "";
      for (const card of cards) {
        card.style.gridArea = "";
        card.style.transform = "";
      }
    };
  }, [masonry, children]);

  return <Box ref={grid} data-selecting={selecting} display="grid" gridTemplateColumns="repeat(auto-fill,minmax(min(180px,100%),1fr))"
    sx={masonry ? {"& > * > [role=checkbox]": {
      insetBlockStart: "auto", insetBlockEnd: "18px", insetInlineEnd: "18px", boxSize: "20px", background: "white",
    }, "& > * > [role=checkbox][aria-checked=true]": {
      background: "#171717", color: "white", borderColor: "transparent",
    }, "& .chakra-menu__menu-button": {
      position: "absolute", insetBlockStart: "4px", insetInlineEnd: "8px",
      boxSize: "36px", minWidth: "36px", padding: 0, borderRadius: "full", color: "#707070",
    }, "@media (hover:hover) and (not (any-pointer:coarse))": {
      "& > :not(:hover) .chakra-menu__menu-button:not(:focus-visible):not([aria-expanded=true])": {opacity: 0},
      "&[data-selecting=false] > :not(:hover):not(:focus-within) > [role=checkbox]": {opacity: 0},
    }} : undefined}
    alignItems={masonry ? "start" : undefined} alignContent="start" gap={masonry ? "16px" : 3}>{children}</Box>;
}
