import type { FastifyInstance } from 'fastify';
import * as voice from '../services/voice-gateway.js';
import { emitActivity } from './events.js';

export async function voiceRouter(fastify: FastifyInstance) {
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
