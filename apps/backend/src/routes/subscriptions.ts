/**
 * Subscriptions Router — Stripe Checkout + Portal + status lookup.
 */

import type { FastifyInstance } from 'fastify';
import { db, subscriptions, eq, or, desc } from '@phonebook/database';
import { createCheckoutSession, createPortalSession } from '../services/stripe.js';
import { extractListenerId } from '../auth-listener.js';

const STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO || '';
const PRO_MUSIC_QUOTA = 1;
const PRO_BROADCAST_QUOTA = 3;

export async function subscriptionsRouter(fastify: FastifyInstance) {
  /** POST /api/subscriptions/checkout — create Stripe Checkout Session */
  fastify.post('/checkout', async (request, reply) => {
    const body = request.body as { email?: string; agentId?: string };
    const listenerId = extractListenerId({
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, unknown>,
    });

    if (!body.email) {
      return reply.code(400).send({ error: 'email required' });
    }
    if (!STRIPE_PRICE_ID_PRO) {
      return reply.code(500).send({ error: 'STRIPE_PRICE_ID_PRO not configured' });
    }
    if (!listenerId && !body.agentId) {
      return reply.code(400).send({ error: 'listenerId header or agentId required' });
    }

    try {
      const session = await createCheckoutSession({
        priceId: STRIPE_PRICE_ID_PRO,
        customerEmail: body.email,
        listenerId: listenerId || undefined,
        agentId: body.agentId,
      });
      return { url: session.url, sessionId: session.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Subscriptions] checkout failed:', msg);
      return reply.code(500).send({ error: msg });
    }
  });

  /** GET /api/subscriptions/status — lookup current subscription */
  fastify.get('/status', async (request) => {
    const listenerId = extractListenerId({
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, unknown>,
    });
    const agentId = (request.query as { agentId?: string }).agentId;

    if (!listenerId && !agentId) {
      return { plan: 'free', status: 'none' };
    }

    const conditions = [];
    if (listenerId) conditions.push(eq(subscriptions.listenerId, listenerId));
    if (agentId) conditions.push(eq(subscriptions.agentId, agentId));

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(or(...conditions))
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1);

    if (!sub) return { plan: 'free', status: 'none' };

    return {
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      stripeCustomerId: sub.stripeCustomerId,
      musicQuotaUsed: sub.musicQuotaUsed,
      broadcastQuotaUsed: sub.broadcastQuotaUsed,
      musicQuotaTotal: sub.plan === 'pro' ? PRO_MUSIC_QUOTA : 0,
      broadcastQuotaTotal: sub.plan === 'pro' ? PRO_BROADCAST_QUOTA : 0,
    };
  });

  /** POST /api/subscriptions/portal — create Customer Portal session */
  fastify.post('/portal', async (request, reply) => {
    const body = request.body as { stripeCustomerId?: string };
    if (!body.stripeCustomerId) {
      return reply.code(400).send({ error: 'stripeCustomerId required' });
    }
    try {
      const session = await createPortalSession(body.stripeCustomerId);
      return { url: session.url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: msg });
    }
  });
}
