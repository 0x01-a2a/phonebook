import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { agentsRouter } from './routes/agents.js';
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
    await fastify.register(ratingsRouter, { prefix: '/api/ratings' });
    await fastify.register(searchRouter, { prefix: '/api/search' });
    await fastify.register(deadDropRouter, { prefix: '/api/dead-drop' });
    await fastify.register(transactionsRouter, { prefix: '/api/transactions' });
    await fastify.register(challengesRouter, { prefix: '/api/challenges' });
    await fastify.register(triggerRouter, { prefix: '/api/trigger' });
    await fastify.register(eventsRouter, { prefix: '/api/events' });
    await fastify.register(voiceRouter, { prefix: '/api/voice' });
    await fastify.register(twilioRouter, { prefix: '/api/twilio' });

    // WebSocket for real-time presence
    fastify.get('/ws', { websocket: true }, websocketHandler);

    const port = parseInt(process.env.PORT || '3001', 10);
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    console.log(`Server listening on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
