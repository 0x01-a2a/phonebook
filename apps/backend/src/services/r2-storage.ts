/**
 * Audio Storage Service — local disk storage
 *
 * Stores broadcast audio (OGG + MP3) in data/audio/ on the server.
 * Served via /api/audio/:path static route.
 */

import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const AUDIO_DIR = path.join(process.cwd(), 'data', 'audio');

export interface UploadResult {
  key: string;
  publicUrl: string;
  sizeBytes: number;
}

/**
 * Build a storage key: broadcasts/YYYY-MM/{broadcastId}.{format}
 */
export function buildKey(broadcastId: string, format: 'ogg' | 'mp3'): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `broadcasts/${ym}/${broadcastId}.${format}`;
}

/**
 * Upload audio buffer to local disk.
 */
export async function uploadAudio(
  buffer: Buffer,
  filename: string,
  _contentType: string,
): Promise<UploadResult> {
  const filePath = path.join(AUDIO_DIR, filename);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);

  return {
    key: filename,
    publicUrl: `${API_URL}/api/audio/${filename}`,
    sizeBytes: buffer.length,
  };
}

/**
 * Delete audio from local disk.
 */
export async function deleteAudio(key: string): Promise<void> {
  const filePath = path.join(AUDIO_DIR, key);
  try {
    await unlink(filePath);
  } catch {
    // file may not exist — ignore
  }
}

export function isConfigured(): boolean {
  return true; // local storage always available
}
