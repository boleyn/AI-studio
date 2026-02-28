import React from "react";
import { Tooltip } from "@chakra-ui/react";

const MyTooltip = ({ children, label, ...props }: any) => {
  return (
    <Tooltip label={label} {...props}>
      {children}
    </Tooltip>
  );
};

export default MyTooltip;
