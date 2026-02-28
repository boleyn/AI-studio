import { Box, useToken } from "@chakra-ui/react";
import { motion } from "framer-motion";

const hexToRgba = (hex: string, alpha: number) => {
  const trimmed = hex.replace("#", "");
  const bigint = parseInt(trimmed, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const VectorBackground = () => {
  const [
    myGray50,
    primary100,
    green200,
    red100,
    primary500,
    green500,
    red500,
    primary400,
    green300,
    red400,
    myGray400,
  ] = useToken("colors", [
    "myGray.50",
    "primary.100",
    "green.200",
    "red.100",
    "primary.500",
    "green.500",
    "red.500",
    "primary.400",
    "green.300",
    "red.400",
    "myGray.400",
  ]);

  return (
    <Box
      position="fixed"
      top={0}
      left={0}
      w="100vw"
      h="100vh"
      overflow="hidden"
      bg={myGray50}
      zIndex={0}
      pointerEvents="none"
    >
      <motion.div
        style={{
          position: "absolute",
          top: "-10%",
          left: "-10%",
          width: "60vw",
          height: "60vw",
          borderRadius: "9999px",
          background: hexToRgba(primary100, 0.4),
          filter: "blur(100px)",
          mixBlendMode: "multiply",
        }}
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        style={{
          position: "absolute",
          bottom: "-10%",
          right: "-10%",
          width: "60vw",
          height: "60vw",
          borderRadius: "9999px",
          background: hexToRgba(green200, 0.4),
          filter: "blur(100px)",
          mixBlendMode: "multiply",
        }}
        animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />

      <motion.div
        style={{
          position: "absolute",
          top: "20%",
          right: "10%",
          width: "40vw",
          height: "40vw",
          borderRadius: "9999px",
          background: hexToRgba(red100, 0.4),
          filter: "blur(80px)",
          mixBlendMode: "multiply",
        }}
        animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 4 }}
      />

      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0.6,
        }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="grid-pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={hexToRgba(myGray400, 0.1)} strokeWidth="1" />
          </pattern>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={primary500} />
            <stop offset="100%" stopColor={green500} />
          </linearGradient>
          <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={red500} />
            <stop offset="100%" stopColor={primary500} />
          </linearGradient>
        </defs>

        <rect width="100%" height="100%" fill="url(#grid-pattern)" />

        <motion.path
          d="M0,100 Q400,300 800,100 T1600,200"
          fill="none"
          stroke="url(#grad1)"
          strokeWidth="2"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.3 }}
          transition={{ duration: 3, ease: "easeInOut" }}
        />
        <motion.path
          d="M-100,600 Q400,400 900,800"
          fill="none"
          stroke="url(#grad2)"
          strokeWidth="40"
          strokeLinecap="round"
          style={{ opacity: 0.05 }}
        />
      </svg>

      <Box position="absolute" inset={0} overflow="hidden">
        <motion.div
          style={{
            position: "absolute",
            top: "15%",
            left: "10%",
            width: "3rem",
            height: "3rem",
            borderRadius: "0.5rem",
            border: `2px solid ${hexToRgba(primary400, 0.2)}`,
          }}
          animate={{ y: [0, -10, 0], rotate: [0, 10, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          style={{
            position: "absolute",
            top: "70%",
            left: "20%",
            width: "2.5rem",
            height: "2.5rem",
            borderRadius: "9999px",
            border: `2px solid ${hexToRgba(green300, 0.2)}`,
          }}
          animate={{ y: [0, -12, 0], rotate: [0, -10, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          style={{
            position: "absolute",
            top: "35%",
            right: "15%",
            width: "2.5rem",
            height: "2.5rem",
            borderRadius: "0.5rem",
            border: `2px solid ${hexToRgba(red400, 0.2)}`,
          }}
          animate={{ y: [0, -8, 0], rotate: [0, 15, 0] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
        />
      </Box>
    </Box>
  );
};

export default VectorBackground;
