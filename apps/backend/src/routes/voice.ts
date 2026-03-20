import type { FastifyInstance } from 'fastify';
import * as voice from '../services/voice-gateway.js';
import * as firecrawl from '../services/firecrawl.js';
import { emitActivity } from './events.js';

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
      const results = await firecrawl.search(query, { limit: 3, tbs: 'qdr:d' });

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
}
