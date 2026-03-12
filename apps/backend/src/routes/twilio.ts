import type { FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { z } from 'zod';
import { routeSmsToAgent, sendReply } from '../services/twilio-bridge.js';
import { requireAgentAuth } from '../auth.js';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WEBHOOK_BASE = process.env.TWILIO_WEBHOOK_BASE || '';

/** Validate Twilio webhook signature. In production, never skip. */
function validateTwilioSignature(
  url: string,
  body: Record<string, string>,
  signature: string,
): boolean {
  if (!TWILIO_AUTH_TOKEN) {
    if (process.env.NODE_ENV === 'production') return false;
    return true; // skip validation in dev only
  }
  if (!signature) return false;
  return twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, body);
}

export async function twilioRouter(fastify: FastifyInstance) {
  // Twilio sends application/x-www-form-urlencoded
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    try {
      const parsed: Record<string, string> = {};
      new URLSearchParams(body as string).forEach((v, k) => { parsed[k] = v; });
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  fastify.post('/sms', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const from = body.From || '';
    const to = body.To || '';
    const bodyText = body.Body || '';

    if (!bodyText) {
      reply.type('text/xml');
      return '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Empty message.</Message></Response>';
    }

    // Validate Twilio signature (use TWILIO_WEBHOOK_BASE in prod for exact URL match)
    const url = TWILIO_WEBHOOK_BASE || `${request.protocol}://${request.hostname}${request.url}`;
    const signature = (request.headers['x-twilio-signature'] as string) || '';
    if (!validateTwilioSignature(url, body, signature)) {
      reply.code(401);
      return { error: 'Invalid signature' };
    }

    const result = await routeSmsToAgent(from, bodyText);

    let responseMessage: string;
    if (result.success) {
      responseMessage = `Message forwarded to ${result.agentName}. They will respond when available.`;
    } else {
      responseMessage = result.error || 'Failed to route message.';
    }

    reply.type('text/xml');
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(responseMessage)}</Message></Response>`;
  });

  // WhatsApp uses same webhook format as SMS (From/To prefixed with whatsapp:)
  fastify.post('/whatsapp', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const bodyText = body.Body || '';

    if (!bodyText) {
      reply.type('text/xml');
      return '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Empty message.</Message></Response>';
    }

    const url = TWILIO_WEBHOOK_BASE || `${request.protocol}://${request.hostname}${request.url}`;
    const signature = (request.headers['x-twilio-signature'] as string) || '';
    if (!validateTwilioSignature(url, body, signature)) {
      reply.code(401);
      return { error: 'Invalid signature' };
    }

    const result = await routeSmsToAgent(body.From || '', bodyText);

    let responseMessage: string;
    if (result.success) {
      responseMessage = `Message forwarded to ${result.agentName}. They will respond when available.`;
    } else {
      responseMessage = result.error || 'Failed to route message.';
    }

    reply.type('text/xml');
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(responseMessage)}</Message></Response>`;
  });

  // Agent reply API — send message back to human via SMS/WhatsApp (requires agent auth)
  const replySchema = z.object({
    replyTo: z.string().min(1),
    message: z.string().min(1),
    channel: z.enum(['sms', 'whatsapp']),
  });

  fastify.post('/reply', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const parsed = replySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'Invalid body', details: parsed.error.flatten() };
    }

    const { replyTo, message, channel } = parsed.data;
    const result = await sendReply(replyTo, message, channel);

    if (!result.success) {
      reply.code(500);
      return { error: result.error || 'Failed to send reply' };
    }

    return { success: true };
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
