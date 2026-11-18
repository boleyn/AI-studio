import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import Bore from "../../../public/icon/logo.svg";
import styles from "./BoreCompanion.module.css";

const replies = [
  "点一点伯仁，激活星环能量",
  "能量充能中 · 星环加速",
  "核心共振！再点一次起飞",
  "超频推进！星际跃迁 🚀",
];
const flightDuration = 3600;
const floatLabels = ["", "+1 ⚡", "COMBO ×2 🔥", "OVERDRIVE 🚀"];

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  color: string;
  gravity: number;
  trail?: boolean;
  star?: boolean;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
  lineWidth: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  phase: number;
  color: string;
}

const PALETTE = ["#7c6ee6", "#f59e0b", "#ec4899", "#06b6d4", "#a855f7", "#fbbf24"];

export default function BoreCompanion() {
  const [taps, setTaps] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const podRef = useRef<HTMLDivElement>(null);

  const animRef = useRef({
    particles: [] as Particle[],
    waves: [] as Shockwave[],
    stars: [] as Star[],
    mouseX: -9999,
    mouseY: -9999,
    charge: 0,
    launching: false,
    reducedMotion: false,
  });

  const landed = taps === 4;
  const charge = Math.min(taps, 3);

  useEffect(() => {
    animRef.current.charge = charge;
    animRef.current.launching = taps === 3;
  }, [charge, taps]);

  useEffect(() => {
    if (taps !== 3) return;
    const timer = window.setTimeout(() => setTaps(4), flightDuration);
    return () => window.clearTimeout(timer);
  }, [taps]);

  const getPodCenter = () => {
    const canvas = canvasRef.current;
    const pod = podRef.current;
    if (!canvas || !pod) return null;
    const rect = canvas.getBoundingClientRect();
    const podRect = pod.getBoundingClientRect();
    return {
      cx: podRect.left - rect.left + podRect.width / 2,
      cy: podRect.top - rect.top + podRect.height / 2,
      width: podRect.width,
    };
  };

  // Spawn burst particles & shockwaves with optional vertical offset (for high-altitude fireworks)
  const spawnBurst = (
    count: number,
    speedScale: number,
    colors: string[],
    offsetY = 0,
    withStars = false
  ) => {
    if (animRef.current.reducedMotion) return;
    const center = getPodCenter();
    if (!center) return;

    const { cx, cy, width } = center;
    const targetY = cy + offsetY;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.25;
      const speed = (3 + Math.random() * 7.5) * speedScale;
      const isStar = withStars && i % 4 === 0;
      animRef.current.particles.push({
        x: cx,
        y: targetY,
        px: cx,
        py: targetY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (withStars ? 1.5 : 0.8),
        size: isStar ? 4.5 + Math.random() * 3.5 : 2.5 + Math.random() * 4,
        alpha: 1,
        decay: withStars ? 0.008 + Math.random() * 0.01 : 0.014 + Math.random() * 0.015,
        color: colors[i % colors.length],
        gravity: withStars ? 0.11 : 0.08,
        trail: true,
        star: isStar,
      });
    }

    animRef.current.waves.push({
      x: cx,
      y: targetY,
      radius: width * 0.18,
      maxRadius: width * (withStars ? 1.85 : 1.05),
      alpha: 0.92,
      color: colors[0],
      lineWidth: withStars ? 4 : 3,
    });

    if (withStars) {
      animRef.current.waves.push({
        x: cx,
        y: targetY,
        radius: width * 0.1,
        maxRadius: width * 1.35,
        alpha: 0.85,
        color: colors[1] || colors[0],
        lineWidth: 2.5,
      });
    }
  };

  // High-altitude launch fireworks sequence when taps === 3
  useEffect(() => {
    if (taps !== 3 || animRef.current.reducedMotion) return;
    const isMobile = window.innerWidth <= 720;
    const liftPx = isMobile ? 68 : Math.min(window.innerHeight * 0.28, 220);

    // 1. Ground ignition blast
    spawnBurst(36, 1.15, ["#f59e0b", "#fbbf24", "#ec4899"], 24, false);

    // 2. Peak altitude main fireworks explosion
    const t1 = window.setTimeout(() => {
      spawnBurst(96, 1.75, ["#fbbf24", "#ec4899", "#38bdf8", "#a855f7", "#34d399"], -liftPx, true);
    }, 1150);

    // 3. Secondary high-altitude shimmer burst
    const t2 = window.setTimeout(() => {
      spawnBurst(54, 1.35, ["#7c6ee6", "#38bdf8", "#fbbf24", "#f472b6"], -liftPx * 0.82, true);
    }, 1650);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [taps]);

  // Canvas 60fps ambient stars + pointer trail + burst particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    animRef.current.reducedMotion = mq.matches;

    let width = 0;
    let height = 0;
    let rafId = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (animRef.current.stars.length === 0) {
        animRef.current.stars = Array.from({ length: 48 }, (_, i) => ({
          x: Math.random() * width,
          y: Math.random() * height,
          r: 1.2 + (i % 3) * 0.9,
          vx: (Math.random() - 0.5) * 0.25,
          vy: -0.14 - Math.random() * 0.22,
          phase: Math.random() * Math.PI * 2,
          color: PALETTE[i % PALETTE.length],
        }));
      }
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const state = animRef.current;

      // 1. Ambient floating stars + constellation links near cursor
      for (let i = 0; i < state.stars.length; i++) {
        const s = state.stars[i];
        if (!state.reducedMotion) {
          s.x += s.vx * (1 + state.charge * 0.4);
          s.y += s.vy * (1 + state.charge * 0.4);
          s.phase += 0.03;
          if (s.y < -10) s.y = height + 10;
          if (s.x < -10) s.x = width + 10;
          if (s.x > width + 10) s.x = -10;
        }

        const twinkle = 0.35 + Math.sin(s.phase) * 0.25;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.globalAlpha = twinkle;
        ctx.fill();

        const dx = state.mouseX - s.x;
        const dy = state.mouseY - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 130) {
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(state.mouseX, state.mouseY);
          ctx.strokeStyle = s.color;
          ctx.globalAlpha = (1 - dist / 130) * 0.26;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // 2. Shockwaves
      for (let i = state.waves.length - 1; i >= 0; i--) {
        const w = state.waves[i];
        w.radius += (w.maxRadius - w.radius) * 0.11;
        w.alpha *= 0.93;
        if (w.alpha < 0.02) {
          state.waves.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
        ctx.strokeStyle = w.color;
        ctx.globalAlpha = w.alpha;
        ctx.lineWidth = w.lineWidth;
        ctx.stroke();
      }

      // 3. Burst particles with glowing trails and 4-point star sparkles
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.px = p.x;
        p.py = p.y;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.985;
        p.alpha -= p.decay;

        if (p.alpha <= 0) {
          state.particles.splice(i, 1);
          continue;
        }

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;

        if (p.trail) {
          ctx.beginPath();
          ctx.moveTo(p.px, p.py);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1.2, p.size * p.alpha * 0.7);
          ctx.lineCap = "round";
          ctx.stroke();
        }

        if (p.star) {
          const r = p.size * (0.6 + p.alpha * 0.6);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - r * 1.6);
          ctx.lineTo(p.x + r * 0.45, p.y - r * 0.45);
          ctx.lineTo(p.x + r * 1.6, p.y);
          ctx.lineTo(p.x + r * 0.45, p.y + r * 0.45);
          ctx.lineTo(p.x, p.y + r * 1.6);
          ctx.lineTo(p.x - r * 0.45, p.y + r * 0.45);
          ctx.lineTo(p.x - r * 1.6, p.y);
          ctx.lineTo(p.x - r * 0.45, p.y - r * 0.45);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.8, p.size * p.alpha), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
      if (!state.reducedMotion) {
        rafId = window.requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    const stage = event.currentTarget;
    const bounds = stage.getBoundingClientRect();
    const rx = event.clientX - bounds.left;
    const ry = event.clientY - bounds.top;
    const nx = rx / bounds.width - 0.5;
    const ny = ry / bounds.height - 0.5;

    stage.style.setProperty("--gaze-x", (nx * 14).toFixed(2) + "px");
    stage.style.setProperty("--gaze-y", (ny * 12).toFixed(2) + "px");
    stage.style.setProperty("--parallax-x", (nx * -20).toFixed(2) + "px");
    stage.style.setProperty("--parallax-y", (ny * -16).toFixed(2) + "px");

    animRef.current.mouseX = rx;
    animRef.current.mouseY = ry;

    if (!animRef.current.reducedMotion && Math.random() > 0.6) {
      animRef.current.particles.push({
        x: rx + (Math.random() - 0.5) * 6,
        y: ry + (Math.random() - 0.5) * 6,
        px: rx,
        py: ry,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8 - 0.25,
        size: 1.8 + Math.random() * 2,
        alpha: 0.7,
        decay: 0.025,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        gravity: 0.01,
      });
    }
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    const s = event.currentTarget.style;
    s.removeProperty("--gaze-x");
    s.removeProperty("--gaze-y");
    s.removeProperty("--parallax-x");
    s.removeProperty("--parallax-y");
    animRef.current.mouseX = -9999;
    animRef.current.mouseY = -9999;
  };

  const handleTap = () => {
    if (taps === 3) return;
    const next = taps === 4 ? 1 : Math.min(taps + 1, 3);
    setPulseKey(k => k + 1);
    setTaps(next);
    if (next < 3) {
      spawnBurst(
        28 + next * 10,
        0.95 + next * 0.2,
        next === 1 ? ["#7c6ee6", "#38bdf8", "#a855f7"] : ["#f59e0b", "#ec4899", "#fbbf24"],
        0,
        false
      );
    }
  };

  return (
    <div
      ref={stageRef}
      style={{ "--flight-duration": flightDuration + "ms" } as CSSProperties}
      className={styles.stage}
      data-charge={charge}
      data-landed={landed ? "true" : undefined}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className={styles.sky} aria-hidden="true">
        <span className={styles.auroraOne} />
        <span className={styles.auroraTwo} />
        <span className={styles.auroraThree} />
      </div>

      <canvas ref={canvasRef} className={styles.fxCanvas} aria-hidden="true" />

      <div ref={podRef} className={styles.pod}>
        <div className={styles.orbitOuter} aria-hidden="true" />
        <div className={styles.orbitInner} aria-hidden="true" />
        <div className={styles.coreGlow} aria-hidden="true" />
        <div className={styles.pad} aria-hidden="true" />

        {pulseKey > 0 && taps > 0 && taps <= 3 && (
          <span key={"pop-" + pulseKey} className={styles.floater} aria-hidden="true">
            {floatLabels[taps]}
          </span>
        )}

        <button
          type="button"
          className={styles.robot}
          aria-label={landed ? "再次点击给伯仁充能" : "给伯仁充能"}
          aria-disabled={taps === 3}
          onClick={handleTap}
        >
          <span
            key={taps}
            className={
              taps === 3
                ? styles.launch
                : taps && !landed
                  ? styles.hop
                  : landed
                    ? styles.landed
                    : undefined
            }
          >
            {taps === 3 && <i className={styles.exhaust} aria-hidden="true" />}
            <Bore className={styles.figure} aria-hidden="true" />
          </span>
        </button>
      </div>

      <div className={styles.status}>
        <span className={styles.meter} aria-hidden="true">
          {[1, 2, 3].map(level => (
            <i key={level} data-lit={level <= charge} />
          ))}
        </span>
        <span role="status">
          {landed ? "平稳着陆 ✨ 点击继续充能" : replies[charge]}
        </span>
      </div>
    </div>
  );
}
