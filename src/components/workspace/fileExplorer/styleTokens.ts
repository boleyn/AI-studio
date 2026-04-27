import { useMemo } from "react";
import { useTheme } from "@chakra-ui/react";

type ThemeMap = Record<string, any>;

export const useFileExplorerTheme = () => {
  const theme = useTheme() as ThemeMap;

  return useMemo(() => {
    const fileExplorerTheme = theme?.workspace?.fileExplorer;
    if (fileExplorerTheme) {
      return fileExplorerTheme;
    }

    return {
      panel: {
        minW: "236px",
        maxW: "372px",
        w: "272px",
        bg: "var(--ws-surface)",
        borderColor: "var(--ws-border)",
      },
      spacing: {
        rowY: "7px",
        createRowY: "4px",
        rowRight: 2,
        rowRadius: "10px",
        treeX: 2.5,
        treeY: 2.5,
        searchContainerX: 3,
        searchContainerY: 2,
        headerX: 4,
        headerY: 2.5,
        searchResultX: 2,
        searchResultY: 1.5,
        searchResultGap: 2,
        searchResultEmptyX: 1,
        searchResultEmptyY: 1,
        menuActionsGap: 1,
      },
      typography: {
        title: "sm",
        row: "sm",
        meta: "xs",
        titleWeight: "700",
        rowWeight: "500",
      },
      colors: {
        rowText: "var(--ws-text-main)",
        rowSelectedBg: "var(--ws-accent-soft)",
        rowHoverBg: "rgba(148,163,184,0.1)",
        inputFocusBorder: "rgba(37,99,235,0.8)",
        searchResultText: "var(--ws-text-main)",
        searchResultHoverBg: "rgba(148,163,184,0.16)",
        searchEmptyText: "var(--ws-text-subtle)",
      },
      sizes: {
        rowActionIcon: "md",
        menuListW: "180px",
        createMenuListW: "200px",
      },
      motion: {
        chevronTransition: "transform 0.15s ease",
      },
    };
  }, [theme?.workspace?.fileExplorer]);
};

const TREE_INDENT_STEP = 18;
const TREE_INDENT_BASE = 10;

export const getTreeIndent = (depth: number) => `${depth * TREE_INDENT_STEP + TREE_INDENT_BASE}px`;
