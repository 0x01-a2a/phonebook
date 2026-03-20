'use client';

import { useRef, useEffect } from 'react';

interface WinampEqualizerProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  width?: number;
  height?: number;
}

const BARS = 20;
const SEGMENTS = 16;
const GREEN = '#00CC44';
const YELLOW = '#CCCC00';
const RED = '#CC0000';
const OFF = '#0A0A0A';
const IDLE_GREEN = '#003311';
const BG = '#1A1A1A';
const BORDER_COLOR = '#00CC44';

export default function WinampEqualizer({
  analyser,
  isPlaying,
  width = 400,
  height = 120,
}: WinampEqualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const peaksRef = useRef<number[]>(new Array(BARS).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const peaks = peaksRef.current;

    const draw = () => {
      const borderWidth = 2;
      const innerW = width - borderWidth * 2;
      const innerH = height - borderWidth * 2;
      const gap = 2;
      const barWidth = Math.floor((innerW - (BARS - 1) * gap) / BARS);
      const segGap = 1;
      const segHeight = Math.floor((innerH - (SEGMENTS - 1) * segGap) / SEGMENTS);

      // Background + border
      ctx.fillStyle = BORDER_COLOR;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = BG;
      ctx.fillRect(borderWidth, borderWidth, innerW, innerH);

      if (analyser && dataArray && isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        const step = Math.max(1, Math.floor(dataArray.length / BARS));

        for (let i = 0; i < BARS; i++) {
          // Average nearby bins for smoother display
          let sum = 0;
          const start = i * step;
          const end = Math.min(start + step, dataArray.length);
          for (let j = start; j < end; j++) sum += dataArray[j];
          const value = (sum / (end - start)) / 255;
          const litSegments = Math.round(value * SEGMENTS);

          // Update peak
          if (litSegments > peaks[i]) {
            peaks[i] = litSegments;
          } else {
            peaks[i] = Math.max(0, peaks[i] - 0.5);
          }

          const x = borderWidth + i * (barWidth + gap);

          for (let s = 0; s < SEGMENTS; s++) {
            const segIndex = SEGMENTS - 1 - s; // bottom = 0, top = SEGMENTS-1
            const y = borderWidth + s * (segHeight + segGap);
            const isPeak = Math.round(peaks[i]) === segIndex && peaks[i] > 0;

            if (segIndex < litSegments || isPeak) {
              // Determine color by segment position
              const ratio = segIndex / SEGMENTS;
              if (ratio >= 0.7) {
                ctx.fillStyle = RED;
              } else if (ratio >= 0.4) {
                ctx.fillStyle = YELLOW;
              } else {
                ctx.fillStyle = GREEN;
              }
              // Peak indicator is brighter
              if (isPeak && segIndex >= litSegments) {
                ctx.globalAlpha = 0.9;
              }
            } else {
              ctx.fillStyle = OFF;
            }

            ctx.fillRect(x, y, barWidth, segHeight);
            ctx.globalAlpha = 1;
          }
        }
      } else {
        // Idle state: bottom 1-2 segments in dark green
        const gap2 = 2;
        const barW = Math.floor((innerW - (BARS - 1) * gap2) / BARS);
        const segH = Math.floor((innerH - (SEGMENTS - 1) * 1) / SEGMENTS);

        for (let i = 0; i < BARS; i++) {
          const x = borderWidth + i * (barW + gap2);
          // Reset peaks
          peaks[i] = Math.max(0, peaks[i] - 0.3);

          for (let s = 0; s < SEGMENTS; s++) {
            const segIndex = SEGMENTS - 1 - s;
            const y = borderWidth + s * (segH + 1);

            if (segIndex <= 1) {
              ctx.fillStyle = IDLE_GREEN;
            } else {
              ctx.fillStyle = OFF;
            }
            ctx.fillRect(x, y, barW, segH);
          }
        }
      }

      // Scanline effect — semi-transparent black every 2px
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < height; y += 2) {
        ctx.fillRect(0, y, width, 1);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, isPlaying, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        width: '100%',
        maxWidth: width,
        height,
        display: 'block',
        imageRendering: 'pixelated',
      }}
    />
  );
}
