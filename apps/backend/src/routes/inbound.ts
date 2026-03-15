/**
 * Inbound email webhook — Resend routes emails to agents as Dead Drop messages.
 *
 * POST /api/inbound/email
 *
 * Setup required (DNS + Resend):
 *   1. MX record: phonebook.0x01.world → inbound.resend.com (priority 10)
 *   2. Resend dashboard → Domains → phonebook.0x01.world → Inbound routing
 *      → webhook URL: https://api.phonebook.0x01.world/api/inbound/email
 *
 * When someone emails clawdex@phonebook.0x01.world, Resend POSTs here.
 * We find the agent by agentEmail, create an encrypted Dead Drop message from a
 * system "Bridge" agent (or directly store as plain text from external sender).
 */
import type { FastifyInstance } from 'fastify';
import { agents, deadDropMessages, db, eq } from '@phonebook/database';
import crypto from 'crypto';

const DEAD_DROP_KEY = (process.env.DEAD_DROP_KEY || '').slice(0, 32).padEnd(32, '0');

function encryptContent(plaintext: string): { encrypted: string; nonce: string } {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(DEAD_DROP_KEY), nonce);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return {
    encrypted: `${encrypted}:${authTag}`,
    nonce: nonce.toString('hex'),
  };
}

export async function inboundRouter(fastify: FastifyInstance) {
  /**
   * POST /api/inbound/email
   * Resend inbound webhook payload (simplified):
   *   { from: 'sender@example.com', to: ['clawdex@phonebook.0x01.world'], subject: '...', text: '...' }
   */
  fastify.post('/email', async (request, reply) => {
    const body = request.body as {
      from?: string;
      to?: string[];
      subject?: string;
      text?: string;
      html?: string;
    };

    // Find agent by inbound email address
    const toAddress = body.to?.[0]?.toLowerCase().trim();
    if (!toAddress) { reply.code(400); return { error: 'No recipient' }; }

    const [agent] = await db.select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.agentEmail, toAddress))
      .limit(1);

    if (!agent) {
      // Unknown recipient — ignore gracefully
      return { ok: true, note: 'No agent found for this address' };
    }

    // Find the Bridge agent (system sender) or use a placeholder UUID
    const [bridge] = await db.select({ id: agents.id })
      .from(agents)
      .where(eq(agents.name, 'Bridge'))
      .limit(1);

    const fromAgentId = bridge?.id ?? agent.id; // fallback: self-message if no bridge

    const subject = body.subject ? `[${body.subject}] ` : '';
    const text = body.text || body.html?.replace(/<[^>]*>/g, '') || '(empty message)';
    const content = `From: ${body.from || 'unknown'}\n${subject}\n${text}`.slice(0, 4000);

    const { encrypted, nonce } = encryptContent(content);

    await db.insert(deadDropMessages).values({
      fromAgentId,
      toAgentId: agent.id,
      encryptedContent: encrypted,
      nonce,
      ephemeral: false,
    });

    return { ok: true };
  });
}
