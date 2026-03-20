/**
 * Twilio Bridge — one central number for all agents
 *
 * Supports SMS and WhatsApp. Human texts:
 *   +1-0x01-4821-0033 Your message here
 * or short form:
 *   4821-0033 Your message here
 *
 * Bridge:
 *   1. Parses extension from message body
 *   2. Looks up agent by virtual number
 *   3. Routes to agent via contactWebhook, 0x01 aggregator (PROPOSE), or Dead Drop
 *   4. Agent can reply via POST /api/twilio/reply → Twilio sends back to human
 */

import { agents, deadDropMessages } from '@phonebook/database';
import { db } from '@phonebook/database';
import { eq } from '@phonebook/database';
import twilio from 'twilio';
import * as voice from './voice-gateway.js';
import * as aggregator from './aggregator-bridge.js';
import { encryptMessage } from '../routes/dead-drop.js';

/** System agent ID for human-originated messages (must exist in DB, add via seed) */
export const BRIDGE_SYSTEM_AGENT_ID = '00000000-0000-4000-8000-000000000001';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';

// Match +1-0x01-XXXX-XXXX or 0x01-XXXX-XXXX or XXXX-XXXX or XXXXXXXX (8 digits)
const EXTENSION_REGEX = /(?:\+1-)?(?:0x01-)?(\d{4})-?(\d{4})|(\d{8})/;

export type Channel = 'sms' | 'whatsapp';

export interface IncomingSms {
  From: string;
  To: string;
  Body: string;
  MessageSid: string;
  NumMedia?: string;
}

export interface BridgeResult {
  success: boolean;
  agentId?: string;
  agentName?: string;
  routedVia?: 'dead_drop' | 'webhook' | 'aggregator';
  replyTo?: string;
  channel?: Channel;
  error?: string;
}

/**
 * Normalize Twilio From/To address. WhatsApp uses "whatsapp:+14155551234".
 */
export function normalizeTwilioAddress(addr: string): { normalized: string; channel: Channel } {
  const trimmed = (addr || '').trim();
  if (trimmed.toLowerCase().startsWith('whatsapp:')) {
    return {
      normalized: trimmed.slice(9).trim(),
      channel: 'whatsapp',
    };
  }
  return { normalized: trimmed, channel: 'sms' };
}

/**
 * Send reply from agent back to human via SMS or WhatsApp.
 */
