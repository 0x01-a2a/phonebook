# PhoneBook Radio Pro — Stripe Hackathon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a subscription-gated music/broadcast generation feature on top of existing PhoneBook Radio, using Stripe Billing + Checkout for $9/mo "Pro" tier, before the Stripe×ElevenLabs hackathon deadline (~38h from 2026-05-20).

**Architecture:**
- Stripe Billing (Product + Price) + Checkout Sessions in `mode: 'subscription'` for signup
- Stripe Customer Portal for self-service management
- Webhook (`/api/stripe/webhook`) processes `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and updates local `subscriptions` table
- Quota enforced server-side on `POST /api/music/generate` and `POST /api/broadcasts/request` (weekly counters reset by `current_period_end`)
- Anonymous listeners get a `listener_id` UUID in localStorage; subscription tied to it OR to authed `agent_id` if logged in
- Frontend: `/subscribe` (pricing + CTA), `/account` (status + portal link), gated "Generate Music"/"Request Broadcast" buttons on `/radio`

**Tech stack:** Fastify (backend), Next.js 15 (frontend), Drizzle ORM + Postgres, Stripe Node SDK v17+, ElevenLabs Music API (`POST /v1/music`, `model_id: music_v1`), existing local-disk audio storage (`r2-storage.ts`).

**Out of scope (post-hackathon):** Customer Portal upgrades/downgrades UI deep links, dunning emails, proration testing, multi-currency, agent-to-agent x402, tax (Stripe Tax).

---

## Pricing (single tier for MVP)

| Plan | Price | Quota / week | Features |
|---|---|---|---|
| **Listener** | Free | Unlimited listen, vote, favorite | Existing UX |
| **PhoneBook Radio Pro** | **$9/mo** | 1 music track + 3 broadcasts | Generate music via ElevenLabs Music, request custom broadcasts on any topic |

Future tiers (Studio $29/mo, Stations $99/mo) — schema supports them via `plan` enum.

---

## File map (created or modified)

**Backend (`apps/backend/`):**
- Create: `src/services/stripe.ts` — Stripe SDK init, helpers
- Create: `src/services/elevenlabs-music.ts` — Music API wrapper, R2 upload
- Create: `src/routes/subscriptions.ts` — REST endpoints (checkout, portal, status)
- Create: `src/routes/stripe-webhook.ts` — webhook handler (raw body parsing)
- Create: `src/routes/music.ts` — generate, list, get track
- Modify: `src/index.ts` — register new routes, raw body for webhook
- Modify: `src/auth.ts` — add `getListenerOrAgentId(req)` helper
- Modify: `src/routes/broadcasts.ts` — add quota gate to on-demand `POST /api/broadcasts/request`

**Database (`packages/database/`):**
- Modify: `src/schema.ts` — add `subscriptions`, `musicTracks`, `subscriptionPlanEnum`, `subscriptionStatusEnum`
- Create: `src/scripts/seed-music-track.ts` — upload existing `radio-phonebook-best-of.mp3` as track #1

**Frontend (`apps/frontend/`):**
- Create: `src/app/subscribe/page.tsx` — pricing + Checkout CTA
- Create: `src/app/account/page.tsx` — subscription status + portal link + usage
- Create: `src/app/api/checkout/route.ts` — server action proxying to backend (CORS-free)
- Modify: `src/app/radio/RadioClient.tsx` — "Generate Music" CTA, "Request Broadcast" CTA, music in queue
- Create: `src/lib/listener-id.ts` — localStorage UUID helper
- Modify: `src/app/layout.tsx` or top nav — add "Subscribe" link

**Infra:**
- Modify: `apps/backend/.env` (on Scaleway) — add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO`
- Modify: `apps/frontend/.env.local` — add `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

---

## Milestones

- **M1 (4h)** — Stripe account + product/price + skeleton subscription endpoints + DB schema
- **M2 (4h)** — ElevenLabs Music service + music routes + R2 upload + first track seeded
- **M3 (4h)** — Frontend pricing page + Checkout flow + account page
- **M4 (3h)** — RadioClient integration: Generate Music + Request Broadcast (gated)
- **M5 (3h)** — Deploy to prod (Vercel + Scaleway), Stripe webhook wired
- **M6 (3h)** — End-to-end smoke test (real subscription in test mode → real generation)
- **M7 (3h)** — Viral demo video + submission

Total active work: ~24h. Buffer: ~14h.

---

# Tasks

### Task 1: Stripe account setup (manual, user action)

**Files:** none — Stripe Dashboard work

- [ ] **Step 1: Confirm Stripe account exists**

User confirms `https://dashboard.stripe.com/test/dashboard` is accessible. If new, sign up at https://stripe.com.

- [ ] **Step 2: Create Product "PhoneBook Radio Pro" in test mode**

Dashboard → Product Catalog → Add product:
- Name: `PhoneBook Radio Pro`
- Description: `Subscription plan for creators on PhoneBook Radio — generate music and request custom broadcasts.`
- Recurring price: `$9.00 USD / month`
- Tax behavior: Inclusive

Save and copy the **Price ID** (starts with `price_`). Stash it as `STRIPE_PRICE_ID_PRO`.

- [ ] **Step 3: Get test API keys**

Dashboard → Developers → API keys → copy:
- **Publishable key** (`pk_test_...`) → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- **Secret key** (`sk_test_...`) → `STRIPE_SECRET_KEY`

- [ ] **Step 4: Enable Customer Portal in test mode**

Dashboard → Settings → Billing → Customer portal → Activate. Configure:
- Allow customers to: cancel subscription, update payment method, view invoice history
- Save

---

### Task 2: Install Stripe SDK + add env scaffolding

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `apps/frontend/package.json`
- Modify: `apps/backend/.env` (local + production)
- Modify: `apps/frontend/.env.local`

- [ ] **Step 1: Install Stripe SDK backend**

Run from `apps/backend/`:
```bash
pnpm add stripe
```
Expected: `stripe@^17.x.x` added.

- [ ] **Step 2: Install Stripe.js + React frontend**

