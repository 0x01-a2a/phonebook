'use client';

import { useRef, useEffect } from 'react';

interface WaveformProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  width?: number;
  height?: number;
}

export default function Waveform({ analyser, isPlaying, width = 400, height = 32 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bars = 32;
    const gap = 1;
    const barWidth = Math.floor((width - (bars - 1) * gap) / bars);
    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(0, 0, width, height);

      if (analyser && dataArray && isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        const step = Math.floor(dataArray.length / bars);

        for (let i = 0; i < bars; i++) {
          const value = dataArray[i * step] / 255;
          const barHeight = Math.max(2, Math.floor(value * height));
          const x = i * (barWidth + gap);
          const y = height - barHeight;

          // Pixel gradient: bright green at top, darker at bottom
          const gradient = ctx.createLinearGradient(x, y, x, height);
          gradient.addColorStop(0, '#00FF55');
          gradient.addColorStop(0.5, '#00CC44');
          gradient.addColorStop(1, '#006622');
          ctx.fillStyle = gradient;
          ctx.fillRect(x, y, barWidth, barHeight);
        }
      } else {
        // Idle: small green dots
        for (let i = 0; i < bars; i++) {
          const x = i * (barWidth + gap);
          ctx.fillStyle = '#004411';
          ctx.fillRect(x, height - 2, barWidth, 2);
        }
      }

      // Scanline effect
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let y = 0; y < height; y += 3) {
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
