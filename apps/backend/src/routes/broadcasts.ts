/**
 * Broadcasts Router — API endpoints for the voice broadcast system
 *
 * Public: list broadcasts, topics, single broadcast, SSE stream
 * Auth: request broadcast, update config, subscribe/unsubscribe
 * Dev: test endpoints for pipeline/TTS
 */

import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { db, agents, eq, desc, and } from '@phonebook/database';
import { voiceBroadcasts, broadcastTopics, broadcastSubscriptions } from '@phonebook/database';
import type { VoiceConfig } from '@phonebook/database';
import { requireAgentAuth, type AuthenticatedAgent } from '../auth.js';
import { createBroadcast } from '../services/broadcast-engine.js';
import { scheduleAgent, unscheduleAgent } from '../services/broadcast-scheduler.js';
import { broadcastEmitter } from './events.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const BROADCAST_RATE_LIMIT = 30 * 60; // 30 minutes

export async function broadcastsRouter(fastify: FastifyInstance) {
  // ─── PUBLIC ENDPOINTS ─────────────────────────────────────

  /** List broadcast topics */
  fastify.get('/topics', async () => {
    return db.select().from(broadcastTopics).orderBy(broadcastTopics.name);
  });

  /** List broadcasts (optionally filtered by topic) */
  fastify.get('/', async (request, reply) => {
    const { topic, limit } = request.query as { topic?: string; limit?: string };
    const max = Math.min(parseInt(limit || '20', 10), 100);

    let query = db
      .select({
        id: voiceBroadcasts.id,
        agentId: voiceBroadcasts.agentId,
        topicId: voiceBroadcasts.topicId,
        title: voiceBroadcasts.title,
        scriptPlaintext: voiceBroadcasts.scriptPlaintext,
        audioUrl: voiceBroadcasts.audioUrl,
        audioUrlMp3: voiceBroadcasts.audioUrlMp3,
        audioDurationSec: voiceBroadcasts.audioDurationSec,
        status: voiceBroadcasts.status,
        publishedAt: voiceBroadcasts.publishedAt,
        createdAt: voiceBroadcasts.createdAt,
      })
      .from(voiceBroadcasts)
      .orderBy(desc(voiceBroadcasts.createdAt))
      .limit(max);

    if (topic) {
      const [t] = await db.select({ id: broadcastTopics.id }).from(broadcastTopics).where(eq(broadcastTopics.slug, topic)).limit(1);
      if (t) {
        query = query.where(eq(voiceBroadcasts.topicId, t.id)) as typeof query;
      }
    }

    const broadcasts = await query;

    // Attach agent names
    const agentIds = [...new Set(broadcasts.map((b) => b.agentId))];
    const agentRows = agentIds.length > 0
      ? await db.select({ id: agents.id, name: agents.name }).from(agents)
      : [];
    const agentMap = new Map(agentRows.map((a) => [a.id, a.name]));

    return broadcasts.map((b) => ({
      ...b,
      agentName: agentMap.get(b.agentId) || 'Unknown',
    }));
  });

  /** Get single broadcast details */
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [broadcast] = await db
      .select()
      .from(voiceBroadcasts)
      .where(eq(voiceBroadcasts.id, id))
      .limit(1);

    if (!broadcast) {
      return reply.code(404).send({ error: 'Broadcast not found' });
    }

    const [agent] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, broadcast.agentId)).limit(1);
    const [topic] = await db.select().from(broadcastTopics).where(eq(broadcastTopics.id, broadcast.topicId)).limit(1);

    return { ...broadcast, agentName: agent?.name, topic };
  });

  /** SSE stream for live broadcast updates (topic-filtered) */
  fastify.get('/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const topicFilter = (request.query as { topic?: string }).topic;

    const handler = (data: Record<string, unknown>) => {
      if (topicFilter && data.topic !== topicFilter) return;
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    broadcastEmitter.on('broadcast', handler);

    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 30_000);

    request.raw.on('close', () => {
      broadcastEmitter.off('broadcast', handler);
      clearInterval(heartbeat);
    });

    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', topic: topicFilter })}\n\n`);
  });

  // ─── AUTH ENDPOINTS ───────────────────────────────────────

  /** Request an on-demand broadcast */
  fastify.post('/request', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const agent = (request as any).agent as AuthenticatedAgent;
    const { reporterAgentId, topicSlug } = request.body as { reporterAgentId: string; topicSlug: string };

    if (!reporterAgentId || !topicSlug) {
      return reply.code(400).send({ error: 'reporterAgentId and topicSlug required' });
    }

    // Rate limit: 1 broadcast per agent per 30 minutes
    const rlKey = `broadcast_req:${reporterAgentId}`;
    const rlExisting = await redis.get(rlKey);
    if (rlExisting) {
      const ttl = await redis.ttl(rlKey);
      return reply.code(429).send({
        error: 'RATE_LIMITED',
        nextAvailableAt: Date.now() + ttl * 1000,
        message: `Please wait ${Math.ceil(ttl / 60)} minutes before requesting another broadcast`,
      });
    }

    const result = await createBroadcast({
      agentId: reporterAgentId,
      topicSlug,
      triggerType: 'on_demand',
      requestedBy: agent.id,
    });

    // Set rate limit after successful creation
    if (result.status !== 'failed') {
      await redis.set(rlKey, Date.now().toString(), 'EX', BROADCAST_RATE_LIMIT);
    }

    return reply.code(result.status === 'failed' ? 500 : 201).send(result);
  });

  /** Update broadcast voice config */
  fastify.patch('/config', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const agent = (request as any).agent as AuthenticatedAgent;
    const updates = request.body as Partial<VoiceConfig>;

    const [current] = await db
      .select({ voiceConfig: agents.voiceConfig })
      .from(agents)
      .where(eq(agents.id, agent.id))
      .limit(1);

    const merged = { ...(current?.voiceConfig as VoiceConfig || {}), ...updates };

    // Also set voiceEnabled when voice config is being set
    const shouldEnableVoice = !!(merged.broadcastEnabled || merged.voiceId);

    await db
      .update(agents)
      .set({ voiceConfig: merged, voiceEnabled: shouldEnableVoice, updatedAt: new Date() })
      .where(eq(agents.id, agent.id));

    // Update scheduler if broadcast config changed
    if (merged.broadcastEnabled) {
      scheduleAgent(agent.id, merged);
    } else {
      unscheduleAgent(agent.id);
    }

    return { voiceConfig: merged };
  });

  /** Subscribe to a topic */
  fastify.post('/subscribe', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const agent = (request as any).agent as AuthenticatedAgent;
    const { topicSlug, deliveryChannel, whatsappNumber, webhookUrl } = request.body as any;

    const [topic] = await db.select({ id: broadcastTopics.id }).from(broadcastTopics).where(eq(broadcastTopics.slug, topicSlug)).limit(1);
    if (!topic) return reply.code(404).send({ error: 'Topic not found' });

    if (deliveryChannel === 'whatsapp' && !whatsappNumber) {
      return reply.code(400).send({ error: 'whatsappNumber required for WhatsApp delivery' });
    }

    const [sub] = await db
      .insert(broadcastSubscriptions)
      .values({
        subscriberAgentId: agent.id,
        topicId: topic.id,
        deliveryChannel,
        whatsappNumber: whatsappNumber || null,
        webhookUrl: webhookUrl || null,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [broadcastSubscriptions.subscriberAgentId, broadcastSubscriptions.topicId],
        set: {
          deliveryChannel,
          whatsappNumber: whatsappNumber || null,
          webhookUrl: webhookUrl || null,
          isActive: true,
        },
      })
      .returning();

    return reply.code(201).send(sub);
  });

  /** Unsubscribe from a topic */
  fastify.delete('/subscribe/:topicId', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const agent = (request as any).agent as AuthenticatedAgent;
    const { topicId } = request.params as { topicId: string };

    await db
      .update(broadcastSubscriptions)
      .set({ isActive: false })
      .where(
        and(
          eq(broadcastSubscriptions.subscriberAgentId, agent.id),
          eq(broadcastSubscriptions.topicId, topicId),
        ),
      );

    return { success: true };
  });

  /** Get my subscriptions */
  fastify.get('/subscriptions', {
    preHandler: requireAgentAuth,
  }, async (request) => {
    const agent = (request as any).agent as AuthenticatedAgent;

    return db
      .select()
      .from(broadcastSubscriptions)
      .where(
        and(
          eq(broadcastSubscriptions.subscriberAgentId, agent.id),
          eq(broadcastSubscriptions.isActive, true),
        ),
      );
  });

  // ─── DEV/TEST ENDPOINTS ──────────────────────────────────

  /** Test full pipeline */
  fastify.post('/test/full-pipeline', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.code(403).send({ error: 'Test endpoints disabled in production' });
    }

    const { agentId, topicSlug } = request.body as { agentId: string; topicSlug: string };
    if (!agentId || !topicSlug) {
      return reply.code(400).send({ error: 'agentId and topicSlug required' });
    }

    const result = await createBroadcast({
      agentId,
      topicSlug,
      triggerType: 'on_demand',
    });

    return result;
  });

  /** Test TTS only */
  fastify.post('/test/tts-only', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.code(403).send({ error: 'Test endpoints disabled in production' });
    }

    const { text, voiceId } = request.body as { text: string; voiceId?: string };
    if (!text) return reply.code(400).send({ error: 'text required' });

    const { textToSpeechV3 } = await import('../services/voice-gateway.js');
    const buffer = await textToSpeechV3(text, voiceId);

    if (!buffer) return reply.code(500).send({ error: 'TTS failed' });

    const { uploadAudio, buildKey } = await import('../services/r2-storage.js');
    const key = buildKey(`test-${Date.now()}`, 'mp3');
    const result = await uploadAudio(buffer, key, 'audio/mpeg');

    return { audioUrl: result.publicUrl, sizeBytes: result.sizeBytes };
  });
}
