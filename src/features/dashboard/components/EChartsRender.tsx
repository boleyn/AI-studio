import React from "react";
import { Box } from "@chakra-ui/react";

type Props = {
  mode?: string;
  codechart?: unknown;
  sql?: string;
  onAdd?: () => void;
};

const EChartsRender = ({ onAdd }: Props) => {
  return (
    <Box fontSize="sm" color="gray.500" onClick={onAdd}>
      ECharts
    </Box>
  );
};

export default EChartsRender;
