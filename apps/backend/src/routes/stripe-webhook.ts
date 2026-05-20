/**
 * Stripe webhook — receives events, updates local subscriptions table.
 */

import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { db, subscriptions, eq } from '@phonebook/database';
import { verifyWebhookSignature, stripe } from '../services/stripe.js';
import { emitActivity } from './events.js';

export async function stripeWebhookRouter(fastify: FastifyInstance) {
  fastify.post('/', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      return reply.code(400).send({ error: 'missing stripe-signature header' });
    }

    const rawBody = (request as { rawBody?: Buffer }).rawBody ?? (request.body as Buffer);
    if (!Buffer.isBuffer(rawBody)) {
      return reply.code(400).send({ error: 'expected raw body buffer for webhook' });
    }

    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(rawBody, signature);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Webhook] signature verify failed:', msg);
      return reply.code(400).send({ error: 'invalid signature' });
    }

    console.log(`[Webhook] received ${event.type} (${event.id})`);

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (!session.customer || !session.subscription) break;
          const customerId =
            typeof session.customer === 'string' ? session.customer : session.customer.id;
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;

          const sub = (await stripe.subscriptions.retrieve(subId)) as unknown as Stripe.Subscription & {
            current_period_end: number;
            cancel_at_period_end: boolean;
          };
          const priceId = sub.items.data[0]?.price.id;

          const meta = session.metadata || {};
          await db
            .insert(subscriptions)
            .values({
              agentId: meta.agentId && meta.agentId.length > 0 ? meta.agentId : null,
              listenerId: meta.listenerId && meta.listenerId.length > 0 ? meta.listenerId : null,
              email:
                session.customer_details?.email || session.customer_email || 'unknown@example.com',
              stripeCustomerId: customerId,
              stripeSubscriptionId: subId,
              stripePriceId: priceId,
              plan: 'pro',
              status: sub.status,
              currentPeriodEnd: new Date(sub.current_period_end * 1000),
              cancelAtPeriodEnd: sub.cancel_at_period_end,
            })
            .onConflictDoUpdate({
              target: subscriptions.stripeCustomerId,
              set: {
                stripeSubscriptionId: subId,
                stripePriceId: priceId,
                plan: 'pro',
                status: sub.status,
                currentPeriodEnd: new Date(sub.current_period_end * 1000),
                cancelAtPeriodEnd: sub.cancel_at_period_end,
                updatedAt: new Date(),
              },
            });

          emitActivity('subscription_started', {
            plan: 'pro',
            listenerId: meta.listenerId,
            agentId: meta.agentId,
          });
          break;
        }
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription & {
            current_period_end: number;
            cancel_at_period_end: boolean;
          };
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
          await db
            .update(subscriptions)
            .set({
              status: sub.status,
              currentPeriodEnd: new Date(sub.current_period_end * 1000),
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.stripeCustomerId, customerId));
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
          await db
            .update(subscriptions)
            .set({ status: 'canceled', plan: 'free', updatedAt: new Date() })
            .where(eq(subscriptions.stripeCustomerId, customerId));
          break;
        }
        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice & { subscription: string | { id: string } | null };
          if (!invoice.subscription) break;
          const subId =
            typeof invoice.subscription === 'string'
              ? invoice.subscription
              : invoice.subscription.id;
          await db
            .update(subscriptions)
            .set({
              musicQuotaUsed: 0,
              broadcastQuotaUsed: 0,
              weekStart: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.stripeSubscriptionId, subId));
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Webhook] handling ${event.type} failed:`, msg);
      return reply.code(500).send({ error: 'handler failed' });
    }

    return { received: true };
  });
}
