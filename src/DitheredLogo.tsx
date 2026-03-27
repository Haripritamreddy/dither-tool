import { useEffect, useRef } from "react";

type Dot = {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  active: boolean;
};

type PointerImpulse = {
  x: number;
  y: number;
  force: number;
};

type BurstState = {
  energy: number;
  seed: number;
};

const BASE_SIZE = 1000;
const GRID_STEP = 6;
const DOT_RADIUS = 0.95;
const TILE_PADDING = 92;
const TILE_RADIUS = 128;
const LOGO_SCALE = 0.72;
const LINEAR_PATH =
  "M2.25 14.3c-.04-.19.18-.31.32-.17l7.3 7.3c.14.14.02.36-.17.32c-3.68-.86-6.59-3.77-7.45-7.45m-.24-2.93q0 .09.06.15l10.41 10.41s.1.06.15.06c.47-.03.94-.09 1.39-.19c.15-.03.21-.22.1-.33L2.52 9.89a.194.194 0 0 0-.33.1c-.09.46-.16.92-.19 1.39Zm.84-3.44c-.03.07-.02.16.04.22L15.84 21.1c.06.06.15.07.22.04c.36-.16.7-.34 1.04-.54c.09-.06.12-.18.07-.27c0-.01-.02-.03-.04-.04L3.69 6.87a.193.193 0 0 0-.28 0c-.01.01-.02.02-.03.04c-.2.33-.38.68-.54 1.04ZM4.54 5.6a.19.19 0 0 1 0-.27a10 10 0 0 1 7.47-3.34c5.53 0 10.01 4.48 10.01 10.01c0 2.97-1.29 5.63-3.34 7.47c-.08.07-.2.07-.27 0L4.53 5.61Z";

function roundedRectContains(x: number, y: number, size: number) {
  const half = size / 2;
  const localX = Math.abs(x - half);
  const localY = Math.abs(y - half);
  const innerHalf = half - TILE_PADDING;
  const dx = Math.max(localX - (innerHalf - TILE_RADIUS), 0);
  const dy = Math.max(localY - (innerHalf - TILE_RADIUS), 0);
  return dx * dx + dy * dy <= TILE_RADIUS * TILE_RADIUS;
}

function clampToTile(dot: Dot) {
  if (roundedRectContains(dot.x, dot.y, BASE_SIZE)) {
    return;
  }

  let bestX = dot.baseX;
  let bestY = dot.baseY;

  for (let step = 0; step <= 1; step += 0.04) {
    const x = dot.x + (dot.baseX - dot.x) * step;
    const y = dot.y + (dot.baseY - dot.y) * step;
    if (roundedRectContains(x, y, BASE_SIZE)) {
      bestX = x;
      bestY = y;
      break;
    }
  }

  dot.x = bestX;
  dot.y = bestY;
  dot.vx *= 0.35;
  dot.vy *= 0.35;
}

