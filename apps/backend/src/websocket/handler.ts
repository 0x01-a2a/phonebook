import Redis from 'ioredis';
import { WebSocket } from 'ws';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const PRESENCE_TTL = 60; // seconds

interface PresenceUser {
  agentId: string;
  status: 'online' | 'away' | 'busy' | 'offline';
  lastSeen: number;
}

const clients = new Map<string, Set<WebSocket>>();

export async function websocketHandler(connection: WebSocket, req: { url: string }) {
  const url = new URL(req.url || '', 'http://localhost');
  const agentId = url.searchParams.get('agentId');

  if (!agentId) {
    connection.close(4001, 'Agent ID required');
    return;
  }

  // Register client
  if (!clients.has(agentId)) {
    clients.set(agentId, new Set());
  }
  clients.get(agentId)!.add(connection);

  // Set presence in Redis
  await redis.setex(
    `presence:${agentId}`,
    PRESENCE_TTL,
    JSON.stringify({ agentId, status: 'online', lastSeen: Date.now() })
  );

  // Broadcast to all clients that this agent is online
  broadcastToAll({
    type: 'agent_online',
    agentId,
  });

  // Send current online agents
  const onlineAgents = await redis.keys('presence:*');
  const onlineList = await Promise.all(
    onlineAgents.map(async (key) => {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    })
  );

  connection.send(JSON.stringify({
    type: 'initial_state',
    onlineAgents: onlineList.filter(Boolean),
  }));

  // Heartbeat handler
  let heartbeatInterval: NodeJS.Timeout;
  
  const heartbeat = async () => {
    await redis.expire(`presence:${agentId}`, PRESENCE_TTL);
  };

  heartbeatInterval = setInterval(heartbeat, PRESENCE_TTL * 1000);

  // Message handler
  connection.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'status_change':
          await redis.setex(
            `presence:${agentId}`,
            PRESENCE_TTL,
            JSON.stringify({
              agentId,
              status: message.status,
              lastSeen: Date.now(),
            })
          );
          
          broadcastToAll({
            type: 'status_update',
            agentId,
            status: message.status,
          });
          break;

        case 'ping':
          connection.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  // Cleanup on close
  connection.on('close', async () => {
    clearInterval(heartbeatInterval);
    clients.get(agentId)?.delete(connection);
    
    if (clients.get(agentId)?.size === 0) {
      clients.delete(agentId);
      await redis.del(`presence:${agentId}`);
      
      broadcastToAll({
        type: 'agent_offline',
        agentId,
      });
    }
  });

  connection.on('error', (err) => {
    console.error('WebSocket error:', err);
    clearInterval(heartbeatInterval);
  });
}

function broadcastToAll(message: object) {
  const data = JSON.stringify(message);
  clients.forEach((clientSet) => {
    clientSet.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  });
}

// Export for SSE fallback
export async function getOnlineAgents(): Promise<PresenceUser[]> {
  const keys = await redis.keys('presence:*');
  const agents = await Promise.all(
    keys.map(async (key) => {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    })
  );
  return agents.filter(Boolean) as PresenceUser[];
}

export async function getAgentStatus(agentId: string): Promise<PresenceUser | null> {
  const data = await redis.get(`presence:${agentId}`);
  return data ? JSON.parse(data) : null;
}
