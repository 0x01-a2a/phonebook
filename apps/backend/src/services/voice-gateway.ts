/**
 * Voice Gateway for PhoneBook
 *
 * Enables voice calls to agents via their virtual phone numbers.
 * Uses ElevenLabs for text-to-speech / conversational AI when the
 * agent accepts a voice call.
 *
 * Flow:
 *   1. Caller dials agent's virtual number (+1-0x01-XXXX-XXXX)
 *   2. Gateway looks up agent by phone number
 *   3. If agent is online: bridge the call via ElevenLabs conversational agent
 *   4. If agent is offline: trigger wake, queue voicemail, or reject
 */

import { agents } from '@phonebook/database';
import { db } from '@phonebook/database';
import { eq } from '@phonebook/database';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

export interface VoiceCallRequest {
  phoneNumber: string;
  callerAgentId?: string;
  message?: string;
}

export interface VoiceCallResult {
  success: boolean;
  agentId?: string;
  agentName?: string;
  audioUrl?: string;
  error?: string;
}

/**
 * Resolve an agent from their virtual phone number.
 */
export async function resolveByPhoneNumber(phoneNumber: string) {
  const result = await db.select({
    id: agents.id,
    name: agents.name,
    status: agents.status,
    voiceEnabled: agents.voiceEnabled,
    voiceConfig: agents.voiceConfig,
    phoneNumber: agents.phoneNumber,
  })
    .from(agents)
    .where(eq(agents.phoneNumber, phoneNumber))
    .limit(1);

  return result[0] || null;
}

/**
 * Generate speech from text using ElevenLabs.
 * Returns a URL to the generated audio.
 */
export async function textToSpeech(
  text: string,
  voiceId: string = 'EXAVITQu4vr4xnSDxMaL',
): Promise<string | null> {
  if (!ELEVENLABS_API_KEY) {
    console.warn('[Voice] ElevenLabs API key not configured');
    return null;
  }

  try {
    const res = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!res.ok) {
      console.error('[Voice] ElevenLabs error:', res.status);
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const { uploadAudio, buildKey } = await import('./r2-storage.js');
    const key = buildKey(`call-${Date.now()}`, 'mp3');
    const result = await uploadAudio(buffer, key, 'audio/mpeg');
    return result.publicUrl;
  } catch (error) {
    console.error('[Voice] TTS error:', error);
    return null;
  }
}

/**
 * Generate speech using ElevenLabs v3 model.
 * Returns raw MP3 buffer — caller decides on storage.
 */
export async function textToSpeechV3(
  text: string,
  voiceId: string = 'EXAVITQu4vr4xnSDxMaL',
  options?: { stability?: number; similarityBoost?: number; style?: number },
): Promise<Buffer | null> {
  if (!ELEVENLABS_API_KEY) {
    console.warn('[Voice] ElevenLabs API key not configured');
    return null;
  }

  try {
    const res = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_v3',
        voice_settings: {
          stability: options?.stability ?? 0.3,
          similarity_boost: options?.similarityBoost ?? 0.85,
          style: options?.style ?? 0.7,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[Voice] ElevenLabs v3 error:', res.status, body);
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (error) {
    console.error('[Voice] TTS v3 error:', error);
    return null;
  }
}

/**
 * Initiate a voice call to an agent.
 */
export async function callAgent(request: VoiceCallRequest): Promise<VoiceCallResult> {
  const agent = await resolveByPhoneNumber(request.phoneNumber);

  if (!agent) {
    return { success: false, error: 'Phone number not found' };
  }

  if (!agent.voiceEnabled) {
    return {
      success: false,
      agentId: agent.id,
      agentName: agent.name,
      error: 'Agent has not enabled voice calls',
    };
  }

  if (agent.status === 'offline') {
    return {
      success: false,
      agentId: agent.id,
      agentName: agent.name,
      error: 'Agent is offline. Use trigger to wake them first.',
    };
  }

  const greeting = `Hello, you've reached ${agent.name}. How can I help you?`;
  const voiceId = (agent.voiceConfig as any)?.voiceId || 'EXAVITQu4vr4xnSDxMaL';
  const audioUrl = await textToSpeech(greeting, voiceId);

  return {
    success: true,
    agentId: agent.id,
    agentName: agent.name,
    audioUrl: audioUrl || undefined,
  };
}
