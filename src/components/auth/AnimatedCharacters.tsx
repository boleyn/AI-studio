import { Box } from "@chakra-ui/react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

type AnimatedCharactersProps = {
  compact?: boolean;
};

const MotionBox = motion(Box);

type EyeProps = {
  x: number;
  y: number;
  lookX: number;
  lookY: number;
  blink: boolean;
  eyeColor?: string;
  pupilColor?: string;
};

function Eye({ x, y, lookX, lookY, blink, eyeColor = "white", pupilColor = "#111827" }: EyeProps) {
  return (
    <MotionBox
      position="absolute"
      top={`${y}%`}
      left={`${x}%`}
      w="14px"
      h={blink ? "3px" : "14px"}
      borderRadius="full"
      bg={eyeColor}
      transform="translate(-50%, -50%)"
      overflow="hidden"
      transition={{ duration: 0.12 }}
    >
      <MotionBox
        position="absolute"
        top="50%"
        left="50%"
        w="6px"
        h="6px"
        borderRadius="full"
        bg={pupilColor}
        transform={`translate(calc(-50% + ${lookX}px), calc(-50% + ${lookY}px))`}
        transition={{ duration: 0.08 }}
      />
    </MotionBox>
  );
}

export default function AnimatedCharacters({ compact = false }: AnimatedCharactersProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    const tickBlink = () => {
      const delay = Math.random() * 3000 + 2200;
      const timer = window.setTimeout(() => {
        setBlink(true);
        window.setTimeout(() => setBlink(false), 140);
        tickBlink();
      }, delay);
      return timer;
    };
    const timer = tickBlink();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const target = stageRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const relativeX = (event.clientX - rect.left) / rect.width;
      const relativeY = (event.clientY - rect.top) / rect.height;
      const x = (relativeX - 0.5) * 2;
      const y = (relativeY - 0.5) * 2;
      setPointer({
        x: Math.max(-1, Math.min(1, x)),
        y: Math.max(-1, Math.min(1, y)),
      });
    };

    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const look = useMemo(
    () => ({
      x: Math.max(-6.8, Math.min(6.8, pointer.x * 6.8)),
      y: Math.max(-4.6, Math.min(4.6, pointer.y * 4.6)),
    }),
    [pointer]
  );

  const stageParallax = useMemo(
    () => ({
      x: Math.max(-14, Math.min(14, pointer.x * 14)),
      y: Math.max(-10, Math.min(10, pointer.y * 10)),
    }),
    [pointer]
  );

  const groupTransform = useMemo(
    () => ({
      x: stageParallax.x * 0.35,
      y: stageParallax.y * 0.25,
      rotate: pointer.x * 1.4,
    }),
    [stageParallax.x, stageParallax.y, pointer.x]
  );

  const stageHeight = compact ? "180px" : "100%";
  const stageRadius = compact ? "2xl" : "none";
  const colors = {
    orange: "#EB6100",
    green: "#149243",
    gray: "#CACAC7",
    dark: "#2A2D33",
  };

  return (
    <Box
      ref={stageRef}
      position="relative"
      w="100%"
      h={stageHeight}
      minH={compact ? "180px" : "460px"}
      maxW={compact ? "280px" : "none"}
      mx="auto"
      overflow={compact ? "hidden" : "visible"}
    >
      {compact && (
        <Box
          position="absolute"
          inset={0}
          borderRadius={stageRadius}
          bg="radial-gradient(circle at 52% 24%, rgba(255,255,255,0.16), transparent 44%), linear-gradient(180deg, rgba(15,18,26,0.98) 0%, rgba(9,12,19,1) 100%)"
        />
      )}
      <MotionBox
        position="absolute"
        inset={compact ? 0 : "auto 0 -4px 0"}
        h={compact ? "100%" : "520px"}
        style={groupTransform}
        transition={{ duration: 0.14, ease: "linear" }}
      >
        <MotionBox
          position="absolute"
          left={compact ? "10%" : "8%"}
          bottom={compact ? "-42px" : "-30px"}
          w={compact ? "45%" : "42%"}
          h={compact ? "64%" : "66%"}
          bg={colors.orange}
          borderTopRadius="999px"
          style={{ x: stageParallax.x * 0.34, y: stageParallax.y * 0.14 }}
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
        />
        <Eye x={compact ? 25 : 22} y={compact ? 46 : 41} lookX={look.x} lookY={look.y} blink={blink} />
        <Eye x={compact ? 36 : 30} y={compact ? 46 : 41} lookX={look.x} lookY={look.y} blink={blink} />

        <MotionBox
          position="absolute"
          left={compact ? "28%" : "24%"}
          bottom={compact ? "-16px" : "-4px"}
          w={compact ? "38%" : "36%"}
          h={compact ? "88%" : "82%"}
          bg={colors.green}
          borderTopRadius="26px"
          borderBottomRightRadius="12px"
          style={{ x: stageParallax.x * 0.58, y: stageParallax.y * 0.2 }}
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 5.1, repeat: Infinity, ease: "easeInOut" }}
        />
        <Eye x={compact ? 48 : 42} y={compact ? 34 : 30} lookX={look.x} lookY={look.y} blink={blink} />
        <Eye x={compact ? 58 : 52} y={compact ? 34 : 30} lookX={look.x} lookY={look.y} blink={blink} />

        <MotionBox
          position="absolute"
          left={compact ? "52%" : "50%"}
          bottom={compact ? "-26px" : "-16px"}
          w={compact ? "24%" : "23%"}
          h={compact ? "72%" : "70%"}
          bg={colors.dark}
          borderTopRadius="12px"
          borderBottomRightRadius="10px"
          style={{ x: stageParallax.x * 0.7, y: stageParallax.y * 0.24, rotate: pointer.x * 2.2 }}
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 4.7, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        />
        <Eye x={compact ? 66 : 61} y={compact ? 41 : 36} lookX={look.x} lookY={look.y} blink={blink} />
        <Eye x={compact ? 76 : 69} y={compact ? 41 : 36} lookX={look.x} lookY={look.y} blink={blink} />

        <MotionBox
          position="absolute"
          right={compact ? "8%" : "10%"}
          bottom={compact ? "-22px" : "-14px"}
          w={compact ? "32%" : "31%"}
          h={compact ? "64%" : "62%"}
          bg={colors.gray}
          borderTopRadius="999px"
          style={{ x: stageParallax.x * 0.85, y: stageParallax.y * 0.3 }}
          animate={{ y: [0, -7, 0] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut", delay: 0.35 }}
        />
        <Eye x={compact ? 80 : 75} y={compact ? 46 : 40} lookX={look.x} lookY={look.y} blink={blink} eyeColor={colors.dark} pupilColor={colors.dark} />
        <Eye x={compact ? 90 : 85} y={compact ? 46 : 40} lookX={look.x} lookY={look.y} blink={blink} eyeColor={colors.dark} pupilColor={colors.dark} />
        <Box
          position="absolute"
          right={compact ? "16%" : "17%"}
          bottom={compact ? "44px" : "80px"}
          w={compact ? "20%" : "17%"}
          h="4px"
          borderRadius="full"
          bg={colors.dark}
          opacity={0.9}
          transform={`translate(${stageParallax.x * 0.82}px, ${stageParallax.y * 0.28}px)`}
          transition="transform 80ms linear"
        />
      </MotionBox>
    </Box>
  );
}
