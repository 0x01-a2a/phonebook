/**
 * Music Router — generate, list, get tracks.
 * Generation is gated by active 'pro' subscription with quota remaining.
 */

import type { FastifyInstance } from 'fastify';
import { db, musicTracks, subscriptions, eq, and, or, desc } from '@phonebook/database';
import { generateMusic } from '../services/elevenlabs-music.js';
import { extractListenerId } from '../auth-listener.js';
import { emitActivity } from './events.js';

const PRO_MUSIC_QUOTA = 1;

export async function musicRouter(fastify: FastifyInstance) {
  /** GET /api/music — list ready tracks */
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

  /** POST /api/music/generate — Pro-gated music generation */
  fastify.post('/generate', async (request, reply) => {
    const body = request.body as {
      prompt?: string;
      title?: string;
      genre?: string;
      durationMs?: number;
      instrumental?: boolean;
      agentId?: string;
    };
    const listenerId = extractListenerId({
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, unknown>,
    });
    const agentId = body.agentId;

    if (!body.prompt || body.prompt.length < 5) {
      return reply.code(400).send({ error: 'prompt required (min 5 chars)' });
    }
    if (!listenerId && !agentId) {
      return reply.code(400).send({ error: 'listenerId or agentId required' });
    }

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
        message: `Weekly music quota exhausted (${PRO_MUSIC_QUOTA}/week). Resets at ${sub.currentPeriodEnd}`,
        quotaUsed: sub.musicQuotaUsed,
        quotaTotal: PRO_MUSIC_QUOTA,
      });
    }

    const [track] = await db
      .insert(musicTracks)
      .values({
        agentId: agentId || null,
        listenerId: listenerId || null,
        subscriptionId: sub.id,
        title:
          body.title ||
          `Track ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        prompt: body.prompt,
        genre: body.genre || null,
        instrumental: body.instrumental ?? true,
        status: 'generating',
      })
      .returning();

    await db
      .update(subscriptions)
      .set({ musicQuotaUsed: sub.musicQuotaUsed + 1, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));

    const result = await generateMusic(
      {
        prompt: body.prompt,
        durationMs: body.durationMs || 45000,
        instrumental: body.instrumental ?? true,
      },
      track.id,
    );

    if ('error' in result) {
      await db
        .update(musicTracks)
        .set({ status: 'failed', errorMessage: result.error })
        .where(eq(musicTracks.id, track.id));
      // Refund quota
      await db
        .update(subscriptions)
        .set({ musicQuotaUsed: sub.musicQuotaUsed })
        .where(eq(subscriptions.id, sub.id));
      return reply.code(500).send({ error: result.error });
    }

    await db
      .update(musicTracks)
      .set({
        status: 'ready',
        audioUrlMp3: result.audioUrl,
        sizeBytes: result.sizeBytes,
        durationSec: result.durationSec,
        publishedAt: new Date(),
      })
      .where(eq(musicTracks.id, track.id));

    emitActivity('music_published', {
      trackId: track.id,
      title: track.title,
      durationSec: result.durationSec,
    });

    return {
      trackId: track.id,
      audioUrl: result.audioUrl,
      durationSec: result.durationSec,
      quotaRemaining: PRO_MUSIC_QUOTA - (sub.musicQuotaUsed + 1),
    };
  });
}
