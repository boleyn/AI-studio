import React from "react";
import { Image } from "@chakra-ui/react";

const PhotoView = ({ src, alt, ...props }: any) => {
  return <Image src={src} alt={alt || ""} {...props} />;
};

export default PhotoView;