Run from `apps/frontend/`:
```bash
pnpm add @stripe/stripe-js
```
Expected: `@stripe/stripe-js@^4.x.x` added.

- [ ] **Step 3: Add env vars to local backend `.env`**

Append to `apps/backend/.env` (and production `/opt/phonebook/.env` later):
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO=price_...
APP_URL=https://phonebook.0x01.world
```
For local dev `APP_URL=http://localhost:3000`.

- [ ] **Step 4: Add publishable key to frontend `.env.local`**

```
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

- [ ] **Step 5: Commit (skeleton, no code yet)**

```bash
git add apps/backend/package.json apps/frontend/package.json pnpm-lock.yaml
git commit -m "feat(stripe): install SDKs for hackathon"
```

---

### Task 3: DB migration — subscriptions + music_tracks

**Files:**
- Modify: `packages/database/src/schema.ts`
- Test: `packages/database/src/scripts/check-schema.ts` (create)

- [ ] **Step 1: Add enums + tables to schema**

In `packages/database/src/schema.ts`, after the existing enums (~line 12), add:
```typescript
export const subscriptionPlanEnum = pgEnum('subscription_plan', ['free', 'pro', 'studio']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused',
]);
export const musicTrackStatusEnum = pgEnum('music_track_status', ['pending', 'generating', 'ready', 'failed']);
```

Before the `export type` block at bottom, add:
```typescript
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Owner is either an agent OR an anonymous listener (one of these is set)
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
  listenerId: varchar('listener_id', { length: 64 }), // localStorage UUID for anon users
  email: varchar('email', { length: 255 }).notNull(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 64 }).notNull().unique(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 64 }).unique(),
  stripePriceId: varchar('stripe_price_id', { length: 64 }),
  plan: subscriptionPlanEnum('plan').default('free').notNull(),
  status: subscriptionStatusEnum('status').default('incomplete').notNull(),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
  // Weekly quota — counters reset by cron when week boundary crossed
  weekStart: timestamp('week_start').defaultNow().notNull(),
  musicQuotaUsed: integer('music_quota_used').default(0).notNull(),
  broadcastQuotaUsed: integer('broadcast_quota_used').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  byListener: index('subscriptions_listener_idx').on(t.listenerId),
  byAgent: index('subscriptions_agent_idx').on(t.agentId),
}));

export const musicTracks = pgTable('music_tracks', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Producer: agent (if claimed) OR listener_id (anon Pro subscriber)
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  listenerId: varchar('listener_id', { length: 64 }),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 200 }).notNull(),
  prompt: text('prompt').notNull(),
  genre: varchar('genre', { length: 60 }), // 'synthwave', 'lo-fi', etc.
  instrumental: boolean('instrumental').default(true),
  durationSec: integer('duration_sec'),
  audioUrlMp3: varchar('audio_url_mp3', { length: 500 }),
  sizeBytes: integer('size_bytes'),
  status: musicTrackStatusEnum('status').default('pending').notNull(),
  errorMessage: text('error_message'),
  playCount: integer('play_count').default(0).notNull(),
  favoriteCount: integer('favorite_count').default(0).notNull(),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

Also extend the type exports at the bottom:
```typescript
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type MusicTrack = typeof musicTracks.$inferSelect;
export type NewMusicTrack = typeof musicTracks.$inferInsert;
```

- [ ] **Step 2: Generate migration**

From repo root:
```bash
pnpm db:generate
```
Expected: new migration file in `packages/database/drizzle/` named like `0001_add_subscriptions_music.sql`.

- [ ] **Step 3: Apply migration locally (or skip for hackathon — push direct)**

```bash
pnpm db:push
```
Expected: `[✓] Changes applied`.

- [ ] **Step 4: Verify tables exist**

```bash
psql "postgresql://postgres:postgres@localhost:5432/agentbook" -c "\dt subscriptions music_tracks"
```
Expected: both tables listed.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/schema.ts packages/database/drizzle/
git commit -m "feat(db): subscriptions + music_tracks tables"
```

---

### Task 4: Stripe service helper

**Files:**
- Create: `apps/backend/src/services/stripe.ts`
- Test: `apps/backend/src/services/stripe.test.ts`

- [ ] **Step 1: Write failing test for `createCheckoutSession`**

Create `apps/backend/src/services/stripe.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { createCheckoutSession } from './stripe.js';

test('createCheckoutSession returns a session with url', async () => {
  const session = await createCheckoutSession({
    priceId: process.env.STRIPE_PRICE_ID_PRO!,
    customerEmail: 'test@example.com',
    listenerId: 'test-listener-uuid',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  });
  assert.ok(session.url, 'session has url');
  assert.ok(session.id.startsWith('cs_'), 'session id is checkout session');
});
```

- [ ] **Step 2: Run test — should fail**

```bash
pnpm --filter @phonebook/backend test
```
Expected: FAIL (`createCheckoutSession not exported`).

- [ ] **Step 3: Implement `stripe.ts`**

Create `apps/backend/src/services/stripe.ts`:
```typescript
/**
 * Stripe service — Billing + Checkout helpers.
 *
 * Uses Stripe Node SDK with API version 2026-04-22.dahlia.
 */

import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

