import { useEffect, useLayoutEffect, useRef, useState } from "react";

type ToolSettings = {
  threshold: number;
  invert: boolean;
  scale: number;
  contrast: number;
  gamma: number;
  highlightsCompression: number;
  blurRadius: number;
  errorStrength: number;
  serpentine: boolean;
  cornerRadius: number;
  renderScale: number;
};

type DotPoint = {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  vx: number;
  vy: number;
};

type Ripple = {
  x: number;
  y: number;
  age: number;
  strength: number;
  speed: number;
  width: number;
};

const SOURCE_SIZE = 1024;
const STAGE_WIDTH = 1365;
const STAGE_HEIGHT = 1040;

const DEFAULT_SETTINGS: ToolSettings = {
  threshold: 101,
  invert: false,
  scale: 20,
  contrast: 0,
  gamma: 1.03,
  highlightsCompression: 0,
  blurRadius: 0,
  errorStrength: 100,
  serpentine: true,
  cornerRadius: 20,
  renderScale: 0.49,
};

const LINEAR_PATH =
  "M2.25 14.3c-.04-.19.18-.31.32-.17l7.3 7.3c.14.14.02.36-.17.32c-3.68-.86-6.59-3.77-7.45-7.45m-.24-2.93q0 .09.06.15l10.41 10.41s.1.06.15.06c.47-.03.94-.09 1.39-.19c.15-.03.21-.22.1-.33L2.52 9.89a.194.194 0 0 0-.33.1c-.09.46-.16.92-.19 1.39Zm.84-3.44c-.03.07-.02.16.04.22L15.84 21.1c.06.06.15.07.22.04c.36-.16.7-.34 1.04-.54c.09-.06.12-.18.07-.27c0-.01-.02-.03-.04-.04L3.69 6.87a.193.193 0 0 0-.28 0c-.01.01-.02.02-.03.04c-.2.33-.38.68-.54 1.04ZM4.54 5.6a.19.19 0 0 1 0-.27a10 10 0 0 1 7.47-3.34c5.53 0 10.01 4.48 10.01 10.01c0 2.97-1.29 5.63-3.34 7.47c-.08.07-.2.07-.27 0L4.53 5.61Z";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createOffscreenCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function buildDefaultSource(cornerRadius: number) {
  const canvas = createOffscreenCanvas(SOURCE_SIZE, SOURCE_SIZE);
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);

  const inset = 240;
  const size = SOURCE_SIZE - inset * 2;
  context.fillStyle = "#050505";
  context.beginPath();
  context.roundRect(inset, inset, size, size, cornerRadius * 10);
  context.fill();

  const cx = SOURCE_SIZE * 0.54;
  const cy = SOURCE_SIZE * 0.47;
  const radius = SOURCE_SIZE * 0.22;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#050505";
  context.lineCap = "round";
  context.lineWidth = 34;
  for (const offset of [-110, -35, 40]) {
    context.beginPath();
    context.moveTo(cx - radius * 1.05, cy + offset - radius * 0.55);
    context.lineTo(cx + radius * 0.1, cy + offset + radius * 0.7);
    context.stroke();
  }

  const logoSize = SOURCE_SIZE * 0.34;
  const logoOffset = SOURCE_SIZE * 0.59;
  const path = new Path2D(LINEAR_PATH);
  context.save();
  context.translate(logoOffset, logoOffset);
  context.scale(logoSize / 24, logoSize / 24);
  context.fillStyle = "#ffffff";
  context.fill(path);
  context.restore();

  return canvas;
}

function drawSourceImage(image: HTMLImageElement, cornerRadius: number) {
  const canvas = createOffscreenCanvas(SOURCE_SIZE, SOURCE_SIZE);
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);

  const inset = 112;
  const drawSize = SOURCE_SIZE - inset * 2;
  context.save();
  context.beginPath();
  context.roundRect(inset, inset, drawSize, drawSize, cornerRadius * 10);
  context.clip();

  const scale = Math.min(drawSize / image.naturalWidth, drawSize / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = inset + (drawSize - width) / 2;
  const y = inset + (drawSize - height) / 2;
  context.drawImage(image, x, y, width, height);
  context.restore();

  return canvas;
}

