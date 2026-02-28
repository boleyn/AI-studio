import { Image } from "@chakra-ui/react";

const Avatar = ({ src, w = "20px" }: { src?: string; w?: string | number }) => {
  return <Image src={src || "/icon/logo.svg"} w={w} h={w} alt="" />;
};

export default Avatar;
