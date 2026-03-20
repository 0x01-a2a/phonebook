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
const WEBHOOK_BASE = process.env.WEBHOOK_BASE || 'https://api.phonebook.0x01.world/api';

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
            prompt: opts.systemPrompt || `You are ${opts.name}, an AI agent in the PhoneBook directory. ${opts.description || 'You are helpful and professional.'}. You have access to two tools: search_web (search the internet for current information) and scrape_url (read a full webpage). Use search_web whenever someone asks a question you don't know the answer to, asks about current events, weather, prices, people, or anything that requires up-to-date information. Use scrape_url when you need to read the full content of a specific URL. Keep responses concise and conversational.`,
            llm: opts.llm || 'gpt-4o',
            temperature: 0.7,
            tools: [
              {
                type: 'webhook',
                name: 'search_web',
                description: 'Search the internet for current information. Use this whenever the user asks about current events, weather, prices, people, facts, or anything you are unsure about.',
                api_schema: {
                  url: `${WEBHOOK_BASE}/voice/tools/search`,
                  method: 'POST',
                  request_body_schema: {
                    type: 'object',
                    properties: {
                      query: {
                        type: 'string',
                        description: 'The search query to look up on the internet',
                      },
                    },
                    required: ['query'],
                  },
                },
              },
              {
                type: 'webhook',
                name: 'scrape_url',
                description: 'Read the full content of a webpage. Use this when you have a specific URL and need to read its content for detailed information.',
                api_schema: {
                  url: `${WEBHOOK_BASE}/voice/tools/scrape`,
                  method: 'POST',
                  request_body_schema: {
                    type: 'object',
                    properties: {
                      url: {
                        type: 'string',
                        description: 'The URL of the webpage to read',
                      },
                    },
                    required: ['url'],
                  },
                },
              },
            ],
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
 * Update an existing ElevenLabs Agent to add/refresh tools and system prompt.
 * Used to add search_web + scrape_url to agents created before tools were configured.
 */
export async function updateAgentTools(elevenlabsAgentId: string, opts: { name: string; description?: string }): Promise<void> {
  if (!ELEVENLABS_API_KEY) return;

  const res = await fetch(`${ELEVENLABS_API_URL}/convai/agents/${elevenlabsAgentId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      conversation_config: {
        agent: {
          prompt: {
            prompt: `You are ${opts.name}, an AI agent in the PhoneBook directory. ${opts.description || 'You are helpful and professional.'}. You have access to two tools: search_web (search the internet for current information) and scrape_url (read a full webpage). Use search_web whenever someone asks a question you don't know the answer to, asks about current events, weather, prices, people, or anything that requires up-to-date information. Use scrape_url when you need to read the full content of a specific URL. Keep responses concise and conversational.`,
            tools: [
              {
                type: 'webhook',
                name: 'search_web',
                description: 'Search the internet for current information. Use this whenever the user asks about current events, weather, prices, people, facts, or anything you are unsure about.',
                api_schema: {
                  url: `${WEBHOOK_BASE}/voice/tools/search`,
                  method: 'POST',
                  request_body_schema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string', description: 'The search query to look up on the internet' },
                    },
                    required: ['query'],
                  },
                },
              },
              {
                type: 'webhook',
                name: 'scrape_url',
                description: 'Read the full content of a webpage. Use this when you have a specific URL and need to read its content for detailed information.',
                api_schema: {
                  url: `${WEBHOOK_BASE}/voice/tools/scrape`,
                  method: 'POST',
                  request_body_schema: {
                    type: 'object',
                    properties: {
                      url: { type: 'string', description: 'The URL of the webpage to read' },
                    },
                    required: ['url'],
                  },
                },
              },
            ],
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[ElevenLabs] Update agent tools failed ${res.status}: ${body}`);
  }

  console.log(`[ElevenLabs] Updated tools for agent ${elevenlabsAgentId}`);
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

  const body = await res.text();

  if (!res.ok) {
    throw new Error(`[ElevenLabs] Register call failed ${res.status}: ${body}`);
  }

  // ElevenLabs may return TwiML as XML directly or as JSON { twiml: "..." }
  if (body.includes('<Response>')) return body;

  try {
    const json = JSON.parse(body) as { twiml?: string };
    if (json.twiml) return json.twiml;
  } catch {
    // Not JSON — treat as raw TwiML
  }

  throw new Error(`[ElevenLabs] No TwiML in register call response: ${body.slice(0, 200)}`);
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

  // Already has an ElevenLabs Agent — update tools if not yet done
  if (vc.elevenlabsAgentId) {
    if (!vc.toolsConfigured) {
      try {
        await updateAgentTools(vc.elevenlabsAgentId, {
          name: agent.name,
          description: agent.description || undefined,
        });
        await db
          .update(agents)
          .set({
            voiceConfig: { ...vc, toolsConfigured: true },
            updatedAt: new Date(),
          })
          .where(eq(agents.id, agentId));
        console.log(`[ElevenLabs] Added tools to existing agent ${agent.name}`);
      } catch (err) {
        console.error(`[ElevenLabs] Failed to update tools for ${agent.name}:`, err);
      }
    }
    return vc.elevenlabsAgentId;
  }

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
      voiceConfig: { ...vc, elevenlabsAgentId, toolsConfigured: true },
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));

  console.log(`[ElevenLabs] Created agent for ${agent.name}: ${elevenlabsAgentId}`);
  return elevenlabsAgentId;
}
