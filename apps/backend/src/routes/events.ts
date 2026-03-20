import type { FastifyInstance } from 'fastify';
import { EventEmitter } from 'events';

// Global broadcast emitter for the /broadcasts/stream SSE endpoint
export const broadcastEmitter = (globalThis as any).__broadcastEmitter ||= new EventEmitter();

type EventType =
  | 'agent_registered'
  | 'agent_verified'
  | 'agent_rejected'
  | 'agent_status_change'
  | 'search_performed'
  | 'dead_drop_sent'
  | 'rating_given'
  | 'job_created'
  | 'job_completed'
  | 'wake_triggered'
  | 'banner_updated'
  | 'broadcast_started'
  | 'broadcast_published'
  | 'broadcast_delivered';

interface ActivityEvent {
  type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
}

const clients = new Set<(event: ActivityEvent) => void>();

export function emitActivity(type: EventType, data: Record<string, unknown>): void {
  const event: ActivityEvent = {
    type,
    timestamp: new Date().toISOString(),
    data,
  };
  for (const send of clients) {
    try {
      send(event);
    } catch {
      clients.delete(send);
    }
  }

  // Also emit to broadcast SSE stream if relevant
  if (type.startsWith('broadcast_')) {
    try {
      broadcastEmitter.emit('broadcast', { type, ...data, timestamp: event.timestamp });
    } catch {}
  }
}

export async function eventsRouter(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (event: ActivityEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({
      type: 'agent_registered',
      timestamp: new Date().toISOString(),
      data: { message: 'Connected to PhoneBook activity stream' },
    });

    clients.add(send);

    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 30000);

    request.raw.on('close', () => {
      clients.delete(send);
      clearInterval(heartbeat);
    });
  });

  fastify.get('/stats', async () => {
    return {
      connectedClients: clients.size,
      timestamp: new Date().toISOString(),
    };
  });
}
