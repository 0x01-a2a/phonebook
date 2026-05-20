/**
 * Stripe service — Billing + Checkout helpers.
 */

import Stripe from 'stripe';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (stripeInstance) return stripeInstance;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  stripeInstance = new Stripe(key, { typescript: true });
  return stripeInstance;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const real = getStripe();
    const value = (real as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(real);
    }
    return value;
  },
});

export interface CreateCheckoutSessionInput {
  priceId: string;
  customerEmail: string;
  listenerId?: string;
  agentId?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<Stripe.Checkout.Session> {
  const successUrl =
    input.successUrl || `${APP_URL}/account?success=true&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = input.cancelUrl || `${APP_URL}/subscribe?canceled=true`;

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: input.priceId, quantity: 1 }],
    customer_email: input.customerEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    metadata: {
      listenerId: input.listenerId || '',
      agentId: input.agentId || '',
    },
    subscription_data: {
      metadata: {
        listenerId: input.listenerId || '',
        agentId: input.agentId || '',
      },
    },
  });
}

export async function createPortalSession(
  customerId: string,
  returnUrl?: string,
): Promise<Stripe.BillingPortal.Session> {
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || `${APP_URL}/account`,
  });
}

export function verifyWebhookSignature(payload: Buffer | string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  return stripe.webhooks.constructEvent(payload, signature, secret);
}
