import type { FastifyRequest, FastifyReply } from 'fastify';
import { db, agents, eq } from '@phonebook/database';
import bcrypt from 'bcryptjs';

/** Agent authenticated via X-Agent-Id + Authorization: Bearer <secret> or X-Agent-Secret */
export interface AuthenticatedAgent {
  id: string;
  name: string;
}

/** Extract agent secret from Authorization Bearer or X-Agent-Secret header */
function getAgentSecret(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim() || null;
  }
  const secretHeader = request.headers['x-agent-secret'] as string;
  if (secretHeader?.trim()) {
    return secretHeader.trim();
  }
  return null;
}

/** Verify agent identity. Returns agent if valid, null otherwise. */
export async function verifyAgentAuth(
  agentId: string,
  secret: string
): Promise<AuthenticatedAgent | null> {
  const [agent] = await db
    .select({ id: agents.id, name: agents.name, agentSecretHash: agents.agentSecretHash })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent) return null;
  if (!agent.agentSecretHash) {
    // Legacy agent without secret - reject in production
    if (process.env.NODE_ENV === 'production') {
      return null;
    }
    // In dev, allow X-Agent-Id only for backwards compat (no secret check)
    return secret ? null : { id: agent.id, name: agent.name };
  }

  const valid = await bcrypt.compare(secret, agent.agentSecretHash);
  return valid ? { id: agent.id, name: agent.name } : null;
}

/**
 * Middleware: require authenticated agent.
 * Expects X-Agent-Id + Authorization: Bearer <secret> or X-Agent-Secret.
 * Attaches request.agent (AuthenticatedAgent) on success.
 */
export async function requireAgentAuth(
  request: FastifyRequest<{ Params?: { id?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const agentId = (request.headers['x-agent-id'] as string)?.trim();
  const secret = getAgentSecret(request);

  if (!agentId) {
    reply.code(401).send({ error: 'X-Agent-Id header required' });
    return;
  }

  if (!secret && process.env.NODE_ENV === 'production') {
    reply.code(401).send({
      error: 'Authorization required. Use Authorization: Bearer <agentSecret> or X-Agent-Secret header.',
    });
    return;
  }

  // For legacy agents in dev (no secret in DB), allow X-Agent-Id only
  const agent = await verifyAgentAuth(agentId, secret || '');
  if (!agent) {
    reply.code(401).send({
      error: 'Invalid agent credentials. Check X-Agent-Id and your agent secret.',
    });
    return;
  }

  (request as any).agent = agent;
}

/**
 * Middleware: require authenticated agent AND that they own the resource (agent id in params).
 * Use for PATCH /:id, DELETE /:id, etc.
 */
export async function requireAgentOwnership(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  await requireAgentAuth(request, reply);
  if (reply.sent) return;

  const agent = (request as any).agent as AuthenticatedAgent;
  const resourceId = request.params.id;

  if (agent.id !== resourceId) {
    reply.code(403).send({ error: 'You can only modify your own agent' });
  }
}
