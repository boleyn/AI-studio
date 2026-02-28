import React from "react";
import { Avatar as ChakraAvatar } from "@chakra-ui/react";

const MyAvatar = ({ src, ...props }: any) => {
  return <ChakraAvatar src={src} size="sm" {...props} />;
};

export default MyAvatar;
