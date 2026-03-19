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

const BACKGROUND_PARTICLES = [
  { top: "12%", left: "18%", size: 8, delay: 0 },
  { top: "22%", left: "72%", size: 10, delay: 0.8 },
  { top: "38%", left: "14%", size: 7, delay: 1.2 },
  { top: "45%", left: "86%", size: 9, delay: 0.4 },
  { top: "58%", left: "26%", size: 6, delay: 1.6 },
  { top: "66%", left: "66%", size: 8, delay: 0.9 },
  { top: "78%", left: "40%", size: 9, delay: 1.3 },
  { top: "84%", left: "82%", size: 7, delay: 0.6 },
];

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
    myGray300,
    primary300,
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
    "myGray.300",
    "primary.300",
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
          inset: "-25% -15% -20% -15%",
          background:
            "radial-gradient(closest-side at 15% 20%, rgba(51,112,255,0.28), rgba(51,112,255,0) 72%), radial-gradient(closest-side at 85% 80%, rgba(18,183,106,0.24), rgba(18,183,106,0) 72%)",
          filter: "blur(50px)",
          opacity: 0.72,
        }}
        animate={{ x: [0, -22, 0], y: [0, 20, 0], scale: [1, 1.04, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        style={{
          position: "absolute",
          top: "-10%",
          left: "-10%",
          width: "60vw",
          height: "60vw",
          borderRadius: "9999px",
          background: hexToRgba(primary100, 0.42),
          filter: "blur(100px)",
          mixBlendMode: "multiply",
        }}
        animate={{ scale: [1, 1.16, 1], opacity: [0.3, 0.55, 0.3], x: [0, 24, 0], y: [0, -16, 0] }}
        transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        style={{
          position: "absolute",
          bottom: "-10%",
          right: "-10%",
          width: "58vw",
          height: "58vw",
          borderRadius: "9999px",
          background: hexToRgba(green200, 0.38),
          filter: "blur(96px)",
          mixBlendMode: "multiply",
        }}
        animate={{ scale: [1, 1.1, 1], opacity: [0.28, 0.5, 0.28], x: [0, -18, 0], y: [0, 18, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
      />

      <motion.div
        style={{
          position: "absolute",
          top: "20%",
          right: "10%",
          width: "38vw",
          height: "38vw",
          borderRadius: "9999px",
          background: hexToRgba(red100, 0.34),
          filter: "blur(80px)",
          mixBlendMode: "multiply",
        }}
        animate={{ scale: [1, 1.22, 1], opacity: [0.35, 0.6, 0.35], x: [0, -10, 0], y: [0, -24, 0] }}
        transition={{ duration: 17, repeat: Infinity, ease: "easeInOut", delay: 2.4 }}
      />

      <motion.div
        style={{
          position: "absolute",
          inset: "-5%",
          opacity: 0.6,
        }}
        animate={{ x: [0, 14, 0], y: [0, -10, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "110%",
            height: "110%",
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
            animate={{ pathLength: [0.2, 1, 0.2], opacity: [0.1, 0.34, 0.1] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.path
            d="M-100,600 Q400,400 900,800"
            fill="none"
            stroke="url(#grad2)"
            strokeWidth="34"
            strokeLinecap="round"
            animate={{ opacity: [0.03, 0.08, 0.03] }}
            transition={{ duration: 9.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </svg>
      </motion.div>

      <Box position="absolute" inset={0} overflow="hidden">
        {BACKGROUND_PARTICLES.map((item, index) => (
          <motion.div
            key={`${item.top}-${item.left}`}
            style={{
              position: "absolute",
              top: item.top,
              left: item.left,
              width: `${item.size}px`,
              height: `${item.size}px`,
              borderRadius: "999px",
              background: hexToRgba(primary300, 0.45),
              boxShadow: `0 0 0 1px ${hexToRgba(myGray300, 0.3)}, 0 8px 20px ${hexToRgba(primary400, 0.25)}`,
            }}
            animate={{ y: [0, -10, 0], opacity: [0.25, 0.75, 0.25], scale: [1, 1.24, 1] }}
            transition={{ duration: 4.2 + index * 0.4, delay: item.delay, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}

        <motion.div
          style={{
            position: "absolute",
            top: "15%",
            left: "10%",
            width: "3rem",
            height: "3rem",
            borderRadius: "0.5rem",
            border: `2px solid ${hexToRgba(primary400, 0.22)}`,
          }}
          animate={{ y: [0, -10, 0], rotate: [0, 10, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          style={{
            position: "absolute",
            top: "70%",
            left: "20%",
            width: "2.5rem",
            height: "2.5rem",
            borderRadius: "9999px",
            border: `2px solid ${hexToRgba(green300, 0.22)}`,
          }}
          animate={{ y: [0, -12, 0], rotate: [0, -10, 0] }}
          transition={{ duration: 6.8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          style={{
            position: "absolute",
            top: "35%",
            right: "15%",
            width: "2.5rem",
            height: "2.5rem",
            borderRadius: "0.5rem",
            border: `2px solid ${hexToRgba(red400, 0.22)}`,
          }}
          animate={{ y: [0, -8, 0], rotate: [0, 15, 0] }}
          transition={{ duration: 5.8, repeat: Infinity, ease: "easeInOut" }}
        />
      </Box>
    </Box>
  );
};

export default VectorBackground;