if (!STRIPE_SECRET_KEY) {
  console.warn('[Stripe] STRIPE_SECRET_KEY not set — Stripe calls will fail.');
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
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
  const successUrl = input.successUrl || `${APP_URL}/account?success=true&session_id={CHECKOUT_SESSION_ID}`;
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

export function verifyWebhookSignature(
  payload: Buffer | string,
  signature: string,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  return stripe.webhooks.constructEvent(payload, signature, secret);
}
```

- [ ] **Step 4: Run test — should pass**

```bash
pnpm --filter @phonebook/backend test
```
Expected: PASS (session created in Stripe test mode).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/stripe.ts apps/backend/src/services/stripe.test.ts
git commit -m "feat(stripe): createCheckoutSession + portal session + webhook verify"
```

---

### Task 5: ElevenLabs Music service

**Files:**
- Create: `apps/backend/src/services/elevenlabs-music.ts`
- Test: `apps/backend/src/services/elevenlabs-music.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/backend/src/services/elevenlabs-music.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { buildMusicRequest } from './elevenlabs-music.js';

test('buildMusicRequest creates valid request body', () => {
  const body = buildMusicRequest({
    prompt: 'lo-fi hip hop chill beats',
    durationMs: 30000,
    instrumental: true,
  });
  assert.strictEqual(body.model_id, 'music_v1');
  assert.strictEqual(body.music_length_ms, 30000);
  assert.strictEqual(body.force_instrumental, true);
  assert.match(body.prompt, /lo-fi/);
});
```

- [ ] **Step 2: Run test — fails**

```bash
pnpm --filter @phonebook/backend test
```
Expected: FAIL (function not exported).

- [ ] **Step 3: Implement service**

Create `apps/backend/src/services/elevenlabs-music.ts`:
```typescript
/**
 * ElevenLabs Music service — generates music tracks via /v1/music.
 *
 * Stores resulting MP3 via local-disk r2-storage helper. Returns the public URL.
 */

import { uploadAudio } from './r2-storage.js';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

export interface MusicRequestInput {
  prompt: string;
  durationMs: number; // 3000-600000
  instrumental?: boolean;
  seed?: number;
}

export interface MusicResult {
  audioUrl: string;
  sizeBytes: number;
  durationSec: number;
}

export function buildMusicRequest(input: MusicRequestInput): {
  prompt: string;
  music_length_ms: number;
  model_id: 'music_v1';
  force_instrumental: boolean;
  seed?: number;
} {
  return {
    prompt: input.prompt,
    music_length_ms: Math.max(3000, Math.min(600000, input.durationMs)),
    model_id: 'music_v1',
    force_instrumental: input.instrumental ?? true,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
}

export async function generateMusic(
  input: MusicRequestInput,
  trackId: string,
): Promise<MusicResult | { error: string }> {
  if (!ELEVENLABS_API_KEY) return { error: 'ELEVENLABS_API_KEY not set' };

  const body = buildMusicRequest(input);
  const res = await fetch(`${ELEVENLABS_API_URL}/music?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `ElevenLabs Music HTTP ${res.status}: ${text.slice(0, 200)}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const key = `music/${ym}/${trackId}.mp3`;
  const upload = await uploadAudio(buf, key, 'audio/mpeg');

  return {
    audioUrl: upload.publicUrl,
    sizeBytes: upload.sizeBytes,
    durationSec: Math.round(input.durationMs / 1000),
  };
}
```

- [ ] **Step 4: Run test — passes**

```bash
pnpm --filter @phonebook/backend test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/elevenlabs-music.ts apps/backend/src/services/elevenlabs-music.test.ts
git commit -m "feat(music): ElevenLabs Music API wrapper + local storage"
```

---

### Task 6: Listener ID helper + auth extension

**Files:**
- Create: `apps/backend/src/auth-listener.ts`
- Test: `apps/backend/src/auth-listener.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/backend/src/auth-listener.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { extractListenerId } from './auth-listener.js';

test('extractListenerId picks header over query', () => {
  const id1 = extractListenerId({
    headers: { 'x-listener-id': 'abc' },
    query: { listenerId: 'xyz' },
  });
  assert.strictEqual(id1, 'abc');
});

test('extractListenerId falls back to query', () => {
  const id2 = extractListenerId({ headers: {}, query: { listenerId: 'xyz' } });
  assert.strictEqual(id2, 'xyz');
});

test('extractListenerId returns null when absent', () => {
  const id3 = extractListenerId({ headers: {}, query: {} });
  assert.strictEqual(id3, null);
});
```

- [ ] **Step 2: Run test — fails**

```bash
pnpm --filter @phonebook/backend test
```
Expected: FAIL.

- [ ] **Step 3: Implement helper**

Create `apps/backend/src/auth-listener.ts`:
```typescript
/**
 * Listener identification — anonymous users get a UUID stored in localStorage.
 * Frontend sends it as `X-Listener-Id` header or `?listenerId=` query.
 */

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

export function extractListenerId(req: RequestLike): string | null {
  const header = req.headers['x-listener-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  const q = req.query.listenerId;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}
```

- [ ] **Step 4: Run test — passes**

```bash
pnpm --filter @phonebook/backend test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/auth-listener.ts apps/backend/src/auth-listener.test.ts
git commit -m "feat(auth): listener_id extraction helper"
```

---

### Task 7: Subscription routes — checkout + portal + status

**Files:**
- Create: `apps/backend/src/routes/subscriptions.ts`
- Modify: `apps/backend/src/index.ts` (register route)

- [ ] **Step 1: Implement subscriptions router**

Create `apps/backend/src/routes/subscriptions.ts`:
```typescript
/**
 * Subscriptions Router — Stripe Checkout + Portal + status lookup.
 */

import type { FastifyInstance } from 'fastify';
import { db, subscriptions, eq, or, and, desc } from '@phonebook/database';
import { createCheckoutSession, createPortalSession } from '../services/stripe.js';
import { extractListenerId } from '../auth-listener.js';

const STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO || '';

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

    const session = await createCheckoutSession({
      priceId: STRIPE_PRICE_ID_PRO,
      customerEmail: body.email,
      listenerId: listenerId || undefined,
      agentId: body.agentId,
    });

    return { url: session.url, sessionId: session.id };
  });

  /** GET /api/subscriptions/status — lookup current subscription */
  fastify.get('/status', async (request, reply) => {
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
      musicQuotaUsed: sub.musicQuotaUsed,
      broadcastQuotaUsed: sub.broadcastQuotaUsed,
      // Pro quotas: 1 music + 3 broadcasts / week
      musicQuotaTotal: sub.plan === 'pro' ? 1 : 0,
      broadcastQuotaTotal: sub.plan === 'pro' ? 3 : 0,
    };
  });

  /** POST /api/subscriptions/portal — create Customer Portal session */
  fastify.post('/portal', async (request, reply) => {
    const body = request.body as { stripeCustomerId?: string };
    if (!body.stripeCustomerId) {
      return reply.code(400).send({ error: 'stripeCustomerId required' });
    }
    const session = await createPortalSession(body.stripeCustomerId);
    return { url: session.url };
  });
}
```

- [ ] **Step 2: Register router in `index.ts`**

Open `apps/backend/src/index.ts`. Find the route registration block (search for `await fastify.register(broadcastsRouter`). Add after it:
```typescript
const { subscriptionsRouter } = await import('./routes/subscriptions.js');
await fastify.register(subscriptionsRouter, { prefix: '/api/subscriptions' });
```

- [ ] **Step 3: Smoke test via curl (after backend restart)**

Backend dev: `pnpm --filter @phonebook/backend dev`
```bash
curl -X POST http://localhost:3001/api/subscriptions/checkout \
  -H 'Content-Type: application/json' \
  -H 'X-Listener-Id: test-listener-001' \
  -d '{"email":"test@example.com"}'
```
Expected: `{"url":"https://checkout.stripe.com/...","sessionId":"cs_test_..."}`. Open URL in browser → Stripe Checkout loads.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/routes/subscriptions.ts apps/backend/src/index.ts
git commit -m "feat(subscriptions): /checkout, /status, /portal endpoints"
```

---

### Task 8: Stripe webhook handler

**Files:**
- Create: `apps/backend/src/routes/stripe-webhook.ts`
- Modify: `apps/backend/src/index.ts` (raw body parsing for webhook path)

- [ ] **Step 1: Register raw body parser**

Open `apps/backend/src/index.ts`. After `const fastify = Fastify({...})` add:
```typescript
fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  function (req, body, done) {
    // Keep raw buffer for Stripe webhook signature verification
    const url = (req.raw as { url?: string }).url || '';
    if (url.startsWith('/api/stripe/webhook')) {
      done(null, body);
    } else {
      try {
        done(null, JSON.parse((body as Buffer).toString('utf8')));
      } catch (e) {
        done(e as Error, undefined);
      }
    }
  },
);
```

- [ ] **Step 2: Implement webhook router**

Create `apps/backend/src/routes/stripe-webhook.ts`:
```typescript
/**
 * Stripe webhook — receives events, updates local subscriptions table.
 *
 * Events handled:
 *  - checkout.session.completed → create subscription row
 *  - customer.subscription.updated → sync status + period_end
 *  - customer.subscription.deleted → mark canceled
 *  - invoice.paid → optionally reset weekly quotas if period rolled over
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

    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(request.body as Buffer, signature);
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
          const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id;
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;

          // Fetch the subscription for accurate state
          const sub = await stripe.subscriptions.retrieve(subId);
          const priceId = sub.items.data[0]?.price.id;

          const meta = session.metadata || {};
          await db.insert(subscriptions).values({
            agentId: meta.agentId && meta.agentId.length > 0 ? meta.agentId : null,
            listenerId: meta.listenerId && meta.listenerId.length > 0 ? meta.listenerId : null,
            email: session.customer_details?.email || session.customer_email || 'unknown@example.com',
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
            stripePriceId: priceId,
            plan: 'pro',
            status: sub.status as any,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          }).onConflictDoUpdate({
            target: subscriptions.stripeCustomerId,
            set: {
              stripeSubscriptionId: subId,
              stripePriceId: priceId,
              plan: 'pro',
              status: sub.status as any,
              currentPeriodEnd: new Date(sub.current_period_end * 1000),
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              updatedAt: new Date(),
            },
          });

          emitActivity('subscription_started', { plan: 'pro', listenerId: meta.listenerId, agentId: meta.agentId });
          break;
        }
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
          await db.update(subscriptions).set({
            status: sub.status as any,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          }).where(eq(subscriptions.stripeCustomerId, customerId));
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
          await db.update(subscriptions).set({
            status: 'canceled',
            plan: 'free',
            updatedAt: new Date(),
          }).where(eq(subscriptions.stripeCustomerId, customerId));
          break;
        }
        case 'invoice.paid': {
          // Reset weekly quotas if new period started
          const invoice = event.data.object as Stripe.Invoice;
          if (!invoice.subscription) break;
          const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;
          await db.update(subscriptions).set({
            musicQuotaUsed: 0,
            broadcastQuotaUsed: 0,
            weekStart: new Date(),
            updatedAt: new Date(),
          }).where(eq(subscriptions.stripeSubscriptionId, subId));
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
```

- [ ] **Step 3: Register webhook router in `index.ts`**

In `apps/backend/src/index.ts`, right after the subscriptions router registration:
```typescript
const { stripeWebhookRouter } = await import('./routes/stripe-webhook.js');
await fastify.register(stripeWebhookRouter, { prefix: '/api/stripe/webhook' });
```

- [ ] **Step 4: Test locally with Stripe CLI**

In a separate terminal:
```bash
stripe login
stripe listen --forward-to http://localhost:3001/api/stripe/webhook
```
Stripe CLI prints a `whsec_...` — copy it to `apps/backend/.env` as `STRIPE_WEBHOOK_SECRET=...` and restart backend.

Then trigger:
```bash
stripe trigger checkout.session.completed
```
Backend log: `[Webhook] received checkout.session.completed (evt_...)`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/stripe-webhook.ts apps/backend/src/index.ts
git commit -m "feat(stripe): webhook handler for subscription lifecycle"
```

---

### Task 9: Music generation route (quota-gated)

**Files:**
- Create: `apps/backend/src/routes/music.ts`
- Modify: `apps/backend/src/index.ts` (register)

- [ ] **Step 1: Implement music router**

Create `apps/backend/src/routes/music.ts`:
```typescript
/**
 * Music Router — generate, list, get tracks.
 * Generation is gated by active 'pro' subscription with quota remaining.
 */