function boxBlur(values: Float32Array, width: number, height: number, radius: number) {
  if (radius <= 0) {
    return values;
  }

  const output = new Float32Array(values.length);
  const size = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          sum += values[ny * width + nx]!;
          count += 1;
        }
      }
      output[y * width + x] = count > 0 ? sum / count : 0;
    }
  }

  return size > 0 ? output : values;
}

function processSource(source: HTMLCanvasElement, settings: ToolSettings) {
  const sampleSize = clamp(Math.round(SOURCE_SIZE * (settings.scale / 100)), 32, SOURCE_SIZE);
  const canvas = createOffscreenCanvas(sampleSize, sampleSize);
  const context = canvas.getContext("2d");
  if (!context) {
    return {
      sampleSize,
      pixels: new Uint8Array(),
      dots: [] as DotPoint[],
      preview: canvas,
    };
  }

  context.drawImage(source, 0, 0, sampleSize, sampleSize);
  const imageData = context.getImageData(0, 0, sampleSize, sampleSize);
  const grayscale = new Float32Array(sampleSize * sampleSize);

  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4;
    const r = imageData.data[offset]!;
    const g = imageData.data[offset + 1]!;
    const b = imageData.data[offset + 2]!;
    let luminance = r * 0.299 + g * 0.587 + b * 0.114;
    luminance = ((luminance - 128) * (1 + settings.contrast / 100)) + 128;
    luminance = clamp(luminance, 0, 255);
    luminance = 255 * Math.pow(luminance / 255, settings.gamma);
    luminance = 255 - (255 - luminance) * (1 - settings.highlightsCompression / 100);
    grayscale[index] = clamp(luminance, 0, 255);
  }

  const blurred = boxBlur(grayscale, sampleSize, sampleSize, Math.round(settings.blurRadius));
  const working = new Float32Array(blurred);
  const pixels = new Uint8Array(sampleSize * sampleSize);
  const errorFactor = settings.errorStrength / 100;

  for (let y = 0; y < sampleSize; y += 1) {
    const serpentineRow = settings.serpentine && y % 2 === 1;
    const start = serpentineRow ? sampleSize - 1 : 0;
    const end = serpentineRow ? -1 : sampleSize;
    const step = serpentineRow ? -1 : 1;

    for (let x = start; x !== end; x += step) {
      const index = y * sampleSize + x;
      const oldValue = working[index]!;
      const threshold = settings.invert ? 255 - settings.threshold : settings.threshold;
      const nextValue = oldValue < threshold ? 0 : 255;
      pixels[index] = nextValue === 0 ? 1 : 0;

      if (oldValue === nextValue) {
        continue;
      }

      const error = (oldValue - nextValue) * errorFactor;
      const neighbors = serpentineRow
        ? [
            [-1, 0, 7 / 16],
            [1, 1, 3 / 16],
            [0, 1, 5 / 16],
            [-1, 1, 1 / 16],
          ]
        : [
            [1, 0, 7 / 16],
            [-1, 1, 3 / 16],
            [0, 1, 5 / 16],
            [1, 1, 1 / 16],
          ];

      for (const [ox, oy, weight] of neighbors) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= sampleSize || ny >= sampleSize) {
          continue;
        }
        const neighborIndex = ny * sampleSize + nx;
        working[neighborIndex] = clamp(working[neighborIndex]! + error * weight, 0, 255);
      }
    }
  }

  const preview = createOffscreenCanvas(sampleSize, sampleSize);
  const previewContext = preview.getContext("2d");
  const dots: DotPoint[] = [];
  if (previewContext) {
    const previewData = previewContext.createImageData(sampleSize, sampleSize);
    for (let y = 0; y < sampleSize; y += 1) {
      for (let x = 0; x < sampleSize; x += 1) {
        const index = y * sampleSize + x;
        const offset = index * 4;
        const isDot = pixels[index] === 1;
        const value = isDot ? 12 : 255;
        previewData.data[offset] = value;
        previewData.data[offset + 1] = value;
        previewData.data[offset + 2] = value;
        previewData.data[offset + 3] = 255;

        if (isDot) {
          dots.push({
            x,
            y,
            baseX: x,
            baseY: y,
            vx: 0,
            vy: 0,
          });
        }
      }
    }
    previewContext.putImageData(previewData, 0, 0);
  }

  return { sampleSize, pixels, dots, preview };
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-[12px] text-neutral-400">
        <span>{label}</span>
        <span>{`${value}${suffix}`}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="w-full accent-indigo-500"
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/6 bg-[#151518] p-2.5 shadow-[0_0_0_1px_rgba(255,255,255,0.01)]">
      <h2 className="mb-2 text-[13px] font-semibold text-neutral-200">{title}</h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function DitherTool() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceLabel, setSourceLabel] = useState("1024x1024");
  const [sourceMeta, setSourceMeta] = useState("Default demo source");
  const [dotState, setDotState] = useState<{ sampleSize: number; dots: DotPoint[]; preview: HTMLCanvasElement | null }>({
    sampleSize: 205,
    dots: [],
    preview: null,
  });
  const [status, setStatus] = useState("Ready");
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<DotPoint[]>([]);
  const pointerRef = useRef<{ x: number; y: number; down: boolean } | null>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const [stageScale, setStageScale] = useState(1);

  useEffect(() => {
    const source = sourceImage ? drawSourceImage(sourceImage, settings.cornerRadius) : buildDefaultSource(settings.cornerRadius);
    const next = processSource(source, settings);
    dotsRef.current = next.dots.map(dot => ({ ...dot }));
    setDotState({
      sampleSize: next.sampleSize,
      dots: next.dots,
      preview: next.preview,
    });
  }, [settings, sourceImage]);

  useEffect(() => {
    const previewCanvas = previewCanvasRef.current;
    if (!previewCanvas || !dotState.preview) {
      return;
    }

    const context = previewCanvas.getContext("2d");
    if (!context) {
      return;
    }

    previewCanvas.width = dotState.preview.width;
    previewCanvas.height = dotState.preview.height;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.drawImage(dotState.preview, 0, 0);
  }, [dotState]);

  useLayoutEffect(() => {
    const host = stageHostRef.current;
    if (!host) {
      return;
    }

    const updateScale = () => {
      const rect = host.getBoundingClientRect();
      const nextScale = Math.min(rect.width / STAGE_WIDTH, rect.height / STAGE_HEIGHT, 1);
      setStageScale(nextScale);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(host);
    window.addEventListener("resize", updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  useEffect(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let animationFrame = 0;
    let width = 500;
    let height = 500;
    let lastTime = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
    };

    const render = (now: number) => {
      const delta = clamp((now - lastTime) / 16.6667, 0.5, 2);
      lastTime = now;

      const dots = dotsRef.current;
      const ripples = ripplesRef.current;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);

      const scale = (Math.min(width, height) / Math.max(dotState.sampleSize, 1)) * settings.renderScale;
      const offsetX = (width - dotState.sampleSize * scale) / 2;
      const offsetY = (height - dotState.sampleSize * scale) / 2;
      const dotRadius = Math.max(0.6, scale * 0.24);

      context.fillStyle = "#0b0b0c";

      for (const ripple of ripples) {
        ripple.age += delta;
      }
      ripplesRef.current = ripples.filter(ripple => ripple.age < 72);

      for (const dot of dots) {
        const dx = dot.baseX - dot.x;
        const dy = dot.baseY - dot.y;
        dot.vx += dx * 0.08 * delta;
        dot.vy += dy * 0.08 * delta;

        const pointer = pointerRef.current;
        if (pointer) {
          const px = (pointer.x - offsetX) / scale;
          const py = (pointer.y - offsetY) / scale;
          const ddx = dot.x - px;
          const ddy = dot.y - py;
          const distance = Math.hypot(ddx, ddy) + 0.0001;
          const radius = pointer.down ? 28 : 24;
          if (distance < radius) {
            const strength = pointer.down ? 3.1 : 2.0;
            const falloff = Math.pow(1 - distance / radius, 3);
            dot.vx += (ddx / distance) * strength * falloff * delta;
            dot.vy += (ddy / distance) * strength * falloff * delta;
          }
        }

        for (const ripple of ripplesRef.current) {
          const waveRadius = ripple.age * ripple.speed;
          const band = ripple.width;
          const ddx = dot.x - ripple.x;
          const ddy = dot.y - ripple.y;
          const distance = Math.hypot(ddx, ddy) + 0.0001;
          const edge = Math.abs(distance - waveRadius);
          if (edge < band) {
            const falloff = Math.pow(1 - edge / band, 3);
            const envelope = Math.exp(-ripple.age * 0.018);
            dot.vx += (ddx / distance) * ripple.strength * falloff * envelope * delta;
            dot.vy += (ddy / distance) * ripple.strength * falloff * envelope * delta;
          }
        }

        dot.vx *= Math.pow(0.88, delta);
        dot.vy *= Math.pow(0.88, delta);
        dot.x += dot.vx * delta;
        dot.y += dot.vy * delta;

        context.beginPath();
        context.arc(offsetX + dot.x * scale, offsetY + dot.y * scale, dotRadius, 0, Math.PI * 2);
        context.fill();
      }

      animationFrame = window.requestAnimationFrame(render);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: (event.clientX - rect.left) * (width / rect.width),
        y: (event.clientY - rect.top) * (height / rect.height),
        down: pointerRef.current?.down ?? false,
      };
    };

    const spawnRipple = (strength: number) => {
      if (!pointerRef.current) {
        return;
      }

      ripplesRef.current.push({
        x: (pointerRef.current.x - (width - dotState.sampleSize * ((Math.min(width, height) / Math.max(dotState.sampleSize, 1)) * settings.renderScale)) / 2) /
          ((Math.min(width, height) / Math.max(dotState.sampleSize, 1)) * settings.renderScale),
        y: (pointerRef.current.y - (height - dotState.sampleSize * ((Math.min(width, height) / Math.max(dotState.sampleSize, 1)) * settings.renderScale)) / 2) /
          ((Math.min(width, height) / Math.max(dotState.sampleSize, 1)) * settings.renderScale),
        age: 0,
        strength,
        speed: 2.05,
        width: 14,
      });

      if (ripplesRef.current.length > 10) {
        ripplesRef.current.shift();
      }
    };

    const handlePointerDown = () => {
      if (pointerRef.current) {
        pointerRef.current.down = true;
        spawnRipple(1.45);
      }
    };

    const handlePointerUp = () => {
      if (pointerRef.current) {
        pointerRef.current.down = false;
        spawnRipple(0.95);
      }
    };

    const handlePointerLeave = () => {
      pointerRef.current = null;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [dotState.sampleSize, settings.renderScale]);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      setSourceImage(image);
      setSourceLabel(file.name);
      setSourceMeta(`${image.naturalWidth}x${image.naturalHeight} • ${file.type || "image"}`);
      setStatus(`Loaded ${file.name}`);
      URL.revokeObjectURL(objectUrl);
      event.target.value = "";
    };
    image.onerror = () => {
      setStatus(`Could not load ${file.name}`);
      URL.revokeObjectURL(objectUrl);
      event.target.value = "";
    };
    image.src = objectUrl;
  };

  const exportPayload = {
    width: dotState.sampleSize,
    height: dotState.sampleSize,
    dots: dotState.dots.map(dot => ({ x: dot.baseX, y: dot.baseY })),
    settings,
  };

  const handleExportJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
    setStatus("Copied JSON to clipboard");
  };

  const handleCopyJs = async () => {
    const code = `export const dots = ${JSON.stringify(
      dotState.dots.map(dot => [dot.baseX, dot.baseY]),
      null,
      2,
    )};`;
    await navigator.clipboard.writeText(code);
    setStatus("Copied JS code to clipboard");
  };

  const setValue = <K extends keyof ToolSettings>(key: K, value: ToolSettings[K]) => {
    setSettings(current => ({ ...current, [key]: value }));
  };

  return (
    <main className="h-screen overflow-hidden bg-[#070708] px-3 py-3 text-white md:px-4 md:py-4">
      <div ref={stageHostRef} className="flex h-full items-center justify-center overflow-hidden">
        <div
          className="grid gap-4 lg:grid-cols-[260px_1fr]"
          style={{
            width: `${STAGE_WIDTH}px`,
            height: `${STAGE_HEIGHT}px`,
            transform: `scale(${stageScale})`,
            transformOrigin: "center center",
          }}
        >
        <aside className="space-y-2.5 pr-1">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-100">Dither Tool</h1>
          </div>

          <label className="flex h-12 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#111114] text-sm text-neutral-500">
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            {sourceLabel}
          </label>
          <div className="px-1 text-center text-xs text-neutral-600">{sourceMeta}</div>

          <Section title="Algorithm">
            <div className="text-sm font-medium text-indigo-400">Floyd-Steinberg</div>
            <Slider label="Luminance Threshold" value={settings.threshold} min={0} max={255} step={1} onChange={value => setValue("threshold", value)} />
            <label className="flex items-center gap-2 text-[13px] text-neutral-300">
              <input type="checkbox" checked={settings.invert} onChange={event => setValue("invert", event.target.checked)} className="size-4 accent-indigo-500" />
              Invert
            </label>
          </Section>

          <Section title="Main Settings">
            <Slider label="Scale" value={settings.scale} min={5} max={100} step={1} suffix="%" onChange={value => setValue("scale", value)} />
            <Slider label="Contrast" value={settings.contrast} min={-100} max={100} step={1} onChange={value => setValue("contrast", value)} />
            <Slider label="Midtones (Gamma)" value={settings.gamma} min={0.4} max={2} step={0.01} onChange={value => setValue("gamma", value)} />
            <Slider label="Highlights Compression" value={settings.highlightsCompression} min={0} max={100} step={1} onChange={value => setValue("highlightsCompression", value)} />
            <Slider label="Blur Radius" value={settings.blurRadius} min={0} max={8} step={1} suffix="px" onChange={value => setValue("blurRadius", value)} />
            <p className="text-[11px] leading-4 text-neutral-500">
              Tone curve is applied before dithering. Blur reduces high-frequency noise.
            </p>
          </Section>

          <Section title={`Error Strength: ${settings.errorStrength}%`}>
            <Slider label="" value={settings.errorStrength} min={0} max={150} step={1} suffix="%" onChange={value => setValue("errorStrength", value)} />
            <p className="text-[11px] leading-4 text-neutral-500">
              0% means no diffusion, 100% is standard, 150% is exaggerated.
            </p>
            <label className="flex items-center gap-2 text-[13px] text-neutral-300">
              <input type="checkbox" checked={settings.serpentine} onChange={event => setValue("serpentine", event.target.checked)} className="size-4 accent-indigo-500" />
              Serpentine
            </label>
          </Section>

          <Section title="Shape">
            <Slider label="Corner Radius" value={settings.cornerRadius} min={0} max={40} step={1} suffix="%" onChange={value => setValue("cornerRadius", value)} />
          </Section>

          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={handleExportJson} className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-400">
              Export JSON
            </button>
            <button onClick={handleCopyJs} className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-400">
              Copy JS Code
            </button>
          </div>

          <div className="text-center text-xs text-neutral-500">
            {`${dotState.dots.length} dots at ${dotState.sampleSize}x${dotState.sampleSize}`}
          </div>
        </aside>

        <section className="grid h-full grid-rows-[1fr_auto_auto] gap-3 rounded-[28px] bg-[#060607] p-3 md:p-4">
          <div className="grid items-center gap-5 xl:grid-cols-[140px_1fr]">
            <div className="justify-self-center">
              <div className="mb-2 text-center text-xs uppercase tracking-[0.2em] text-neutral-600">Dither Output</div>
              <div className="rounded-[20px] bg-[#0b0b0d] p-2.5">
                <canvas ref={previewCanvasRef} className="h-28 w-28 bg-[#0b0b0d] [image-rendering:pixelated]" />
              </div>
            </div>

            <div className="justify-self-center">
              <div className="mb-2 text-center text-xs uppercase tracking-[0.2em] text-neutral-600">
                {`Live Render (${Math.round(dotState.sampleSize * settings.renderScale)}x${Math.round(dotState.sampleSize * settings.renderScale)})`}
              </div>
              <canvas ref={liveCanvasRef} className="aspect-square w-full max-w-[410px] rounded-[6px] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.02)]" />
            </div>
          </div>

          <div className="mx-auto w-full max-w-[260px]">
            <Slider label="Render Scale" value={settings.renderScale} min={0.2} max={1.2} step={0.01} onChange={value => setValue("renderScale", value)} />
          </div>

          <div className="text-sm text-neutral-500">{status}</div>
        </section>
        </div>
      </div>
    </main>
  );
}

export default DitherTool;
