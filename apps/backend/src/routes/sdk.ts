/**
 * SDK route — register + auto-claim via Ed25519 signature (ZeroClaw / 0x01 identity)
 *
 * POST /api/sdk/register
 *   Takes a signed message from the agent's Ed25519 keypair.
 *   Creates the agent and immediately marks it as verified/claimed.
 *   No email or tweet required.
 *
 * GET /api/sdk/me
 *   Returns the authenticated agent's own profile.
 */
import type { FastifyInstance } from 'fastify';
import { agents, db, eq } from '@phonebook/database';
import { z } from 'zod';
import crypto, { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import nacl from 'tweetnacl';
import { getVirtualNumberFromAgentId } from './agents.js';
import { emitActivity } from './events.js';
import { requireAgentAuth } from '../auth.js';

const registerSchema = z.object({
  name: z.string().min(1).max(40),
  pubkeyHex: z.string().length(64).regex(/^[0-9a-f]+$/i),
  signature: z.string().length(128).regex(/^[0-9a-f]+$/i),
  message: z.string().max(200),
  description: z.string().max(500).optional(),
  categories: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  webhookUrl: z.string().url().optional(),
});

/** Verify Ed25519 signature: pubkeyHex signs message */
function verifyEd25519(pubkeyHex: string, signatureHex: string, message: string): boolean {
  try {
    const pubkey = Buffer.from(pubkeyHex, 'hex');
    if (pubkey.length !== 32) return false;
    const sig = Buffer.from(signatureHex, 'hex');
    if (sig.length !== 64) return false;
    const msgBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msgBytes, sig, pubkey);
  } catch {
    return false;
  }
}

export async function sdkRouter(fastify: FastifyInstance) {
  /**
   * POST /api/sdk/register
   *
   * Body:
   *   name        — agent display name (unique, max 40)
   *   pubkeyHex   — 64-char hex of Ed25519 public key (32 bytes)
   *   signature   — 128-char hex of Ed25519 signature (64 bytes)
   *   message     — signed message: "register:{name}:{timestamp_ms}"
   *   description — optional
   *   categories  — optional string[]
   *   capabilities — optional string[] (e.g. ["translation", "summarization"])
   *   webhookUrl  — optional off-grid trigger webhook URL
   *
   * Response:
   *   agentId, agentSecret (show once!), phoneNumber, name, claimedAt
   */
  fastify.post('/register', async (request, reply) => {
    const data = registerSchema.parse(request.body);

    // Validate message format: "register:{name}:{timestamp_ms}"
    const parts = data.message.split(':');
    if (parts.length !== 3 || parts[0] !== 'register' || parts[1] !== data.name) {
      reply.code(400);
      return { error: 'Invalid message format. Expected: "register:{name}:{timestamp_ms}"' };
    }

    const ts = parseInt(parts[2]!, 10);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      reply.code(400);
      return { error: 'Message timestamp expired. Must be within 5 minutes of current time.' };
    }

    // Verify Ed25519 signature
    if (!verifyEd25519(data.pubkeyHex, data.signature, data.message)) {
      reply.code(401);
      return { error: 'Invalid signature. Sign the exact message string with your Ed25519 private key.' };
    }

    // Check pubkey uniqueness (one agent per keypair)
    const [existingPubkey] = await db.select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.pubkeyHex, data.pubkeyHex))
      .limit(1);

    if (existingPubkey) {
      reply.code(409);
      return { error: 'Agent with this pubkey already registered', existingAgentId: existingPubkey.id };
    }

    // Check name uniqueness
    const [existingName] = await db.select({ id: agents.id })
      .from(agents)
      .where(eq(agents.name, data.name))
      .limit(1);

    if (existingName) {
      reply.code(409);
      return { error: 'Agent name already taken' };
    }

    // Generate agent secret (one-time, store securely)
    const agentSecret = crypto.randomBytes(32).toString('hex');
    const agentSecretHash = await bcrypt.hash(agentSecret, 10);

    const agentId = randomUUID();
    // Phone number derived from pubkey — stable even if agent is re-registered
    const phoneNumber = getVirtualNumberFromAgentId(data.pubkeyHex);

    const insertResult = await db.insert(agents).values({
      id: agentId,
      name: data.name,
      description: data.description,
      categories: data.categories,
      phoneNumber,
      pubkeyHex: data.pubkeyHex,
      status: 'online',
      reputationScore: 0,
      trustScore: 1.0,
      verified: true,       // Auto-verified via cryptographic proof
      claimStatus: 'claimed',
      claimedAt: new Date(),
      agentSecretHash,
      ...(data.webhookUrl ? { contactWebhook: data.webhookUrl } : {}),
    }).returning();
    const newAgent = (insertResult as any[])[0];

    emitActivity('agent_registered', {
      agentId: newAgent.id,
      name: newAgent.name,
      categories: newAgent.categories,
    });

    reply.code(201);
    return {
      agentId: newAgent.id,
      agentSecret,
      phoneNumber: newAgent.phoneNumber,
      name: newAgent.name,
      claimedAt: newAgent.claimedAt,
      important: 'Store agentSecret securely — it is shown only once. Use X-Agent-Id + X-Agent-Secret (or Authorization: Bearer) for all authenticated calls.',
    };
  });

  /**
   * GET /api/sdk/me
   * Requires: X-Agent-Id + X-Agent-Secret (or Authorization: Bearer <secret>)
   * Returns: full agent profile (without sensitive fields)
   */
  fastify.get('/me', { preHandler: requireAgentAuth }, async (request, reply) => {
    const agent = (request as any).agent as { id: string; name: string };

    const [row] = await db.select()
      .from(agents)
      .where(eq(agents.id, agent.id))
      .limit(1);

    if (!row) {
      reply.code(404);
      return { error: 'Agent not found' };
    }

    // Strip secrets
    const { agentSecretHash, claimToken, claimEmailCode, claimEmailCodeExpires, claimTweetCode, ...safe } = row;
    return safe;
  });
}
