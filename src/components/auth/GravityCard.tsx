import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

const GravityCard = ({ children, tiltIntensity = 15, floatIntensity = 15 }: {
  children: React.ReactNode;
  tiltIntensity?: number;
  floatIntensity?: number;
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const mouseX = useSpring(x, { stiffness: 150, damping: 15 });
  const mouseY = useSpring(y, { stiffness: 150, damping: 15 });
  const rotateX = useTransform(mouseY, [-1, 1], [tiltIntensity, -tiltIntensity]);
  const rotateY = useTransform(mouseX, [-1, 1], [-tiltIntensity, tiltIntensity]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const yPct = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <div
      style={{
        perspective: 1000,
        transformStyle: "preserve-3d",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <motion.div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ width: "100%", height: "100%", transformStyle: "preserve-3d", rotateX, rotateY }}
        animate={{ y: [0, -floatIntensity, 0] }}
        transition={{ y: { duration: 6, repeat: Infinity, ease: "easeInOut" } }}
      >
        {children}
      </motion.div>
    </div>
  );
};

export default GravityCard;
