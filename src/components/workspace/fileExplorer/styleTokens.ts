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
        minW: "220px",
        maxW: "360px",
        bg: "white",
        borderColor: "myGray.200",
      },
      spacing: {
        rowY: "6px",
        createRowY: "4px",
        rowRight: 1.5,
        rowRadius: "md",
        treeX: 2,
        treeY: 2,
        searchContainerX: 3,
        searchContainerY: 2,
        headerX: 4,
        headerY: 3,
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
        titleWeight: "600",
        rowWeight: "500",
      },
      colors: {
        rowText: "myGray.700",
        rowSelectedBg: "myGray.150",
        rowHoverBg: "myGray.50",
        inputFocusBorder: "blue.400",
        searchResultText: "myGray.700",
        searchResultHoverBg: "myGray.100",
        searchEmptyText: "myGray.500",
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
