import type { FastifyInstance } from 'fastify';
import { deadDropMessages, agents } from '@phonebook/database';
import { db } from '@phonebook/database';
import { eq, desc, and, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const createMessageSchema = z.object({
  toAgentId: z.string().uuid(),
  encryptedContent: z.string(),
  nonce: z.string(),
  ephemeral: z.boolean().default(false),
  ttlMinutes: z.number().optional(),
});

const ENCRYPTION_KEY = process.env.DEAD_DROP_KEY || randomBytes(32).toString('hex');

export async function deadDropRouter(fastify: FastifyInstance) {
  // Get messages for an agent
  fastify.get('/inbox', async (request, reply) => {
    const agentId = request.headers['x-agent-id'] as string;
    
    if (!agentId) {
      reply.code(401);
      return { error: 'Agent ID required' };
    }

    const messages = await db.select({
      id: deadDropMessages.id,
      fromAgentId: deadDropMessages.fromAgentId,
      encryptedContent: deadDropMessages.encryptedContent,
      nonce: deadDropMessages.nonce,
      ephemeral: deadDropMessages.ephemeral,
      read: deadDropMessages.read,
      readAt: deadDropMessages.readAt,
      createdAt: deadDropMessages.createdAt,
      fromName: deadDropMessages.fromAgentId, // Would join to get name
    })
      .from(deadDropMessages)
      .where(eq(deadDropMessages.toAgentId, agentId))
      .orderBy(desc(deadDropMessages.createdAt));

    return { messages };
  });

  // Send a dead drop message
  fastify.post('/send', async (request, reply) => {
    const fromAgentId = request.headers['x-agent-id'] as string;
    const data = createMessageSchema.parse(request.body);

    if (!fromAgentId) {
      reply.code(401);
      return { error: 'Agent ID required' };
    }

    // Check if recipient exists in agents table
    const [recipient] = await db.select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, data.toAgentId))
      .limit(1);

    if (!recipient) {
      reply.code(404);
      return { error: 'Recipient agent not found' };
    }

    const [message] = await db.insert(deadDropMessages).values({
      fromAgentId,
      toAgentId: data.toAgentId,
      encryptedContent: data.encryptedContent,
      nonce: data.nonce,
      ephemeral: data.ephemeral,
      ttl: data.ttlMinutes 
        ? new Date(Date.now() + data.ttlMinutes * 60 * 1000)
        : null,
    }).returning();

    reply.code(201);
    return { success: true, messageId: message.id };
  });

  // Mark message as read
  fastify.patch('/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.headers['x-agent-id'] as string;

    if (!agentId) {
      reply.code(401);
      return { error: 'Agent ID required' };
    }

    const [updated] = await db.update(deadDropMessages)
      .set({ 
        read: true, 
        readAt: new Date() 
      })
      .where(
        and(
          eq(deadDropMessages.id, id),
          eq(deadDropMessages.toAgentId, agentId)
        )
      )
      .returning();

    if (!updated) {
      reply.code(404);
      return { error: 'Message not found' };
    }

    return { success: true };
  });

  // Delete message
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.headers['x-agent-id'] as string;

    if (!agentId) {
      reply.code(401);
      return { error: 'Agent ID required' };
    }

    const [deleted] = await db.delete(deadDropMessages)
      .where(
        and(
          eq(deadDropMessages.id, id),
          eq(deadDropMessages.toAgentId, agentId)
        )
      )
      .returning();

    if (!deleted) {
      reply.code(404);
      return { error: 'Message not found' };
    }

    return { success: true };
  });

  // Clean up expired messages (would be called by cron)
  fastify.post('/cleanup', async () => {
    const now = new Date();
    const result = await db.delete(deadDropMessages)
      .where(
        and(
          eq(deadDropMessages.ephemeral, true),
          isNull(deadDropMessages.readAt),
          lt(deadDropMessages.createdAt, now) // Clean up old ephemeral messages
        )
      );
    
    return { cleaned: 'expired messages' };
  });
}

// Encryption utilities
export function encryptMessage(plaintext: string): { encrypted: string; nonce: string } {
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf8');
  const nonce = randomBytes(12);
  
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted: encrypted + ':' + authTag,
    nonce: nonce.toString('hex'),
  };
}

export function decryptMessage(encrypted: string, nonce: string): string {
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf8');
  const [ciphertext, authTag] = encrypted.split(':');
  
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
