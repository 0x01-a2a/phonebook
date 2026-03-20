/**
 * ElevenLabs Conversational Agents Service
 *
 * Creates and manages ElevenLabs Agents per PhoneBook agent.
 * Handles Twilio Register Call for dynamic routing (one number → many agents).
 *
 * Flow:
 *   1. Agent enables voice → createConversationalAgent() → saves elevenlabsAgentId
 *   2. Human calls central Twilio number → IVR → extension → registerCall()
 *   3. ElevenLabs returns TwiML → Twilio connects call to the right agent
 */

import { db, agents, eq } from '@phonebook/database';
import type { VoiceConfig } from '@phonebook/database';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

export interface CreateAgentOptions {
  name: string;
  description?: string;
  voiceId?: string;
  language?: string;
  firstMessage?: string;
  systemPrompt?: string;
  llm?: string;
}

export interface RegisterCallResult {
  twiml: string;
}

/**
 * Create an ElevenLabs Conversational Agent for a PhoneBook agent.
 * Returns the agent_id to store in voiceConfig.elevenlabsAgentId.
 */
export async function createConversationalAgent(opts: CreateAgentOptions): Promise<string> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('[ElevenLabs] API key not configured');
  }

  const res = await fetch(`${ELEVENLABS_API_URL}/convai/agents/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      name: `PhoneBook: ${opts.name}`,
      conversation_config: {
        tts: {
          model_id: 'eleven_v3_conversational',
          voice_id: opts.voiceId || 'EXAVITQu4vr4xnSDxMaL',
          stability: 0.5,
          similarity_boost: 0.8,
        },
        agent: {
          first_message: opts.firstMessage || `Hello, this is ${opts.name}. How can I help you?`,
          language: opts.language || 'en',
          prompt: {
            prompt: opts.systemPrompt || `You are ${opts.name}, an AI agent in the PhoneBook directory. ${opts.description || 'You are helpful and professional.'}. Keep responses concise and conversational.`,
            llm: opts.llm || 'gpt-4o',
            temperature: 0.7,
          },
        },
        turn: {
          turn_timeout: 7,
          turn_eagerness: 'normal',
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[ElevenLabs] Create agent failed ${res.status}: ${body}`);
  }

  const json = await res.json() as { agent_id: string };
  return json.agent_id;
}

/**
 * Delete an ElevenLabs Agent.
 */
export async function deleteConversationalAgent(agentId: string): Promise<void> {
  if (!ELEVENLABS_API_KEY) return;

  await fetch(`${ELEVENLABS_API_URL}/convai/agents/${agentId}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
  });
}

/**
 * Register an inbound Twilio call with ElevenLabs.
 * Returns TwiML that Twilio uses to connect the call to the agent.
 */
export async function registerTwilioCall(
  elevenlabsAgentId: string,
  fromNumber: string,
  toNumber: string,
): Promise<string> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('[ElevenLabs] API key not configured');
  }

  const res = await fetch(`${ELEVENLABS_API_URL}/convai/twilio/register-call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      agent_id: elevenlabsAgentId,
      from_number: fromNumber,
      to_number: toNumber,
      direction: 'inbound',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[ElevenLabs] Register call failed ${res.status}: ${body}`);
  }

  const json = await res.json() as { twiml?: string };

  // API may return TwiML directly or nested
  if (json.twiml) return json.twiml;

  // Fallback: the entire response body might be the TwiML
  const text = JSON.stringify(json);
  if (text.includes('<Response>')) return text;

  throw new Error('[ElevenLabs] No TwiML in register call response');
}

/**
 * Ensure a PhoneBook agent has an ElevenLabs Conversational Agent.
 * Creates one if missing, returns the elevenlabsAgentId.
 */
export async function ensureAgent(agentId: string): Promise<string | null> {
  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      voiceEnabled: agents.voiceEnabled,
      voiceConfig: agents.voiceConfig,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent || !agent.voiceEnabled) return null;

  const vc = (agent.voiceConfig as VoiceConfig) || {};

  // Already has an ElevenLabs Agent
  if (vc.elevenlabsAgentId) return vc.elevenlabsAgentId;

  // Create one
  const elevenlabsAgentId = await createConversationalAgent({
    name: agent.name,
    description: agent.description || undefined,
    voiceId: vc.voiceId,
    language: vc.language,
  });

  // Save to DB
  await db
    .update(agents)
    .set({
      voiceConfig: { ...vc, elevenlabsAgentId },
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));

  console.log(`[ElevenLabs] Created agent for ${agent.name}: ${elevenlabsAgentId}`);
  return elevenlabsAgentId;
}
