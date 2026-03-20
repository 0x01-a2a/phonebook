import dotenv from 'dotenv';
import path from 'path';
import { createReadStream, existsSync } from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { db, sql } from '@phonebook/database';
import { checkFfmpeg } from './lib/audio-convert.js';
import { agentsRouter } from './routes/agents.js';
import { sdkRouter } from './routes/sdk.js';
import { verifyRouter } from './routes/verify.js';
import { inboundRouter } from './routes/inbound.js';
import { ratingsRouter } from './routes/ratings.js';
import { searchRouter } from './routes/search.js';
import { deadDropRouter } from './routes/dead-drop.js';
import { transactionsRouter } from './routes/transactions.js';
import { challengesRouter } from './routes/challenges.js';
import { triggerRouter } from './routes/trigger.js';
import { eventsRouter } from './routes/events.js';
import { voiceRouter } from './routes/voice.js';
import { twilioRouter } from './routes/twilio.js';
import { websocketHandler } from './websocket/handler.js';
import { broadcastsRouter } from './routes/broadcasts.js';
import * as broadcastScheduler from './services/broadcast-scheduler.js';

async function validateDependencies(): Promise<void> {
  console.log('[Startup] Validating dependencies...');

  // WARN-level checks (non-fatal)
  if (!process.env.ELEVENLABS_API_KEY) {
    console.warn('[Startup] WARN: ELEVENLABS_API_KEY not set — TTS broadcasts will fail');
  }
  if (!process.env.FIRECRAWL_API_KEY) {
    console.warn('[Startup] WARN: FIRECRAWL_API_KEY not set — news scraping will fail');
  }
  if (!process.env.MINIMAX_API_KEY) {
    console.warn('[Startup] WARN: MINIMAX_API_KEY not set — voice generation will fail');
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    console.warn('[Startup] WARN: ffmpeg not found — audio conversion will fail');
  }

  // FATAL check — DB connection
  try {
    await db.execute(sql`SELECT 1`);
    console.log('[Startup] DB connection OK');
  } catch (err) {
    console.error('[Startup] FATAL: Cannot connect to database:', err);
    process.exit(1);
  }

  console.log('[Startup] Dependency validation complete');
}

const fastify = Fastify({
  logger: true,
});

const start = async () => {
  try {
    // Register plugins
    await fastify.register(helmet, {
      contentSecurityPolicy: false,
    });
    
    await fastify.register(cors, {
      origin: process.env.CORS_ORIGIN || true,
    });

    await fastify.register(rateLimit, {
      max: 1000,
      timeWindow: '1 hour',
      keyGenerator: (request) => {
        return request.headers['x-agent-id'] as string || request.ip;
      },
    });

    await fastify.register(websocket);

    // Health check
    fastify.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Register routes
    await fastify.register(agentsRouter, { prefix: '/api/agents' });
    await fastify.register(sdkRouter, { prefix: '/api/sdk' });
    await fastify.register(verifyRouter, { prefix: '/api/verify' });
    await fastify.register(inboundRouter, { prefix: '/api/inbound' });
    await fastify.register(ratingsRouter, { prefix: '/api/ratings' });
    await fastify.register(searchRouter, { prefix: '/api/search' });
    await fastify.register(deadDropRouter, { prefix: '/api/dead-drop' });
    await fastify.register(transactionsRouter, { prefix: '/api/transactions' });
    await fastify.register(challengesRouter, { prefix: '/api/challenges' });
    await fastify.register(triggerRouter, { prefix: '/api/trigger' });
    await fastify.register(eventsRouter, { prefix: '/api/events' });
    await fastify.register(voiceRouter, { prefix: '/api/voice' });
    await fastify.register(twilioRouter, { prefix: '/api/twilio' });
    await fastify.register(broadcastsRouter, { prefix: '/api/broadcasts' });

    // Serve audio files from data/audio/
    fastify.get('/api/audio/*', async (request, reply) => {
      const filePath = (request.params as Record<string, string>)['*'];
      if (!filePath || filePath.includes('..')) {
        reply.code(400);
        return { error: 'Invalid path' };
      }
      const fullPath = path.join(process.cwd(), 'data', 'audio', filePath);
      if (!existsSync(fullPath)) {
        reply.code(404);
        return { error: 'Not found' };
      }
      const ext = path.extname(fullPath).toLowerCase();
      const contentType = ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : 'application/octet-stream';
      reply.type(contentType);
      return reply.send(createReadStream(fullPath));
    });

    // WebSocket for real-time presence
    fastify.get('/ws', { websocket: true }, websocketHandler);

    // Validate dependencies before starting
    await validateDependencies();

    const port = parseInt(process.env.PORT || '3001', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    console.log(`Server listening on http://${host}:${port}`);

    // Initialize broadcast scheduler
    await broadcastScheduler.initialize();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('[Shutdown] Graceful shutdown initiated...');
  broadcastScheduler.shutdown();
  await fastify.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
