/**
 * Radio DJ Router — API endpoints for DJ voice clips
 */

import type { FastifyInstance } from 'fastify';
import { getDjClip, getAllCachedClips, regenerateAllClips } from '../services/radio-dj.js';

export async function radioDjRouter(fastify: FastifyInstance) {
  /** List all cached DJ clips (lazy-generates intro if missing) */
  fastify.get('/clips', async (_request, reply) => {
    let clips = await getAllCachedClips();

    // Ensure intro exists
    const hasIntro = clips.some((c) => c.type === 'intro');
    if (!hasIntro) {
      const intro = await getDjClip('intro', 0);
      if (intro) {
        clips = [intro, ...clips];
      }
    }

    // Ensure at least one jingle exists
    const hasJingle = clips.some((c) => c.type === 'jingle');
    if (!hasJingle) {
      const jingle = await getDjClip('jingle', 0);
      if (jingle) {
        clips = [...clips, jingle];
      }
    }

    return clips;
  });

  /** Get a specific DJ clip (lazy-generates if missing) */
  fastify.get('/clip/:type', async (request, reply) => {
    const { type } = request.params as { type: string };
    const { variant } = request.query as { variant?: string };

    if (!['intro', 'filler', 'signoff', 'jingle'].includes(type)) {
      return reply.code(400).send({ error: 'Invalid type. Use: intro, filler, signoff, jingle' });
    }

    const v = parseInt(variant || '0', 10);
    const clip = await getDjClip(type as 'intro' | 'filler' | 'signoff' | 'jingle', v);

    if (!clip) {
      return reply.code(404).send({ error: 'Clip not found or rate limited' });
    }

    return clip;
  });

  /** Regenerate all DJ clips (dev-only, rate limited) */
  fastify.post('/regenerate', async (_request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.code(403).send({ error: 'Disabled in production' });
    }

    const clips = await regenerateAllClips();
    return { generated: clips.length, clips };
  });
}