export async function sendReply(
  to: string,
  message: string,
  channel: Channel,
): Promise<{ success: boolean; error?: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return { success: false, error: 'Twilio not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)' };
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const from = channel === 'whatsapp' ? `whatsapp:${TWILIO_PHONE_NUMBER}` : TWILIO_PHONE_NUMBER;
  const toAddr = channel === 'whatsapp' ? `whatsapp:${to.replace(/^whatsapp:/, '')}` : to;

  try {
    await client.messages.create({
      body: message,
      from,
      to: toAddr,
    });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Send a voice note (audio file) via WhatsApp.
 * Used by broadcast engine to deliver audio reports.
 */
export async function sendVoiceNote(
  to: string,
  mediaUrl: string,
  caption?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return { success: false, error: 'Twilio not configured' };
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  try {
    await client.messages.create({
      from: `whatsapp:${TWILIO_PHONE_NUMBER}`,
      to: `whatsapp:${to.replace(/^whatsapp:/, '')}`,
      mediaUrl: [mediaUrl],
      body: caption || '',
    });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Parse agent extension from SMS body.
 * Returns { phoneNumber, message } or null if no valid extension.
 */
export function parseExtensionFromBody(body: string): { phoneNumber: string; message: string } | null {
  const trimmed = body.trim();
  const match = trimmed.match(EXTENSION_REGEX);

  if (!match) return null;

  let phoneNumber: string;
  if (match[3]) {
    // 8 digits: XXXXXXXX
    const digits = match[3];
    phoneNumber = `+1-0x01-${digits.slice(0, 4)}-${digits.slice(4)}`;
  } else {
    phoneNumber = `+1-0x01-${match[1]}-${match[2]}`;
  }

  // Message is everything after the extension
  const extensionEnd = match.index! + match[0].length;
  const message = trimmed.slice(extensionEnd).trim() || 'New message from human via SMS';

  return { phoneNumber, message };
}

/**
 * Route incoming SMS/WhatsApp to the target agent.
 * fromRaw: Twilio From (e.g. "+14155551234" or "whatsapp:+14155551234")
 */
export async function routeSmsToAgent(
  fromRaw: string,
  body: string,
): Promise<BridgeResult> {
  const { normalized: fromHuman, channel } = normalizeTwilioAddress(fromRaw);

  const parsed = parseExtensionFromBody(body);

  if (!parsed) {
    return {
      success: false,
      error: 'No agent extension found. Format: +1-0x01-XXXX-XXXX your message',
    };
  }

  const { phoneNumber, message } = parsed;

  // Look up agent by virtual number
  const agent = await voice.resolveByPhoneNumber(phoneNumber);

  if (!agent) {
    return {
      success: false,
      error: `Agent not found for ${phoneNumber}`,
    };
  }

  const payload = {
    from: fromHuman,
    replyTo: fromHuman,
    channel,
    message,
    source: channel === 'whatsapp' ? 'twilio_whatsapp' : 'twilio_sms',
    timestamp: new Date().toISOString(),
  };

  // 1. Try contactWebhook first (agent's own endpoint)
  const agentFull = await db.select({
    id: agents.id,
    name: agents.name,
    contactWebhook: agents.contactWebhook,
  })
    .from(agents)
    .where(eq(agents.id, agent.id))
    .limit(1)
    .then((r) => r[0]);

  if (agentFull?.contactWebhook) {
    try {
      const res = await fetch(agentFull.contactWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'sms',
          from: fromHuman,
          body: message,
          agentId: agent.id,
          payload,
        }),
      });

      if (res.ok) {
        return {
          success: true,
          agentId: agent.id,
          agentName: agent.name,
          routedVia: 'webhook',
          replyTo: fromHuman,
          channel,
        };
      }
    } catch (err) {
      console.warn('[TwilioBridge] Webhook failed, falling back:', err);
    }
  }

  // 2. Try 0x01 aggregator (PROPOSE) if agent might be sleeping
  const aggregatorAvailable = await aggregator.isAggregatorAvailable();
  if (aggregatorAvailable) {
    const jobId = `sms-${Date.now()}`;
    const sent = await aggregator.sendWakeViaAggregator(
      agent.id,
      BRIDGE_SYSTEM_AGENT_ID,
      jobId,
      'PROPOSE',
    );

    if (sent) {
      // Store in Dead Drop so agent can fetch message when they wake
      const { encrypted, nonce } = encryptMessage(JSON.stringify(payload));
      await db.insert(deadDropMessages).values({
        fromAgentId: BRIDGE_SYSTEM_AGENT_ID,
        toAgentId: agent.id,
        encryptedContent: encrypted,
        nonce,
        ephemeral: false,
      });

      return {
        success: true,
        agentId: agent.id,
        agentName: agent.name,
        routedVia: 'aggregator',
        replyTo: fromHuman,
        channel,
      };
    }
  }

  // 3. Fallback: Dead Drop (agent polls inbox)
  const { encrypted, nonce } = encryptMessage(JSON.stringify(payload));
  await db.insert(deadDropMessages).values({
    fromAgentId: BRIDGE_SYSTEM_AGENT_ID,
    toAgentId: agent.id,
    encryptedContent: encrypted,
    nonce,
    ephemeral: false,
  });

  return {
    success: true,
    agentId: agent.id,
    agentName: agent.name,
    routedVia: 'dead_drop',
    replyTo: fromHuman,
    channel,
  };
}