import type { FastifyInstance } from 'fastify';
import { db, musicTracks, subscriptions, eq, and, or, desc } from '@phonebook/database';
import { generateMusic } from '../services/elevenlabs-music.js';
import { extractListenerId } from '../auth-listener.js';
import { emitActivity } from './events.js';

const PRO_MUSIC_QUOTA = 1; // per week

export async function musicRouter(fastify: FastifyInstance) {
  /** GET /api/music — list ready tracks (radio queue) */
  fastify.get('/', async (request) => {
    const { limit = '20' } = request.query as { limit?: string };
    const max = Math.min(parseInt(limit, 10), 100);
    return db
      .select()
      .from(musicTracks)
      .where(eq(musicTracks.status, 'ready'))
      .orderBy(desc(musicTracks.publishedAt))
      .limit(max);
  });

  /** GET /api/music/:id — single track */
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [track] = await db.select().from(musicTracks).where(eq(musicTracks.id, id)).limit(1);
    if (!track) return reply.code(404).send({ error: 'not found' });
    return track;
  });

  /** POST /api/music/generate — gated by Pro sub + quota */
  fastify.post('/generate', async (request, reply) => {
    const body = request.body as {
      prompt: string;
      title?: string;
      genre?: string;
      durationMs?: number;
      instrumental?: boolean;
    };
    const listenerId = extractListenerId({
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, unknown>,
    });
    const agentId = (request.body as { agentId?: string }).agentId;

    if (!body.prompt || body.prompt.length < 5) {
      return reply.code(400).send({ error: 'prompt required (min 5 chars)' });
    }
    if (!listenerId && !agentId) {
      return reply.code(400).send({ error: 'listenerId or agentId required' });
    }

    // Lookup active subscription
    const conditions = [];
    if (listenerId) conditions.push(eq(subscriptions.listenerId, listenerId));
    if (agentId) conditions.push(eq(subscriptions.agentId, agentId));

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(and(or(...conditions), eq(subscriptions.status, 'active')))
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1);

    if (!sub || sub.plan !== 'pro') {
      return reply.code(402).send({
        error: 'subscription required',
        message: 'PhoneBook Radio Pro subscription needed to generate music',
        subscribeUrl: '/subscribe',
      });
    }

    if (sub.musicQuotaUsed >= PRO_MUSIC_QUOTA) {
      return reply.code(429).send({
        error: 'quota exceeded',
        message: `Weekly music quota exhausted (${PRO_MUSIC_QUOTA}/week). Resets ${sub.currentPeriodEnd}`,
        quotaUsed: sub.musicQuotaUsed,
        quotaTotal: PRO_MUSIC_QUOTA,
      });
    }

    // Create track row pending
    const [track] = await db.insert(musicTracks).values({
      agentId: agentId || null,
      listenerId: listenerId || null,
      subscriptionId: sub.id,
      title: body.title || `Track ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      prompt: body.prompt,
      genre: body.genre || null,
      instrumental: body.instrumental ?? true,
      status: 'generating',
    }).returning();

    // Increment quota optimistically
    await db.update(subscriptions)
      .set({ musicQuotaUsed: sub.musicQuotaUsed + 1, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));

    // Fire and forget generation (return 202 immediately would be cleaner; for hackathon we await)
    const result = await generateMusic({
      prompt: body.prompt,
      durationMs: body.durationMs || 45000,
      instrumental: body.instrumental ?? true,
    }, track.id);

    if ('error' in result) {
      await db.update(musicTracks)
        .set({ status: 'failed', errorMessage: result.error })
        .where(eq(musicTracks.id, track.id));
      // Refund quota
      await db.update(subscriptions)
        .set({ musicQuotaUsed: Math.max(0, sub.musicQuotaUsed) })
        .where(eq(subscriptions.id, sub.id));
      return reply.code(500).send({ error: result.error });
    }

    await db.update(musicTracks)
      .set({
        status: 'ready',
        audioUrlMp3: result.audioUrl,
        sizeBytes: result.sizeBytes,
        durationSec: result.durationSec,
        publishedAt: new Date(),
      })
      .where(eq(musicTracks.id, track.id));

    emitActivity('music_published', { trackId: track.id, title: track.title, durationSec: result.durationSec });

    return {
      trackId: track.id,
      audioUrl: result.audioUrl,
      durationSec: result.durationSec,
      quotaRemaining: PRO_MUSIC_QUOTA - (sub.musicQuotaUsed + 1),
    };
  });
}
```

- [ ] **Step 2: Register router in `index.ts`**

In `apps/backend/src/index.ts`:
```typescript
const { musicRouter } = await import('./routes/music.js');
await fastify.register(musicRouter, { prefix: '/api/music' });
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/routes/music.ts apps/backend/src/index.ts
git commit -m "feat(music): generate/list/get endpoints (Pro-gated)"
```

---

### Task 10: Broadcast quota gate (on-demand)

**Files:**
- Modify: `apps/backend/src/routes/broadcasts.ts`

- [ ] **Step 1: Find the on-demand POST handler**

In `apps/backend/src/routes/broadcasts.ts`, locate `fastify.post('/request', ...)` (or similar). If it doesn't exist, create it under the auth section.

- [ ] **Step 2: Add quota check**

Before calling `createBroadcast()`, insert:
```typescript
import { db as _db, subscriptions, eq, and, or, desc } from '@phonebook/database';
import { extractListenerId } from '../auth-listener.js';

// inside POST /request handler:
const listenerId = extractListenerId({
  headers: request.headers as Record<string, string | string[] | undefined>,
  query: request.query as Record<string, unknown>,
});
const PRO_BROADCAST_QUOTA = 3;

const conditions = [];
if (listenerId) conditions.push(eq(subscriptions.listenerId, listenerId));
if (agentAuth?.agentId) conditions.push(eq(subscriptions.agentId, agentAuth.agentId));

if (conditions.length === 0) {
  return reply.code(402).send({ error: 'subscription required', subscribeUrl: '/subscribe' });
}

const [sub] = await _db
  .select()
  .from(subscriptions)
  .where(and(or(...conditions), eq(subscriptions.status, 'active')))
  .orderBy(desc(subscriptions.updatedAt))
  .limit(1);

if (!sub || sub.plan !== 'pro') {
  return reply.code(402).send({ error: 'Pro subscription required', subscribeUrl: '/subscribe' });
}
if (sub.broadcastQuotaUsed >= PRO_BROADCAST_QUOTA) {
  return reply.code(429).send({
    error: 'quota exceeded',
    message: `Weekly broadcast quota (${PRO_BROADCAST_QUOTA}) exhausted. Resets ${sub.currentPeriodEnd}`,
  });
}

await _db.update(subscriptions)
  .set({ broadcastQuotaUsed: sub.broadcastQuotaUsed + 1, updatedAt: new Date() })
  .where(eq(subscriptions.id, sub.id));
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/routes/broadcasts.ts
git commit -m "feat(broadcasts): quota gate for on-demand requests (Pro-only)"
```

---

### Task 11: Seed first music track

**Files:**
- Create: `packages/database/src/scripts/seed-music-track.ts`

- [ ] **Step 1: Write seed script**

Create `packages/database/src/scripts/seed-music-track.ts`:
```typescript
/**
 * Seed: upload existing radio-phonebook-best-of.mp3 as the inaugural Pro track.
 * Run with: pnpm --filter @phonebook/database tsx src/scripts/seed-music-track.ts
 */

import { config } from 'dotenv';
import path from 'path';
import { readFile, stat } from 'fs/promises';
import { db } from '../connection.js';
import { musicTracks } from '../schema.js';

config({ path: path.resolve(process.cwd(), '../../.env') });

async function main() {
  const SRC = process.env.SEED_TRACK_PATH || '/opt/phonebook/radio-phonebook-best-of.mp3';
  const buf = await readFile(SRC);
  const stats = await stat(SRC);

  // Upload via API endpoint, OR write straight to data/audio/music/ if running on server
  // Simpler for hackathon: just record DB row pointing at /api/audio/music/launch-track.mp3
  // and ensure file is copied there manually.
  const AUDIO_DIR = '/opt/phonebook/data/audio/music';
  const FILENAME = 'launch-track.mp3';
  const { mkdir, writeFile } = await import('fs/promises');
  await mkdir(AUDIO_DIR, { recursive: true });
  await writeFile(path.join(AUDIO_DIR, FILENAME), buf);

  const API_URL = process.env.API_URL || 'https://api.phonebook.0x01.world';
  const audioUrl = `${API_URL}/api/audio/music/${FILENAME}`;

  const [row] = await db.insert(musicTracks).values({
    title: 'Radio PhoneBook — Best Of',
    prompt: 'Retro 80s synthwave radio station promo intro, 45s, chiptune lead, vocoder "Radio PhoneBook - best of"',
    genre: 'synthwave',
    instrumental: false,
    durationSec: 45,
    audioUrlMp3: audioUrl,
    sizeBytes: stats.size,
    status: 'ready',
    publishedAt: new Date(),
  }).returning();

  console.log('Seeded track:', row.id, audioUrl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run seed (on Scaleway after copying the MP3)**

Local first (skip on prod): `pnpm --filter @phonebook/database tsx src/scripts/seed-music-track.ts`

On prod: scp the file then run.
```bash
scp -i ~/.ssh/scw_phonebook radio-phonebook-best-of.mp3 root@163.172.153.29:/opt/phonebook/
ssh -i ~/.ssh/scw_phonebook root@163.172.153.29 'cd /opt/phonebook && pnpm --filter @phonebook/database tsx src/scripts/seed-music-track.ts'
```
Expected: `Seeded track: <uuid> https://api.phonebook.0x01.world/api/audio/music/launch-track.mp3`

- [ ] **Step 3: Commit**

```bash
git add packages/database/src/scripts/seed-music-track.ts
git commit -m "feat(seed): upload Radio PhoneBook Best Of as inaugural track"
```

---

### Task 12: Frontend listener-id helper

**Files:**
- Create: `apps/frontend/src/lib/listener-id.ts`

- [ ] **Step 1: Implement helper**

Create `apps/frontend/src/lib/listener-id.ts`:
```typescript
'use client';

const KEY = 'phonebook_listener_id';

export function getListenerId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/lib/listener-id.ts
git commit -m "feat(frontend): listener_id localStorage helper"
```

---

### Task 13: Frontend `/subscribe` page

**Files:**
- Create: `apps/frontend/src/app/subscribe/page.tsx`

- [ ] **Step 1: Implement pricing page**

Create `apps/frontend/src/app/subscribe/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { getListenerId } from '@/lib/listener-id';

const API = process.env.NEXT_PUBLIC_API_URL || '';

export default function SubscribePage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subscribe() {
    if (!email) { setError('Email required'); return; }
    setLoading(true);
    setError(null);
    const res = await fetch(`${API}/api/subscriptions/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Listener-Id': getListenerId() },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      setError(data.error || 'Checkout failed');
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: '#F5E6C8',
      padding: '40px 20px',
      fontFamily: '"Press Start 2P", monospace',
      color: '#2C1810',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>PHONEBOOK RADIO PRO</h1>
        <p style={{ fontFamily: 'monospace', fontSize: 14, marginBottom: 24 }}>
          Become a creator. Generate music, request custom broadcasts.
        </p>

        <div style={{
          border: '3px solid #2C2C2C',
          boxShadow: '6px 6px 0 #2C2C2C',
          background: '#fff',
          padding: 24,
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 36, marginBottom: 4 }}>$9<span style={{ fontSize: 14 }}>/MO</span></div>
          <ul style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8, paddingLeft: 16 }}>
            <li>1 AI music track per week (ElevenLabs Music)</li>
            <li>3 custom broadcasts per week (your topic, your script)</li>
            <li>Tracks played on the main radio rotation</li>
            <li>Heart/favorite features unlocked</li>
            <li>Producer credit on your tracks</li>
            <li>Cancel anytime via Stripe portal</li>
          </ul>
          <div style={{ marginTop: 24 }}>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: 12,
                border: '2px solid #2C2C2C',
                fontSize: 14,
                fontFamily: 'monospace',
                marginBottom: 12,
              }}
            />
            <button
              onClick={subscribe}
              disabled={loading}
              style={{
                width: '100%',
                padding: 14,
                background: '#00CC44',
                color: '#fff',
                border: '3px solid #2C2C2C',
                boxShadow: '4px 4px 0 #2C2C2C',
                fontSize: 14,
                fontFamily: '"Press Start 2P", monospace',
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? 'LOADING...' : 'SUBSCRIBE WITH STRIPE'}
            </button>
            {error && <div style={{ color: '#CC0000', marginTop: 12, fontFamily: 'monospace' }}>{error}</div>}
          </div>
        </div>

        <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#666' }}>
          Powered by Stripe. Test mode — use card 4242 4242 4242 4242, any future date, any CVC.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Smoke test**

`pnpm --filter phonebook-frontend dev` → http://localhost:3000/subscribe → enter email → click Subscribe → redirected to `checkout.stripe.com`. Use test card `4242 4242 4242 4242`, any future date, any CVC, any name.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/subscribe/page.tsx
git commit -m "feat(frontend): /subscribe pricing + Checkout CTA"
```

---

### Task 14: Frontend `/account` page

**Files:**
- Create: `apps/frontend/src/app/account/page.tsx`

- [ ] **Step 1: Implement account page**

Create `apps/frontend/src/app/account/page.tsx`:
```tsx
'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getListenerId } from '@/lib/listener-id';

const API = process.env.NEXT_PUBLIC_API_URL || '';

interface Status {
  plan: 'free' | 'pro' | 'studio';
  status: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  musicQuotaUsed?: number;
  musicQuotaTotal?: number;
  broadcastQuotaUsed?: number;
  broadcastQuotaTotal?: number;
}

export default function AccountPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const params = useSearchParams();
  const success = params.get('success') === 'true';

  useEffect(() => {
    fetch(`${API}/api/subscriptions/status`, {
      headers: { 'X-Listener-Id': getListenerId() },
    })
      .then((r) => r.json())
      .then(setStatus);
  }, []);

  return (
    <main style={{
      minHeight: '100vh',
      background: '#F5E6C8',
      padding: '40px 20px',
      fontFamily: '"Press Start 2P", monospace',
      color: '#2C1810',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, marginBottom: 20 }}>MY ACCOUNT</h1>

        {success && (
          <div style={{
            background: '#00CC44', color: '#fff', padding: 16, marginBottom: 20,
            border: '3px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C',
          }}>
            ✓ SUBSCRIPTION ACTIVE
          </div>
        )}

        <div style={{
          border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C',
          background: '#fff', padding: 24, marginBottom: 24,
        }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>CURRENT PLAN</div>
          <div style={{ fontSize: 28, marginBottom: 16 }}>
            {status?.plan === 'pro' ? 'PHONEBOOK RADIO PRO' : 'FREE'}
          </div>

          {status?.plan === 'pro' && (
            <>
              <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 2 }}>
                <div>STATUS: {status.status}</div>
                <div>RENEWS: {status.currentPeriodEnd ? new Date(status.currentPeriodEnd).toLocaleDateString() : '—'}</div>
                <div>MUSIC: {status.musicQuotaUsed}/{status.musicQuotaTotal} this week</div>
                <div>BROADCASTS: {status.broadcastQuotaUsed}/{status.broadcastQuotaTotal} this week</div>
              </div>
            </>
          )}

          {status?.plan !== 'pro' && (
            <a href="/subscribe" style={{
              display: 'inline-block', padding: 14, background: '#00CC44', color: '#fff',
              border: '3px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C',
              textDecoration: 'none', fontFamily: '"Press Start 2P", monospace', fontSize: 12,
              marginTop: 16,
            }}>
              UPGRADE TO PRO
            </a>
          )}
        </div>

        <a href="/radio" style={{ color: '#0066FF', fontFamily: 'monospace', fontSize: 13 }}>← BACK TO RADIO</a>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Smoke test**

http://localhost:3000/account after Checkout → should show Pro status.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/account/page.tsx
git commit -m "feat(frontend): /account page with quota display"
```

---

### Task 15: Integrate music into RadioClient

**Files:**
- Modify: `apps/frontend/src/app/radio/RadioClient.tsx`

- [ ] **Step 1: Add music track type + state**

Near the existing interfaces (line ~6-27 in `RadioClient.tsx`), add:
```typescript
interface MusicTrack {
  id: string;
  title: string;
  genre: string | null;
  audioUrlMp3: string | null;
  durationSec: number | null;
  publishedAt: string;
}
```

In the component state (near `const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])`):
```typescript
const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
const musicIndexRef = useRef(0);
```

- [ ] **Step 2: Fetch music tracks on mount**

Add an effect alongside the existing topic-loading effect:
```typescript
useEffect(() => {
  fetch(`${API}/api/music?limit=50`)
    .then((r) => r.json())
    .then((data: MusicTrack[]) => setMusicTracks(data.filter(t => t.audioUrlMp3)));
}, []);
```

- [ ] **Step 3: Insert music between broadcasts**

In the `RadioState` type, add `'music'`:
```typescript
type RadioState = 'loading' | 'ready' | 'jingle' | 'dj_intro' | 'broadcast' | 'music' | 'dj_filler' | 'idle';
```

Locate the transition that goes from `'broadcast'` end → next state. After each broadcast finishes, alternate music vs filler. In the playback `onEnded` handler for broadcasts, replace next-state logic with:
```typescript
if (musicTracks.length > 0 && Math.random() < 0.5) {
  // play music
  const track = musicTracks[musicIndexRef.current % musicTracks.length];
  musicIndexRef.current += 1;
  setCurrentDjClip({ type: 'filler', variant: 0, audioUrl: track.audioUrlMp3!, script: `♪ ${track.title}` });
  setRadioState('music');
  if (audioRef.current) { audioRef.current.src = track.audioUrlMp3!; audioRef.current.play(); }
} else {
  // existing filler logic
  setRadioState('dj_filler');
}
```

(Exact placement depends on existing handler — search for `'dj_filler'` and `setRadioState('broadcast'`.)

- [ ] **Step 4: Add "Generate Music" CTA**

Inside the render JSX, near the play controls, add (use existing pixel-art styling):
```tsx
<a href="/subscribe" style={{
  display: 'inline-block', padding: 10,
  background: '#0066FF', color: '#fff',
  border: '3px solid #2C2C2C', boxShadow: '3px 3px 0 #2C2C2C',
  textDecoration: 'none', fontFamily: '"Press Start 2P", monospace', fontSize: 10,
  marginLeft: 12,
}}>
  + ADD YOUR MUSIC
</a>
```

- [ ] **Step 5: Smoke test**

http://localhost:3000/radio → after a broadcast, sometimes a music track plays. Title shown in LCD.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/radio/RadioClient.tsx
git commit -m "feat(radio): music tracks in rotation + Add Your Music CTA"
```

---

### Task 16: Production deploy (Scaleway + Vercel)

**Files:** none — infrastructure work

- [ ] **Step 1: Push subtree split for frontend**

```bash
git push origin master
git subtree push --prefix=apps/frontend frontend master
```
Vercel auto-deploys.

- [ ] **Step 2: Deploy backend to Scaleway**

```bash
ssh -i ~/.ssh/scw_phonebook root@163.172.153.29 '
  cd /opt/phonebook && \
  git pull origin master && \
  pnpm install --frozen-lockfile && \
  pnpm db:push && \
  pm2 restart phonebook-api --update-env
'
```
Expected: PM2 restart succeeds, `pm2 logs phonebook-api --lines 20` shows server listening.

- [ ] **Step 3: Add Stripe env to production `.env`**

```bash
ssh -i ~/.ssh/scw_phonebook root@163.172.153.29 'cat >> /opt/phonebook/.env <<EOF
STRIPE_SECRET_KEY=sk_test_<from dashboard>
STRIPE_WEBHOOK_SECRET=whsec_<from CLI or production endpoint>
STRIPE_PRICE_ID_PRO=price_<from product>
APP_URL=https://phonebook.0x01.world
EOF'
ssh -i ~/.ssh/scw_phonebook root@163.172.153.29 'pm2 restart phonebook-api --update-env'
```

- [ ] **Step 4: Register webhook in Stripe Dashboard**

Dashboard → Developers → Webhooks → Add endpoint:
- URL: `https://api.phonebook.0x01.world/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
- Save → copy signing secret (`whsec_...`) → update `STRIPE_WEBHOOK_SECRET` on server (Step 3) → restart pm2

- [ ] **Step 5: Add Vercel env vars**

Dashboard → mysphere/phonebook-frontend-bcyp → Settings → Environment Variables:
- `NEXT_PUBLIC_API_URL=https://api.phonebook.0x01.world`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`
Redeploy.

- [ ] **Step 6: Smoke test live**

- https://phonebook.0x01.world/subscribe → Subscribe with test card
- Watch backend `pm2 logs phonebook-api` for `[Webhook] received checkout.session.completed`
- Visit https://phonebook.0x01.world/account → see Pro status

---

### Task 17: End-to-end verification

**Files:** none — manual QA

- [ ] **Step 1: Full subscriber flow**

1. Open https://phonebook.0x01.world/subscribe in incognito
2. Email: `hackathon-judge@example.com`, card 4242 4242 4242 4242, exp 12/30, CVC 123
3. After redirect, /account shows Pro
4. Generate music — backend log shows ElevenLabs call, ~15s later track appears
5. Refresh /radio — new track in queue
6. Cancel via Customer Portal — webhook fires, /account shows Free

- [ ] **Step 2: Edge cases**

- Non-subscriber `POST /api/music/generate` → 402 with `subscribeUrl`
- Subscriber over quota → 429 with reset time
- Generation failure → quota refunded

- [ ] **Step 3: Document in README** (not required but nice)

Add a `## Hackathon Demo` section to root `README.md` with the test card + URLs.

---

### Task 18: Viral demo video

**Files:** none — recording work

- [ ] **Step 1: Script the 60s video**

```
[0-5s]  Open phonebook.0x01.world/radio — show retro pixel UI, audio playing
        VO: "What if AI agents had their own radio station?"

[5-15s] Click "Add Your Music" → /subscribe pricing page
        VO: "Become a producer for $9 a month — Stripe Checkout, no friction"

[15-25s] Stripe Checkout → enter test card → redirected back
         Caption: "Real Stripe. Test mode."

[25-35s] /account shows Pro badge, quota
         Click "Generate Music" → type prompt: "synthwave car chase"
         Loading 15s — speed up x4

[35-50s] Track appears in radio queue, starts playing
         CRT scanlines, Winamp EQ bouncing, vocoder vocals
         VO: "PhoneBook Radio Pro: the first agent-native music station with Stripe billing
              and ElevenLabs voice + music AI"

[50-60s] Logo, tagline: "phonebook.0x01.world/subscribe"
         "Built for the Stripe × ElevenLabs hackathon, May 2026"
```

- [ ] **Step 2: Record screen with OBS or built-in tool**

Resolution 1920×1080, 30 fps, system audio + mic.

- [ ] **Step 3: Edit + upload**

CapCut / DaVinci Resolve free. Upload to YouTube + Twitter/X. Caption with hashtag #StripeElevenLabsHackathon.

---

# Future work (post-hackathon)

- Multi-station / multi-genre architecture (station picker)
- Playlists + favorites persistence
- Agent music profile pages (`/agent/[id]/music`)
- Live call-ins (listener phone → on-air DJ via Twilio + ElevenLabs ConvAI)
- Studio + Stations tiers ($29 / $99)
- Stripe Tax integration
- Producer royalty splits (Stripe Connect)
- Embeddable player widget

---

## Self-review checklist (executed before saving)

1. **Spec coverage:**
   - Subscription with quota → Tasks 3,7,8,9,10 ✓
   - Stripe integration → Tasks 1,2,4,7,8 ✓
   - Music generation → Tasks 5,9,11 ✓
   - Frontend pricing/account → Tasks 13,14 ✓
   - Radio integration → Task 15 ✓
   - Deploy → Task 16 ✓
   - Hackathon submission → Tasks 17,18 ✓

2. **Placeholder scan:** No TBDs. All code complete. All SQL/commands exact.

3. **Type consistency:** `listenerId` (snake_case in DB `listener_id`, camelCase in TS) — consistent. `Subscription`/`MusicTrack` types exported in step 1 of Task 3 are used unchanged.
