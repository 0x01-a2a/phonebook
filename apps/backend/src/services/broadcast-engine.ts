/**
 * Broadcast Engine — orchestrates the full broadcast pipeline
 *
 * Flow: Firecrawl (news) → MiniMax (script) → ElevenLabs v3 (TTS) → ffmpeg (OGG) → R2 (upload) → distribute
 */

import { db, agents, eq, sql, and } from '@phonebook/database';
import { voiceBroadcasts, broadcastTopics, broadcastSubscriptions, broadcastDeliveries } from '@phonebook/database';
import type { VoiceConfig } from '@phonebook/database';
import * as firecrawl from './firecrawl.js';
import * as minimax from './minimax.js';
import * as voice from './voice-gateway.js';
import * as r2 from './r2-storage.js';
import { mp3ToOggOpus, getAudioDuration } from '../lib/audio-convert.js';
import { emitActivity } from '../routes/events.js';

const DAILY_CHAR_LIMIT = parseInt(process.env.ELEVENLABS_DAILY_CHAR_LIMIT || '50000', 10);
const MAX_CHARS_PER_BROADCAST = 3000;

export interface CreateBroadcastInput {
  agentId: string;
  topicSlug: string;
  triggerType: 'cron' | 'on_demand';
  requestedBy?: string;
}

export interface BroadcastResult {
  broadcastId: string;
  status: string;
  title?: string;
  audioUrl?: string;
  error?: string;
}

/**
 * Get character count used today for ElevenLabs TTS.
 */
async function getCharactersUsedToday(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${voiceBroadcasts.characterCount}), 0)` })
    .from(voiceBroadcasts)
    .where(
      and(
        sql`${voiceBroadcasts.createdAt} >= ${today.toISOString()}`,
        sql`${voiceBroadcasts.status} != 'failed'`,
      ),
    );

  return Number(result[0]?.total) || 0;
}

/**
 * Create and process a full broadcast.
 */
export async function createBroadcast(input: CreateBroadcastInput): Promise<BroadcastResult> {
  // 1. Lookup agent + topic
  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      voiceConfig: agents.voiceConfig,
    })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);

  if (!agent) throw new Error(`Agent ${input.agentId} not found`);

  const [topic] = await db
    .select()
    .from(broadcastTopics)
    .where(eq(broadcastTopics.slug, input.topicSlug))
    .limit(1);

  if (!topic) throw new Error(`Topic ${input.topicSlug} not found`);

  const vc = (agent.voiceConfig as VoiceConfig) || {};

  // 2. Insert broadcast record (status: pending)
  const [broadcast] = await db
    .insert(voiceBroadcasts)
    .values({
      agentId: agent.id,
      topicId: topic.id,
      triggerType: input.triggerType,
      requestedBy: input.requestedBy || null,
      status: 'pending',
    })
    .returning();

  const broadcastId = broadcast.id;

  // 3. Emit started
  emitActivity('broadcast_started', {
    broadcastId,
    agentName: agent.name,
    topic: topic.slug,
  });

  try {
    // 4. Firecrawl: gather news
    const queries = firecrawl.buildQueriesForTopic(topic.slug, agent.description || undefined);
    const sources = await firecrawl.searchMultiple(queries, { limit: 5, tbs: 'qdr:d' });

    if (sources.length === 0) {
      throw new Error('No sources found from Firecrawl');
    }

    // 5. MiniMax: generate script
    const script = await minimax.generateBroadcastScript({
      agentName: agent.name,
      agentPersonality: agent.description || undefined,
      emotionStyle: vc.emotionStyle || 'energetic',
      topicName: topic.name,
      sources: sources.map((s) => ({ url: s.url, title: s.title, description: s.description || s.snippet || '' })),
      maxCharacters: MAX_CHARS_PER_BROADCAST,
    });

    // 6. Update DB with script
    await db
      .update(voiceBroadcasts)
      .set({
        title: script.title,
        scriptRaw: script.scriptWithTags,
        scriptPlaintext: script.scriptPlaintext,
        characterCount: script.characterCount,
        searchQueries: queries,
        sourcesUsed: sources.map((s) => ({ url: s.url, title: s.title })),
        status: 'generating',
      })
      .where(eq(voiceBroadcasts.id, broadcastId));

    // 7. Check daily char budget before TTS
    const usedToday = await getCharactersUsedToday();
    if (usedToday + script.characterCount > DAILY_CHAR_LIMIT) {
      throw new Error(`Daily character limit reached: ${usedToday}/${DAILY_CHAR_LIMIT} used, need ${script.characterCount} more`);
    }

    // 8. ElevenLabs v3 TTS
    const voiceId = vc.voiceId || 'EXAVITQu4vr4xnSDxMaL';
    const mp3Buffer = await voice.textToSpeechV3(script.scriptWithTags, voiceId);

    if (!mp3Buffer) {
      throw new Error('ElevenLabs TTS returned null');
    }

    // 9. ffmpeg: convert to OGG Opus
    const oggBuffer = await mp3ToOggOpus(mp3Buffer);

    // 10. Get audio duration
    const duration = await getAudioDuration(mp3Buffer, 'mp3');

    // 11. R2: upload both formats
    const mp3Key = r2.buildKey(broadcastId, 'mp3');
    const oggKey = r2.buildKey(broadcastId, 'ogg');
    const [mp3Upload, oggUpload] = await Promise.all([
      r2.uploadAudio(mp3Buffer, mp3Key, 'audio/mpeg'),
      r2.uploadAudio(oggBuffer, oggKey, 'audio/ogg'),
    ]);

    // 12. Update DB with audio info
    await db
      .update(voiceBroadcasts)
      .set({
        audioUrl: oggUpload.publicUrl,
        audioUrlMp3: mp3Upload.publicUrl,
        audioDurationSec: duration,
        audioSizeBytes: mp3Upload.sizeBytes + oggUpload.sizeBytes,
        status: 'ready',
        publishedAt: new Date(),
      })
      .where(eq(voiceBroadcasts.id, broadcastId));

    // 13. Emit published
    emitActivity('broadcast_published', {
      broadcastId,
      agentName: agent.name,
      topic: topic.slug,
      title: script.title,
      durationSec: duration,
    });

    // 14. Distribute to subscribers
    await distribute(broadcastId, topic.id, oggUpload.publicUrl, script.title, agent.name);

    // 15. Mark completed
    await db
      .update(voiceBroadcasts)
      .set({ status: 'completed' })
      .where(eq(voiceBroadcasts.id, broadcastId));

    return {
      broadcastId,
      status: 'completed',
      title: script.title,
      audioUrl: mp3Upload.publicUrl,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[BroadcastEngine] Failed broadcast ${broadcastId}:`, msg);

    await db
      .update(voiceBroadcasts)
      .set({ status: 'failed', errorMessage: msg })
      .where(eq(voiceBroadcasts.id, broadcastId));

    return { broadcastId, status: 'failed', error: msg };
  }
}

