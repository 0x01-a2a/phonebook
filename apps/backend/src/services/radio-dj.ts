/**
 * Radio DJ Service — generates and caches DJ voice clips for Radio Phonebook
 *
 * Uses ElevenLabs TTS (v3) with a female voice to create intro, filler,
 * and signoff clips. Clips are cached on disk and served via /api/audio/.
 */

import { existsSync } from 'fs';
import { mkdir, readdir } from 'fs/promises';
import path from 'path';
import Redis from 'ioredis';
import { textToSpeechV3 } from './voice-gateway.js';
import { uploadAudio } from './r2-storage.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const API_URL = process.env.API_URL || 'http://localhost:3001';
const DJ_VOICE_ID = process.env.RADIO_DJ_VOICE_ID || 'AZnzlk1XvdvUeBnXmlld';
const DJ_DIR = 'radio-dj';
const RATE_LIMIT_WINDOW = 30 * 60; // 30 minutes

export interface DjClip {
  type: 'intro' | 'filler' | 'signoff';
  variant: number;
  audioUrl: string;
  script: string;
}

const DJ_SCRIPTS: Record<string, string[]> = {
  intro: [
    "Welcome to Radio Phonebook! You're tuning into the only station where AI agents deliver the news. I'm your host, and we've got some fresh broadcasts lined up for you. Let's dive right in...",
  ],
  filler: [
    "That was our latest set from the PhoneBook agents. Stay tuned, more reports are on the way...",
    "You're listening to Radio Phonebook. Our AI reporters are out gathering the latest stories...",
    "And that wraps up our current lineup. Don't go anywhere, there's always something new on Radio Phonebook...",
  ],
  signoff: [
    "That's all for now from Radio Phonebook. Thanks for listening, and remember — the agents never sleep. See you next time!",
  ],
};

function clipFilename(type: string, variant: number): string {
  return `${DJ_DIR}/${type}-${variant}.mp3`;
}

function clipPath(type: string, variant: number): string {
  return path.join(process.cwd(), 'data', 'audio', clipFilename(type, variant));
}

export async function generateDjClip(
  type: 'intro' | 'filler' | 'signoff',
  variant: number,
): Promise<DjClip | null> {
  const scripts = DJ_SCRIPTS[type];
  if (!scripts || variant < 0 || variant >= scripts.length) {
    console.error(`[RadioDJ] Invalid clip: ${type}-${variant}`);
    return null;
  }

  // Rate limit generation
  const rlKey = `radio_dj_gen:${type}:${variant}`;
  const existing = await redis.get(rlKey);
  if (existing) {
    console.log(`[RadioDJ] Rate limited: ${type}-${variant}`);
    return null;
  }

  const script = scripts[variant];
  console.log(`[RadioDJ] Generating ${type}-${variant} (${script.length} chars)...`);

  const buffer = await textToSpeechV3(script, DJ_VOICE_ID, {
    stability: 0.5,
    similarityBoost: 0.8,
    style: 0.6,
  });

  if (!buffer) {
    console.error(`[RadioDJ] TTS failed for ${type}-${variant}`);
    return null;
  }

  const filename = clipFilename(type, variant);
  const result = await uploadAudio(buffer, filename, 'audio/mpeg');

  // Set rate limit after successful generation
  await redis.set(rlKey, Date.now().toString(), 'EX', RATE_LIMIT_WINDOW);

  console.log(`[RadioDJ] Generated ${type}-${variant} (${result.sizeBytes} bytes)`);

  return {
    type,
    variant,
    audioUrl: result.publicUrl,
    script,
  };
}

export async function getDjClip(
  type: 'intro' | 'filler' | 'signoff',
  variant: number = 0,
): Promise<DjClip | null> {
  const scripts = DJ_SCRIPTS[type];
  if (!scripts || variant < 0 || variant >= scripts.length) return null;

  // Check if cached on disk
  const fp = clipPath(type, variant);
  if (existsSync(fp)) {
    return {
      type,
      variant,
      audioUrl: `${API_URL}/api/audio/${clipFilename(type, variant)}`,
      script: scripts[variant],
    };
  }

  // Lazy generate
  return generateDjClip(type, variant);
}

export async function getAllCachedClips(): Promise<DjClip[]> {
  const clips: DjClip[] = [];
  const dir = path.join(process.cwd(), 'data', 'audio', DJ_DIR);

  // Ensure directory exists
  await mkdir(dir, { recursive: true });

  // Check all known scripts
  for (const [type, scripts] of Object.entries(DJ_SCRIPTS)) {
    for (let variant = 0; variant < scripts.length; variant++) {
      const fp = clipPath(type, variant);
      if (existsSync(fp)) {
        clips.push({
          type: type as DjClip['type'],
          variant,
          audioUrl: `${API_URL}/api/audio/${clipFilename(type, variant)}`,
          script: scripts[variant],
        });
      }
    }
  }

  return clips;
}

export async function regenerateAllClips(): Promise<DjClip[]> {
  const clips: DjClip[] = [];

  for (const [type, scripts] of Object.entries(DJ_SCRIPTS)) {
    for (let variant = 0; variant < scripts.length; variant++) {
      const clip = await generateDjClip(type as DjClip['type'], variant);
      if (clip) clips.push(clip);
    }
  }

  return clips;
}
