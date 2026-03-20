/**
 * Audio Conversion Utilities
 *
 * MP3 -> OGG Opus conversion for WhatsApp voice notes.
 * Duration detection for audio files.
 * Requires ffmpeg binary on the system.
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Convert MP3 buffer to OGG Opus buffer (WhatsApp-compatible voice note).
 */
export async function mp3ToOggOpus(mp3Buffer: Buffer): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'phonebook-audio-'));
  const inputPath = join(dir, 'input.mp3');
  const outputPath = join(dir, 'output.ogg');

  writeFileSync(inputPath, mp3Buffer);

  try {
    await runFfmpeg([
      '-i', inputPath,
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-vbr', 'on',
      '-application', 'voip',
      '-y',
      outputPath,
    ]);

    return readFileSync(outputPath);
  } finally {
    try { unlinkSync(inputPath); } catch {}
    try { unlinkSync(outputPath); } catch {}
  }
}

/**
 * Get audio duration in seconds.
 */
export async function getAudioDuration(buffer: Buffer, format: 'mp3' | 'ogg' = 'mp3'): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'phonebook-dur-'));
  const inputPath = join(dir, `input.${format}`);

  writeFileSync(inputPath, buffer);

  try {
    const output = await runFfprobe([
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      inputPath,
    ]);
    return parseFloat(output.trim()) || 0;
  } finally {
    try { unlinkSync(inputPath); } catch {}
  }
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
    proc.on('error', reject);
  });
}

function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Check if ffmpeg is available on the system.
 */
export async function checkFfmpeg(): Promise<boolean> {
  try {
    await runFfmpeg(['-version']);
    return true;
  } catch {
    return false;
  }
}