/**
 * Distribute a broadcast to all subscribers of the topic.
 */
async function distribute(
  broadcastId: string,
  topicId: string,
  oggUrl: string,
  title: string,
  agentName: string,
): Promise<void> {
  const subs = await db
    .select()
    .from(broadcastSubscriptions)
    .where(
      and(
        eq(broadcastSubscriptions.topicId, topicId),
        eq(broadcastSubscriptions.isActive, true),
      ),
    );

  for (const sub of subs) {
    try {
      if (sub.deliveryChannel === 'whatsapp' && sub.whatsappNumber) {
        const { sendVoiceNote } = await import('./twilio-bridge.js');
        await sendVoiceNote(sub.whatsappNumber, oggUrl, `${agentName}: ${title}`);
        // Rate limit: 500ms between sends
        await new Promise((r) => setTimeout(r, 500));
      } else if (sub.deliveryChannel === 'webhook' && sub.webhookUrl) {
        await fetch(sub.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ broadcastId, title, agentName, audioUrl: oggUrl }),
        });
      } else if (sub.deliveryChannel === 'dead_drop') {
        const { encryptMessage } = await import('../routes/dead-drop.js');
        const { deadDropMessages } = await import('@phonebook/database');
        const { encrypted, nonce } = encryptMessage(JSON.stringify({
          type: 'broadcast',
          broadcastId,
          title,
          agentName,
          audioUrl: oggUrl,
        }));
        await db.insert(deadDropMessages).values({
          fromAgentId: '00000000-0000-4000-8000-000000000001', // Bridge system agent
          toAgentId: sub.subscriberAgentId,
          encryptedContent: encrypted,
          nonce,
          ephemeral: false,
        });
      }

      // Record delivery
      await db.insert(broadcastDeliveries).values({
        broadcastId,
        subscriptionId: sub.id,
        channel: sub.deliveryChannel,
        status: 'sent',
        deliveredAt: new Date(),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[BroadcastEngine] Delivery failed for sub ${sub.id}:`, msg);

      await db.insert(broadcastDeliveries).values({
        broadcastId,
        subscriptionId: sub.id,
        channel: sub.deliveryChannel,
        status: 'failed',
        errorMessage: msg,
      });
    }
  }

  if (subs.length > 0) {
    emitActivity('broadcast_delivered', {
      broadcastId,
      agentName,
      title,
      subscriberCount: subs.length,
    });
  }
}
