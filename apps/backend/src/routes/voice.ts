import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import * as voice from '../services/voice-gateway.js';
import * as firecrawl from '../services/firecrawl.js';
import { emitActivity } from './events.js';
import { db, agents, eq } from '@phonebook/database';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const RATE_LIMIT_WINDOW = 4 * 60 * 60; // 4 hours in seconds

export async function voiceRouter(fastify: FastifyInstance) {
  /**
   * ElevenLabs ConvAI tool webhook — real-time web search during voice calls.
   * ElevenLabs calls this when the agent decides to use the search_web tool.
   */
  fastify.post('/tools/search', async (request, reply) => {
    const { query } = request.body as { query?: string };

    if (!query) {
      return { results: 'No query provided.' };
    }

    console.log(`[VoiceTool] search_web called: "${query}"`);

    try {
      const results = await firecrawl.search(query, { limit: 5 });

      if (results.length === 0) {
        return { results: `No results found for "${query}".` };
      }

      const summary = results
        .map((r, i) => `[${i + 1}] ${r.title}: ${r.description || r.snippet || ''}`)
        .join('\n');

      console.log(`[VoiceTool] Returning ${results.length} results for "${query}"`);
      return { results: summary };
    } catch (err) {
      console.error('[VoiceTool] Search failed:', err);
      return { results: 'Search temporarily unavailable.' };
    }
  });
  /**
   * ElevenLabs ConvAI tool webhook — scrape a URL for full content during voice calls.
   * Follow-up to search_web: agent finds a URL, then scrapes it for details.
   */
  fastify.post('/tools/scrape', async (request, reply) => {
    const { url } = request.body as { url?: string };

    if (!url) {
      return { content: 'No URL provided.' };
    }

    console.log(`[VoiceTool] scrape_url called: "${url}"`);

    try {
      const result = await firecrawl.scrape(url, { maxLength: 3000 });

      if (!result) {
        return { content: `Could not scrape "${url}".` };
      }

      console.log(`[VoiceTool] Scraped ${result.title} (${result.markdown.length} chars)`);
      return { content: `# ${result.title}\n\n${result.markdown}` };
    } catch (err) {
      console.error('[VoiceTool] Scrape failed:', err);
      return { content: 'Scraping temporarily unavailable.' };
    }
  });

  fastify.post('/call', async (request, reply) => {
    const { phoneNumber, message } = request.body as {
      phoneNumber: string;
      message?: string;
    };

    if (!phoneNumber) {
      reply.code(400);
      return { error: 'phoneNumber is required' };
    }

    const result = await voice.callAgent({ phoneNumber, message });

    if (result.success) {
      emitActivity('wake_triggered', {
        agentId: result.agentId,
        agentName: result.agentName,
        wakeType: 'voice',
      });
    }

    return result;
  });

  fastify.get('/lookup', async (request, reply) => {
    const { number } = request.query as { number: string };

    if (!number) {
      reply.code(400);
      return { error: 'number query parameter is required' };
    }

    const agent = await voice.resolveByPhoneNumber(number);
    if (!agent) {
      reply.code(404);
      return { error: 'Phone number not found' };
    }

    return agent;
  });

  /**
   * Get the ElevenLabs agent ID for browser-based calling.
   * Creates the ElevenLabs agent if it doesn't exist yet (lazy creation).
   *
   * Rate limiting (non-owners only):
   * - 60s max per call, 1 call per 4 hours
   * - Tracked by callerId (localStorage UUID) + IP (double-key)
   * - Owner (valid claimToken matching agent in DB) → unlimited
   */
  fastify.get('/connect/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const { claimToken, callerId } = request.query as {
      claimToken?: string;
      callerId?: string;
    };

    // Check ownership via claimToken
    let isOwner = false;
    if (claimToken) {
      const [agent] = await db
        .select({ id: agents.id, claimToken: agents.claimToken })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);
      if (agent && agent.claimToken === claimToken) {
        isOwner = true;
      }
    }

    // Rate limit non-owners by callerId + IP (both keys checked)
    if (!isOwner) {
      const ip = request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
        || request.ip
        || 'unknown';
      const keys = [`voice_rl:cid:${callerId || 'none'}`, `voice_rl:ip:${ip}`];

      // Check both rate limit keys — blocked if EITHER is set
      for (const key of keys) {
        const existing = await redis.get(key);
        if (existing) {
          const ttl = await redis.ttl(key);
          const nextAvailableAt = Date.now() + ttl * 1000;
          reply.code(429);
          return {
            error: 'RATE_LIMITED',
            nextAvailableAt,
            message: `Please wait ${Math.ceil(ttl / 60)} minutes before your next call`,
          };
        }
      }

      // Set both rate limit keys (expire after 4 hours)
      for (const key of keys) {
        await redis.set(key, Date.now().toString(), 'EX', RATE_LIMIT_WINDOW);
      }
    }

    const { ensureAgent } = await import('../services/elevenlabs-agents.js');
    const elevenlabsAgentId = await ensureAgent(agentId);

    if (!elevenlabsAgentId) {
      // Clean up rate limits if agent not found (don't punish for invalid agent)
      if (!isOwner) {
        const ip = request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
          || request.ip
          || 'unknown';
        await redis.del(`voice_rl:cid:${callerId || 'none'}`, `voice_rl:ip:${ip}`);
      }
      reply.code(404);
      return { error: 'Agent not found or voice not enabled' };
    }

    return {
      elevenlabsAgentId,
      maxSeconds: isOwner ? 0 : 60,
      isOwner,
    };
  });
}
