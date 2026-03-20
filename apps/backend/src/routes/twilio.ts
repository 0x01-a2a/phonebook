import type { FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { z } from 'zod';
import { routeSmsToAgent, sendReply } from '../services/twilio-bridge.js';
import { requireAgentAuth } from '../auth.js';
import { resolveByPhoneNumber } from '../services/voice-gateway.js';
import { ensureAgent, registerTwilioCall } from '../services/elevenlabs-agents.js';
import { emitActivity } from './events.js';

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

  // ─── VOICE CALL IVR ──────────────────────────────────────

  /**
   * Twilio Voice webhook — inbound call to central number.
   * Plays IVR greeting and gathers agent extension (DTMF).
   */
  fastify.post('/voice', async (request, reply) => {
    const body = request.body as Record<string, string>;

    const url = TWILIO_WEBHOOK_BASE
      ? TWILIO_WEBHOOK_BASE.replace(/\/api\/twilio$/, '') + '/api/twilio/voice'
      : `${request.protocol}://${request.hostname}/api/twilio/voice`;
    const signature = (request.headers['x-twilio-signature'] as string) || '';
    if (!validateTwilioSignature(url, body, signature)) {
      reply.code(401);
      return { error: 'Invalid signature' };
    }

    reply.type('text/xml');
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="8" action="/api/twilio/voice/connect" method="POST" timeout="10">
    <Say voice="alice">Welcome to Phone Book. Please enter the 8 digit agent extension, followed by pound.</Say>
  </Gather>
  <Say voice="alice">No input received. Goodbye.</Say>
</Response>`;
  });

  /**
   * Twilio Voice — extension gathered, connect to ElevenLabs Agent.
   */
  fastify.post('/voice/connect', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const digits = body.Digits || '';
    const from = body.From || '';
    const to = body.To || '';

    if (!digits || digits.length < 8) {
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Invalid extension. Goodbye.</Say>
</Response>`;
    }

    // Build phone number from digits: 48210033 → +1-0x01-4821-0033
    const phoneNumber = `+1-0x01-${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
    const agent = await resolveByPhoneNumber(phoneNumber);

    if (!agent) {
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Agent not found for extension ${digits}. Goodbye.</Say>
</Response>`;
    }

    if (!agent.voiceEnabled) {
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapeXml(agent.name)} has not enabled voice calls. Goodbye.</Say>
</Response>`;
    }

    try {
      // Ensure ElevenLabs Agent exists (create if needed)
      const elevenlabsAgentId = await ensureAgent(agent.id);

      if (!elevenlabsAgentId) {
        reply.type('text/xml');
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Voice service unavailable for ${escapeXml(agent.name)}. Goodbye.</Say>
</Response>`;
      }

      // Register call with ElevenLabs → get TwiML
      const twiml = await registerTwilioCall(elevenlabsAgentId, from, to);

      emitActivity('wake_triggered', {
        agentId: agent.id,
        name: agent.name,
        wakeType: 'voice_call',
        from,
      });

      reply.type('text/xml');
      return twiml;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Voice] Failed to connect call to ${agent.name}:`, msg);

      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Sorry, we could not connect you to ${escapeXml(agent.name)}. Please try again later.</Say>
</Response>`;
    }
  });

  /**
   * Twilio Voice — status callback for call tracking.
   */
  fastify.post('/voice/status', async (request, reply) => {
    // Just acknowledge — we can add logging later
    reply.code(200).send({ ok: true });
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
