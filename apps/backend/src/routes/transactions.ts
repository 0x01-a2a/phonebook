import type { FastifyInstance } from 'fastify';
import { transactions, agents } from '@phonebook/database';
import { db } from '@phonebook/database';
import { eq, desc, and, sql, or } from 'drizzle-orm';
import { z } from 'zod';

const createTransactionSchema = z.object({
  toAgentId: z.string().uuid().optional(),
  type: z.enum(['contact', 'dead_drop', 'featured_listing', 'voice_call']),
  amount: z.string(), // e.g., "0.001" USDC
  metadata: z.record(z.any()).optional(),
});

// X402 payment initiation
export async function transactionsRouter(fastify: FastifyInstance) {
  // Get transactions for an agent
  fastify.get('/agent/:agentId', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const { type, limit = '20' } = request.query as Record<string, string>;

    const conditions = [
      or(
        eq(transactions.fromAgentId, agentId),
        eq(transactions.toAgentId, agentId)
      ),
    ];

    if (type) {
      conditions.push(eq(transactions.type, type as any));
    }

    const txs = await db.select({
      id: transactions.id,
      fromAgentId: transactions.fromAgentId,
      toAgentId: transactions.toAgentId,
      type: transactions.type,
      amount: transactions.amount,
      currency: transactions.currency,
      status: transactions.status,
      x402PaymentId: transactions.x402PaymentId,
      metadata: transactions.metadata,
      createdAt: transactions.createdAt,
      fromName: agents.name,
      toName: agents.name,
    })
      .from(transactions)
      .leftJoin(agents, eq(transactions.fromAgentId, agents.id))
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt))
      .limit(parseInt(limit, 10));

    return { transactions: txs };
  });

  // Create a payment intent (X402)
  fastify.post('/create-intent', async (request, reply) => {
    const fromAgentId = request.headers['x-agent-id'] as string;
    const data = createTransactionSchema.parse(request.body);

    if (!fromAgentId) {
      reply.code(401);
      return { error: 'Agent ID required' };
    }

    // Platform fee: 5%
    const platformFee = parseFloat(data.amount) * 0.05;

    const [transaction] = await db.insert(transactions).values({
      fromAgentId,
      toAgentId: data.toAgentId,
      type: data.type,
      amount: data.amount,
      currency: 'USDC',
      status: 'pending',
      metadata: {
        ...data.metadata,
        platformFee: platformFee.toString(),
      },
    }).returning();

    // In production, this would return X402 payment details
    return {
      transactionId: transaction.id,
      amount: data.amount,
      currency: 'USDC',
      platformFee: platformFee.toString(),
      paymentAddress: process.env.PLATFORM_WALLET_ADDRESS,
      chain: 'base',
      // X402 specific headers would be added by the payment client
      x402: {
        protocol: '402',
        amount: data.amount,
        token: 'USDC',
        recipient: process.env.PLATFORM_WALLET_ADDRESS,
      },
    };
  });

  // Confirm payment (webhook from X402)
  fastify.post('/confirm', async (request, reply) => {
    const { transactionId, paymentId, status } = request.body as {
      transactionId: string;
      paymentId: string;
      status: 'completed' | 'failed';
    };

    const [updated] = await db.update(transactions)
      .set({
        status,
        x402PaymentId: paymentId,
        completedAt: status === 'completed' ? new Date() : undefined,
      })
      .where(eq(transactions.id, transactionId))
      .returning();

    if (!updated) {
      reply.code(404);
      return { error: 'Transaction not found' };
    }

    return { success: true, transaction: updated };
  });

  // Get transaction by ID
  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };

    const tx = await db.select({
      id: transactions.id,
      fromAgentId: transactions.fromAgentId,
      toAgentId: transactions.toAgentId,
      type: transactions.type,
      amount: transactions.amount,
      currency: transactions.currency,
      status: transactions.status,
      x402PaymentId: transactions.x402PaymentId,
      metadata: transactions.metadata,
      createdAt: transactions.createdAt,
      completedAt: transactions.completedAt,
    })
      .from(transactions)
      .where(eq(transactions.id, id))
      .limit(1);

    if (tx.length === 0) {
      return { error: 'Transaction not found' };
    }

    return tx[0];
  });

  // Get platform revenue stats
  fastify.get('/stats/revenue', async (request) => {
    const { period = '30d' } = request.query as { period: string };

    let dateFilter: Date;
    switch (period) {
      case '24h':
        dateFilter = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        dateFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
      default:
        dateFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    const stats = await db.select({
      totalVolume: sql<number>`sum(${transactions.amount}::numeric)::numeric`,
      totalTransactions: sql<number>`count(*)::int`,
      platformRevenue: sql<number>`sum((${transactions.amount}::numeric * 0.05))`,
    })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, 'completed'),
          sql`${transactions.createdAt} >= ${dateFilter}`
        )
      );

    return {
      period,
      totalVolume: stats[0]?.totalVolume || '0',
      totalTransactions: stats[0]?.totalTransactions || 0,
      platformRevenue: stats[0]?.platformRevenue || '0',
      currency: 'USDC',
    };
  });
}