function buildLogoDots(size: number) {
  const dots: Dot[] = [];
  const logoPath = new Path2D(LINEAR_PATH);
  const logoSize = size * LOGO_SCALE;
  const logoOffset = (size - logoSize) / 2;
  const logoScale = logoSize / 24;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = size;
  sampleCanvas.height = size;
  const sampleContext = sampleCanvas.getContext("2d");

  if (!sampleContext) {
    return dots;
  }

  sampleContext.setTransform(1, 0, 0, 1, 0, 0);
  sampleContext.clearRect(0, 0, size, size);
  sampleContext.translate(logoOffset, logoOffset);
  sampleContext.scale(logoScale, logoScale);
  sampleContext.fillStyle = "#000";
  sampleContext.fill(logoPath);
  sampleContext.setTransform(1, 0, 0, 1, 0, 0);
  const alphaMap = sampleContext.getImageData(0, 0, size, size).data;

  for (let y = GRID_STEP / 2; y < size; y += GRID_STEP) {
    for (let x = GRID_STEP / 2; x < size; x += GRID_STEP) {
      if (!roundedRectContains(x, y, size)) {
        continue;
      }

      const px = Math.round(x);
      const py = Math.round(y);
      const alphaIndex = (py * size + px) * 4 + 3;
      const isInLogoCutout = alphaMap[alphaIndex] > 90;
      if (isInLogoCutout) {
        continue;
      }

      dots.push({
        baseX: x,
        baseY: y,
        x,
        y,
        vx: 0,
        vy: 0,
        radius: DOT_RADIUS,
        active: true,
      });
    }
  }

  return dots;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function DitheredLogo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let dots = buildLogoDots(BASE_SIZE);
    let width = BASE_SIZE;
    let height = BASE_SIZE;
    let animationFrame = 0;
    let pointerImpulse: PointerImpulse | null = null;
    let isPressed = false;
    let isHovering = false;
    let burst: BurstState = { energy: 0, seed: 0 };
    let lastTime = performance.now();
    const tapTimes: number[] = [];

    const render = () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.roundRect(TILE_PADDING, TILE_PADDING, BASE_SIZE - TILE_PADDING * 2, BASE_SIZE - TILE_PADDING * 2, TILE_RADIUS);
      context.fill();

      context.save();
      context.beginPath();
      context.roundRect(TILE_PADDING, TILE_PADDING, BASE_SIZE - TILE_PADDING * 2, BASE_SIZE - TILE_PADDING * 2, TILE_RADIUS);
      context.clip();
      context.fillStyle = "#111111";

      for (const dot of dots) {
        if (!dot.active) {
          continue;
        }

        context.beginPath();
        context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
        context.fill();
      }

      context.restore();
    };

    const tick = (now: number) => {
      const delta = clamp((now - lastTime) / 16.6667, 0.5, 2.2);
      lastTime = now;

      burst.energy *= Math.pow(0.94, delta);
      if (burst.energy < 0.001) {
        burst.energy = 0;
      }

      for (let index = 0; index < dots.length; index += 1) {
        const dot = dots[index]!;
        const dx = dot.baseX - dot.x;
        const dy = dot.baseY - dot.y;
        dot.vx += dx * 0.07 * delta;
        dot.vy += dy * 0.07 * delta;

        if (!roundedRectContains(dot.x, dot.y, BASE_SIZE)) {
          dot.vx += dx * 0.12 * delta;
          dot.vy += dy * 0.12 * delta;
        }

        if (pointerImpulse) {
          const pdx = dot.x - pointerImpulse.x;
          const pdy = dot.y - pointerImpulse.y;
          const distance = Math.hypot(pdx, pdy) + 0.0001;
          const reach = isPressed ? 220 : isHovering ? 245 : 120;
          if (distance < reach) {
            const falloff = 1 - distance / reach;
            const impulse =
              pointerImpulse.force *
              falloff *
              (isPressed ? 2.1 : isHovering ? 3.3 : 2.2);
            dot.vx += (pdx / distance) * impulse * delta;
            dot.vy += (pdy / distance) * impulse * delta;
          }
        }

        if (burst.energy > 0) {
          const angle = Math.atan2(dot.baseY - BASE_SIZE / 2, dot.baseX - BASE_SIZE / 2);
          const noise = Math.sin(index * 12.9898 + burst.seed) * 43758.5453;
          const jitter = noise - Math.floor(noise) - 0.5;
          dot.vx += (Math.cos(angle) * 1.55 + jitter * 1.05) * burst.energy * delta;
          dot.vy += (Math.sin(angle) * 1.55 + jitter * 1.05) * burst.energy * delta;
        }

        dot.vx *= Math.pow(0.78, delta);
        dot.vy *= Math.pow(0.78, delta);
        dot.x += dot.vx * delta;
        dot.y += dot.vy * delta;
        clampToTile(dot);
      }

      pointerImpulse = null;
      render();
      animationFrame = window.requestAnimationFrame(tick);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      context.setTransform(width / BASE_SIZE, 0, 0, height / BASE_SIZE, 0, 0);
      dots = buildLogoDots(BASE_SIZE);
      render();
    };

    const toCanvasPoint = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * BASE_SIZE,
        y: ((clientY - rect.top) / rect.height) * BASE_SIZE,
      };
    };

    const triggerTap = (clientX: number, clientY: number, force: number) => {
      pointerImpulse = {
        ...toCanvasPoint(clientX, clientY),
        force,
      };

      const now = performance.now();
      tapTimes.push(now);
      while (tapTimes.length > 0 && now - tapTimes[0]! > 480) {
        tapTimes.shift();
      }

      if (tapTimes.length >= 4) {
        burst.energy = Math.min(6.4, burst.energy + 2.6);
        burst.seed = now * 0.001;
        tapTimes.length = 0;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      isPressed = true;
      isHovering = true;
      triggerTap(event.clientX, event.clientY, 1.8);
      canvas.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      isHovering = true;
      pointerImpulse = {
        ...toCanvasPoint(event.clientX, event.clientY),
        force: isPressed ? 0.62 : 0.48,
      };
    };

    const handlePointerUp = (event: PointerEvent) => {
      isPressed = false;
      triggerTap(event.clientX, event.clientY, 0.95);
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    const handlePointerLeave = () => {
      isPressed = false;
      isHovering = false;
      pointerImpulse = null;
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("pointercancel", handlePointerLeave);
    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("pointercancel", handlePointerLeave);
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <div className="DitheredLogo_wrapper__xvRcN flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className="DitheredLogo_canvas__spFS8 block h-[min(56vw,24rem)] w-[min(56vw,24rem)] touch-manipulation select-none"
        width={BASE_SIZE}
        height={BASE_SIZE}
        data-ready=""
        aria-label="Interactive dithered logo"
      />
    </div>
  );
}

export default DitheredLogo;
