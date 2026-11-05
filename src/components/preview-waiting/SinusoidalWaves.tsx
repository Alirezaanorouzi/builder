"use client";

import { useEffect, useRef, type RefObject } from "react";
import styles from "./preview-waiting.module.css";

const VIEW_W = 800;
const VIEW_H = 220;

function sinePath(
  width: number,
  midY: number,
  amplitude: number,
  wavelength: number,
  phase: number
): string {
  const step = 5;
  let d = "";
  for (let x = 0; x <= width; x += step) {
    const y = midY + amplitude * Math.sin((x / wavelength) * Math.PI * 2 + phase);
    d += x === 0 ? `M ${x} ${y.toFixed(2)}` : ` L ${x} ${y.toFixed(2)}`;
  }
  return d;
}

type WaveLayer = {
  ref: RefObject<SVGPathElement | null>;
  midY: number;
  amplitude: number;
  wavelength: number;
  speed: number;
  offset: number;
};

export function SinusoidalWaves() {
  const waveA = useRef<SVGPathElement>(null);
  const waveB = useRef<SVGPathElement>(null);
  const waveC = useRef<SVGPathElement>(null);

  useEffect(() => {
    const layers: WaveLayer[] = [
      { ref: waveA, midY: 98, amplitude: 26, wavelength: 128, speed: 1.15, offset: 0 },
      { ref: waveB, midY: 112, amplitude: 16, wavelength: 96, speed: 0.82, offset: 1.4 },
      { ref: waveC, midY: 86, amplitude: 10, wavelength: 72, speed: 1.45, offset: 2.8 },
    ];

    let raf = 0;
    const t0 = performance.now();

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      for (const layer of layers) {
        const phase = t * layer.speed + layer.offset;
        layer.ref.current?.setAttribute(
          "d",
          sinePath(VIEW_W, layer.midY, layer.amplitude, layer.wavelength, phase)
        );
      }
      raf = requestAnimationFrame(tick);
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      for (const layer of layers) {
        layer.ref.current?.setAttribute(
          "d",
          sinePath(VIEW_W, layer.midY, layer.amplitude * 0.35, layer.wavelength, layer.offset)
        );
      }
      return;
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      className={styles.waves}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path ref={waveC} className={styles.waveSoft} fill="none" />
      <path ref={waveB} className={styles.waveMid} fill="none" />
      <path ref={waveA} className={styles.waveBright} fill="none" />
    </svg>
  );
}
