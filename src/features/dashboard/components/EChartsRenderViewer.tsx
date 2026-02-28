import React from "react";
import { Box } from "@chakra-ui/react";

type Props = {
  option?: unknown;
  width?: string | number;
  height?: string | number;
};

const EChartsRenderViewer = ({ width = "100%", height = "300px" }: Props) => {
  return (
    <Box fontSize="sm" color="gray.500" w={width} h={height}>
      ECharts Viewer
    </Box>
  );
};

export default EChartsRenderViewer;
