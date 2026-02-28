import { Box, useToken } from "@chakra-ui/react";
import { motion } from "framer-motion";
import { FileText, PenTool, Layout, X, Circle } from "lucide-react";

const hexToRgba = (hex: string, alpha: number) => {
  const trimmed = hex.replace("#", "");
  const bigint = parseInt(trimmed, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const FloatingGraph = () => {
  const [
    primary600,
    primary500,
    primary400,
    primary200,
    primary50,
    green500,
    red500,
    yellow500,
    myGray200,
    myGray100,
  ] = useToken("colors", [
    "primary.600",
    "primary.500",
    "primary.400",
    "primary.200",
    "primary.50",
    "green.500",
    "red.500",
    "yellow.500",
    "myGray.200",
    "myGray.100",
  ]);

  const satelliteIcons = [
    { Icon: FileText, color: green500, delay: 0, pos: { top: "5%", left: "5%" } },
    { Icon: PenTool, color: primary600, delay: 1, pos: { top: "5%", right: "5%" } },
    { Icon: X, color: red500, delay: 2, pos: { bottom: "5%", left: "5%" } },
    { Icon: Layout, color: yellow500, delay: 3, pos: { bottom: "5%", right: "5%" } },
  ];

  return (
    <Box position="relative" w="340px" h="340px">
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
          pointerEvents: "none",
        }}
      >
        <motion.line x1="50%" y1="50%" x2="18%" y2="18%" stroke={myGray200} strokeWidth="2" strokeDasharray="4 4" />
        <motion.line x1="50%" y1="50%" x2="82%" y2="18%" stroke={myGray200} strokeWidth="2" strokeDasharray="4 4" />
        <motion.line x1="50%" y1="50%" x2="18%" y2="82%" stroke={myGray200} strokeWidth="2" strokeDasharray="4 4" />
        <motion.line x1="50%" y1="50%" x2="82%" y2="82%" stroke={myGray200} strokeWidth="2" strokeDasharray="4 4" />

        <circle cx="50%" cy="50%" r="60" stroke={myGray200} strokeWidth="1" fill="none" />
        <circle cx="50%" cy="50%" r="45" stroke={primary200} strokeWidth="1" fill={hexToRgba(primary200, 0.05)} />
      </svg>

      <Box position="absolute" top="50%" left="50%" transform="translate(-50%, -50%)" zIndex={10}>
        <motion.div
          animate={{ y: [-5, 5, -5], scale: [1, 1.05, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Box
            w="80px"
            h="80px"
            bg="white"
            borderRadius="full"
            boxShadow={`0 10px 25px ${hexToRgba(primary500, 0.15)}`}
            display="flex"
            alignItems="center"
            justifyContent="center"
            position="relative"
            border={`1px solid ${primary50}`}
          >
            <Box w="60%" h="60%" borderRadius="full" border={`4px solid ${primary200}`} position="absolute" />
            <Circle size={24} fill={primary600} color={primary600} />
          </Box>
        </motion.div>
      </Box>

      {satelliteIcons.map((item, index) => (
        <Box
          key={index}
          position="absolute"
          top={item.pos.top}
          bottom={item.pos.bottom}
          left={item.pos.left}
          right={item.pos.right}
          zIndex={10}
        >
          <SatelliteIcon Icon={item.Icon} color={item.color} delay={item.delay} borderColor={myGray100} />
        </Box>
      ))}
    </Box>
  );
};

const SatelliteIcon = ({
  Icon,
  color,
  delay,
  borderColor,
}: {
  Icon: any;
  color: string;
  delay: number;
  borderColor: string;
}) => {
  return (
    <motion.div
      animate={{ y: [-8, 8, -8] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay }}
    >
      <Box
        bg="white"
        p={3}
        borderRadius="xl"
        boxShadow={`0 8px 16px -4px ${hexToRgba("#000000", 0.08)}`}
        border={`1px solid ${borderColor}`}
      >
        <Icon size={24} color={color} />
      </Box>
    </motion.div>
  );
};

export default FloatingGraph;
