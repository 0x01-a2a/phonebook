/**
 * Inbound email webhook — Resend routes received emails to agents as Dead Drop messages.
 *
 * POST /api/inbound/email
 *
 * Flow:
 *   1. Resend receives email for *@phonebook.0x01.world
 *   2. Fires webhook → here (payload: metadata only, no body)
 *   3. We verify the Resend signature (whsec_...)
 *   4. Fetch full email body via GET https://api.resend.com/emails/:id
 *   5. Find agent by agentEmail, create encrypted Dead Drop message
 *
 * DNS required (Tobias):
 *   MX  phonebook.0x01.world  inbound.resend.com  10
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { agents, deadDropMessages, db, eq } from '@phonebook/database';
import crypto from 'crypto';

const DEAD_DROP_KEY = (process.env.DEAD_DROP_KEY || '').slice(0, 32).padEnd(32, '0');
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';

function encryptContent(plaintext: string): { encrypted: string; nonce: string } {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(DEAD_DROP_KEY), nonce);
  let enc = cipher.update(plaintext, 'utf8', 'hex');
  enc += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { encrypted: `${enc}:${authTag}`, nonce: nonce.toString('hex') };
}

/** Verify Resend webhook signature (svix-compatible) */
function verifyResendSignature(req: FastifyRequest, rawBody: string): boolean {
  if (!RESEND_WEBHOOK_SECRET) return true; // skip in dev if not configured
  try {
    const secret = RESEND_WEBHOOK_SECRET.replace(/^whsec_/, '');
    const secretBytes = Buffer.from(secret, 'base64');
    const msgId = req.headers['svix-id'] as string;
    const msgTimestamp = req.headers['svix-timestamp'] as string;
    const msgSignature = req.headers['svix-signature'] as string;
    if (!msgId || !msgTimestamp || !msgSignature) return false;
    const toSign = `${msgId}.${msgTimestamp}.${rawBody}`;
    const computed = crypto.createHmac('sha256', secretBytes).update(toSign).digest('base64');
    const signatures = msgSignature.split(' ').map(s => s.replace(/^v1,/, ''));
    return signatures.some(s => crypto.timingSafeEqual(Buffer.from(s), Buffer.from(computed)));
  } catch {
    return false;
  }
}

/** Fetch full email body from Resend API */
async function fetchEmailBody(emailId: string): Promise<{ text?: string; html?: string; from?: string; subject?: string } | null> {
  try {
    const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (!res.ok) return null;
    return await res.json() as any;
  } catch {
    return null;
  }
}

export async function inboundRouter(fastify: FastifyInstance) {
  fastify.post('/email', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const rawBody = (request as any).rawBody as string ?? JSON.stringify(request.body);

    // Verify signature
    if (RESEND_WEBHOOK_SECRET && !verifyResendSignature(request, rawBody)) {
      request.log.warn('Inbound email: invalid Resend signature');
      reply.code(401);
      return { error: 'Invalid signature' };
    }

    const event = request.body as any;

    // Resend webhook format: { type: 'email.received', data: { email_id, from, to, subject, ... } }
    if (event?.type !== 'email.received') {
      return { ok: true, note: 'Ignored non-inbound event' };
    }

    const data = event.data ?? {};
    const emailId: string = data.email_id ?? data.id;
    const fromRaw: string = data.from ?? '';
    const toRaw: string[] = Array.isArray(data.to) ? data.to : [data.to ?? ''];
    const subject: string = data.subject ?? '';

    // Extract clean to-address (handle "Name <email>" format)
    const toAddress = toRaw[0]?.replace(/.*<(.+)>/, '$1').toLowerCase().trim();
    if (!toAddress) return { ok: true };

    // Find agent by agentEmail
    const [agent] = await db.select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.agentEmail, toAddress))
      .limit(1);

    if (!agent) return { ok: true, note: 'No agent for this address' };

    // Fetch full email body (webhook only has metadata)
    let text = '(no body)';
    if (emailId && RESEND_API_KEY) {
      const full = await fetchEmailBody(emailId);
      if (full) {
        text = full.text || full.html?.replace(/<[^>]*>/g, '') || '(no body)';
      }
    }

    // Find Bridge agent as sender (or self-loop fallback)
    const [bridge] = await db.select({ id: agents.id })
      .from(agents)
      .where(eq(agents.name, 'Bridge'))
      .limit(1);
    const fromAgentId = bridge?.id ?? agent.id;

    const from = fromRaw.replace(/.*<(.+)>/, '$1') || fromRaw || 'unknown';
    const content = `[EMAIL]\nFrom: ${from}\nSubject: ${subject}\n\n${text}`.slice(0, 4000);
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
