import React from "react";
import { Box } from "@chakra-ui/react";

export type IconNameType = string;

export type MyIconProps = {
  name?: string;
  w?: string | number;
  h?: string | number;
  color?: string;
  mr?: string | number;
  ml?: string | number;
  mt?: string | number;
  mb?: string | number;
  p?: string | number;
  cursor?: string;
  flexShrink?: number;
  [key: string]: any;
};

const MyIcon = ({ name, w = "1em", h, ...props }: MyIconProps) => {
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      w={w}
      h={h || w}
      fontSize="10px"
      bg="transparent"
      {...props}
    >
      {name ? String(name).slice(0, 2) : ""}
    </Box>
  );
};

export default MyIcon;
