'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface PixelBannerFrame {
  pixels: number[][];
  duration: number;
}

const GRID_WIDTH = 40;
const GRID_HEIGHT = 8;
const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 64;
const PIXEL_SIZE = CANVAS_WIDTH / GRID_WIDTH;

// CGA Palette (16 colors)
const PALETTES = {
  cga: [
    '#000000', '#0000AA', '#00AA00', '#00AAAA',
    '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
    '#555555', '#5555FF', '#55FF55', '#55FFFF',
    '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF',
  ],
  c64: [
    '#000000', '#FFFFFF', '#880000', '#AAFFEE',
    '#CC44CC', '#00CC55', '#0000AA', '#EEEE77',
    '#DD8855', '#664400', '#FF7777', '#333333',
    '#777777', '#AAFF66', '#0088FF', '#BBBBBB',
  ],
  amsterdam: [
    '#000000', '#0000D8', '#00D800', '#00D8D8',
    '#D80000', '#D800D8', '#D8D800', '#D8D8D8',
    '#000000', '#0000FF', '#00FF00', '#00FFFF',
    '#FF0000', '#FF00FF', '#FFFF00', '#FFFFFF',
  ],
};

const DEFAULT_PALETTE = 'cga';

export default function PixelBannerEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frames, setFrames] = useState<PixelBannerFrame[]>([
    { pixels: Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(0)), duration: 500 },
  ]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [selectedColor, setSelectedColor] = useState(1);
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [isDrawing, setIsDrawing] = useState(false);
  const [fps, setFps] = useState(10);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [frameDuration, setFrameDuration] = useState(500);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const colors = PALETTES[palette as keyof typeof PALETTES] || PALETTES.cga;

  const drawPixel = useCallback((x: number, y: number, color: number) => {
    setFrames((prev) => {
      const newFrames = [...prev];
      const frame = { ...newFrames[currentFrame] };
      frame.pixels = [...frame.pixels.map((row) => [...row])];
      frame.pixels[y] = [...frame.pixels[y]];
      frame.pixels[y][x] = color;
      newFrames[currentFrame] = frame;
      return newFrames;
    });
  }, [currentFrame]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / GRID_WIDTH));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / GRID_HEIGHT));

    if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
      drawPixel(x, y, selectedColor);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    handleCanvasClick(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    handleCanvasClick(e);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const handleMouseLeave = () => {
    setIsDrawing(false);
  };

  const clearFrame = () => {
    setFrames((prev) => {
      const newFrames = [...prev];
      newFrames[currentFrame] = {
        ...newFrames[currentFrame],
        pixels: Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(0)),
      };
      return newFrames;
    });
  };

  const addFrame = () => {
    setFrames((prev) => [
      ...prev,
      { 
        pixels: prev[0].pixels.map((row) => [...row]), 
        duration: frameDuration 
      },
    ]);
    setCurrentFrame(frames.length);
  };

  const deleteFrame = (index: number) => {
    if (frames.length <= 1) return;
    setFrames((prev) => prev.filter((_, i) => i !== index));
    if (currentFrame >= frames.length - 1) {
      setCurrentFrame(frames.length - 2);
    }
  };

  const addText = () => {
    const text = prompt('Enter text to add:');
    if (!text) return;

    // Simple text rendering - place characters in grid
    const charWidth = 4;
    const startX = 1;
    
    // This is simplified - full implementation would have a font bitmap
    setFrames((prev) => {
      const newFrames = [...prev];
      const frame = { ...newFrames[currentFrame] };
      frame.pixels = frame.pixels.map((row) => [...row]);
      
      // Simple pattern for demo
      for (let i = 0; i < text.length && startX + i * charWidth < GRID_WIDTH; i++) {
        for (let y = 2; y < 6; y++) {
          for (let x = 0; x < charWidth; x++) {
            if (frame.pixels[y] && startX + i * charWidth + x < GRID_WIDTH) {
              frame.pixels[y][startX + i * charWidth + x] = selectedColor;
            }
          }
        }
      }
      
      newFrames[currentFrame] = frame;
      return newFrames;
    });
  };

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw pixels
    const currentPixels = frames[currentFrame].pixels;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const colorIndex = currentPixels[y]?.[x] || 0;
        if (colorIndex > 0) {
          ctx.fillStyle = colors[colorIndex];
          ctx.fillRect(
            x * (CANVAS_WIDTH / GRID_WIDTH),
            y * (CANVAS_HEIGHT / GRID_HEIGHT),
            CANVAS_WIDTH / GRID_WIDTH,
            CANVAS_HEIGHT / GRID_HEIGHT
          );
        }
      }
    }

    // Draw grid lines
    ctx.strokeStyle = 'rgba(139, 115, 85, 0.3)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= GRID_WIDTH; x++) {
      ctx.beginPath();
      ctx.moveTo(x * (CANVAS_WIDTH / GRID_WIDTH), 0);
      ctx.lineTo(x * (CANVAS_WIDTH / GRID_WIDTH), CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * (CANVAS_HEIGHT / GRID_HEIGHT));
      ctx.lineTo(CANVAS_WIDTH, y * (CANVAS_HEIGHT / GRID_HEIGHT));
      ctx.stroke();
    }
  }, [frames, currentFrame, colors]);

  // Preview animation
  useEffect(() => {
    if (!previewPlaying || frames.length <= 1) return;

    const canvas = previewRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameIndex = 0;
    let lastFrameTime = 0;

    const animate = (timestamp: number) => {
      if (timestamp - lastFrameTime >= frames[frameIndex].duration) {
        // Draw current frame
        const pixels = frames[frameIndex].pixels;
        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        for (let y = 0; y < GRID_HEIGHT; y++) {
          for (let x = 0; x < GRID_WIDTH; x++) {
            const colorIndex = pixels[y]?.[x] || 0;
            if (colorIndex > 0) {
              ctx.fillStyle = colors[colorIndex];
              ctx.fillRect(
                x * (CANVAS_WIDTH / GRID_WIDTH),
                y * (CANVAS_HEIGHT / GRID_HEIGHT),
                CANVAS_WIDTH / GRID_WIDTH,
                CANVAS_HEIGHT / GRID_HEIGHT
              );
            }
          }
        }

        frameIndex = (frameIndex + 1) % frames.length;
        lastFrameTime = timestamp;
      }

      if (previewPlaying) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);

    return () => {
      // Cleanup
    };
  }, [previewPlaying, frames, colors]);

  const exportGif = () => {
    // In production, use gif.js to export
    alert('GIF export would be generated here using gif.js');
  };

  const exportJson = () => {
    const data = JSON.stringify({ frames, palette, gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'banner.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Pixel Banner Editor</h1>
        <p className="subtitle">Create animated 8-bit banners for your agent</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '2rem' }}>
        {/* Main editor area */}
        <div>
          {/* Preview */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3>Preview</h3>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <canvas
                ref={previewRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                style={{ 
                  width: CANVAS_WIDTH, 
                  height: CANVAS_HEIGHT, 
                  imageRendering: 'pixelated',
                  border: '2px solid #2C1810',
                  background: '#000'
                }}
              />
              <div>
                <button 
                  className="btn" 
                  onClick={() => setPreviewPlaying(!previewPlaying)}
                  style={{ marginBottom: '0.5rem' }}
                >
                  {previewPlaying ? '⏸ Stop' : '▶ Play'}
                </button>
                <p style={{ fontFamily: 'Courier Prime', fontSize: '0.8rem', color: '#8B7355' }}>
                  {frames.length} frames
                </p>
              </div>
            </div>
          </div>

          {/* Editor canvas */}
          <div className="card">
            <h3>Edit</h3>
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              style={{ 
                width: '100%', 
                maxWidth: CANVAS_WIDTH, 
                height: 'auto',
                imageRendering: 'pixelated',
                cursor: 'crosshair',
                border: '1px solid #8B7355',
              }}
            />
            
            {/* Frame controls */}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {frames.map((_, index) => (
                <button
                  key={index}
                  className={`btn ${currentFrame === index ? 'btn-primary' : ''}`}
                  onClick={() => setCurrentFrame(index)}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                >
                  {index + 1}
                </button>
              ))}
              <button className="btn" onClick={addFrame} style={{ padding: '0.25rem 0.5rem' }}>+</button>
            </div>

            {frames.length > 1 && (
              <div style={{ marginTop: '0.5rem' }}>
                <button 
                  className="btn" 
                  onClick={() => deleteFrame(currentFrame)}
                  style={{ fontSize: '0.8rem' }}
                >
                  Delete frame
                </button>
                <label style={{ marginLeft: '1rem', fontSize: '0.9rem' }}>
                  Frame duration (ms):
                  <input
                    type="number"
                    value={frameDuration}
                    onChange={(e) => setFrameDuration(parseInt(e.target.value) || 500)}
                    style={{ width: '80px', marginLeft: '0.5rem' }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <aside>
          {/* Color palette */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3>Palette</h3>
            <select 
              value={palette} 
              onChange={(e) => setPalette(e.target.value)}
              style={{ marginBottom: '0.5rem' }}
            >
              <option value="cga">CGA</option>
              <option value="c64">Commodore 64</option>
              <option value="amsterdam">Amsterdam</option>
            </select>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '2px' }}>
              {colors.map((color, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedColor(index)}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    background: color,
                    border: selectedColor === index ? '2px solid #D4A853' : '1px solid #8B7355',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Tools */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3>Tools</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button className="btn" onClick={clearFrame}>
                🗑️ Clear frame
              </button>
              <button className="btn" onClick={addText}>
                🔤 Add text
              </button>
            </div>
          </div>

          {/* Export */}
          <div className="card">
            <h3>Export</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button className="btn btn-primary" onClick={exportGif}>
                📷 Export GIF
              </button>
              <button className="btn" onClick={exportJson}>
                📄 Export JSON
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
