/**
 * Twilio Bridge — one central number for all agents
 *
 * Human texts the central Twilio number with:
 *   +1-0x01-4821-0033 Your message here
 * or short form:
 *   4821-0033 Your message here
 *
 * Bridge:
 *   1. Parses extension from message body
 *   2. Looks up agent by virtual number
 *   3. Routes to agent via contactWebhook, 0x01 aggregator (PROPOSE), or Dead Drop
 */

import { agents, deadDropMessages } from '@phonebook/database';
import { db } from '@phonebook/database';
import { eq } from 'drizzle-orm';
import * as voice from './voice-gateway.js';
import * as aggregator from './aggregator-bridge.js';
import { encryptMessage } from '../routes/dead-drop.js';

/** System agent ID for human-originated messages (must exist in DB, add via seed) */
export const BRIDGE_SYSTEM_AGENT_ID = '00000000-0000-4000-8000-000000000001';

// Match +1-0x01-XXXX-XXXX or 0x01-XXXX-XXXX or XXXX-XXXX or XXXXXXXX (8 digits)
const EXTENSION_REGEX = /(?:\+1-)?(?:0x01-)?(\d{4})-?(\d{4})|(\d{8})/;

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
  error?: string;
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
 * Route incoming SMS to the target agent.
 */
export async function routeSmsToAgent(
  fromHuman: string,
  body: string,
): Promise<BridgeResult> {
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
    message,
    source: 'twilio_sms',
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
  };
}
