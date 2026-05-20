/**
 * ElevenLabs Music service — generates music tracks via /v1/music.
 *
 * Stores resulting MP3 via local-disk r2-storage helper. Returns the public URL.
 */

import { uploadAudio } from './r2-storage.js';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

export interface MusicRequestInput {
  prompt: string;
  durationMs: number;
  instrumental?: boolean;
  seed?: number;
}

export interface MusicResult {
  audioUrl: string;
  sizeBytes: number;
  durationSec: number;
}

export interface MusicRequestBody {
  prompt: string;
  music_length_ms: number;
  model_id: 'music_v1';
  force_instrumental: boolean;
  seed?: number;
}

export function buildMusicRequest(input: MusicRequestInput): MusicRequestBody {
  return {
    prompt: input.prompt,
    music_length_ms: Math.max(3000, Math.min(600000, input.durationMs)),
    model_id: 'music_v1',
    force_instrumental: input.instrumental ?? true,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
}

export async function generateMusic(
  input: MusicRequestInput,
  trackId: string,
): Promise<MusicResult | { error: string }> {
  if (!ELEVENLABS_API_KEY) return { error: 'ELEVENLABS_API_KEY not set' };

  const body = buildMusicRequest(input);
  const res = await fetch(`${ELEVENLABS_API_URL}/music?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `ElevenLabs Music HTTP ${res.status}: ${text.slice(0, 200)}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const key = `music/${ym}/${trackId}.mp3`;
  const upload = await uploadAudio(buf, key, 'audio/mpeg');

  return {
    audioUrl: upload.publicUrl,
    sizeBytes: upload.sizeBytes,
    durationSec: Math.round(input.durationMs / 1000),
  };
}
