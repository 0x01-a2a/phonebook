import type { FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { routeSmsToAgent } from '../services/twilio-bridge.js';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WEBHOOK_BASE = process.env.TWILIO_WEBHOOK_BASE || '';

/** Validate Twilio webhook signature (skip if no token configured) */
function validateTwilioSignature(
  url: string,
  body: Record<string, string>,
  signature: string,
): boolean {
  if (!TWILIO_AUTH_TOKEN) return true; // skip validation in dev
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
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
