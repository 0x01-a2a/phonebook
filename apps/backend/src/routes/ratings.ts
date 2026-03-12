import type { FastifyInstance } from 'fastify';
import { ratings, agents } from '@phonebook/database';
import { db, schema } from '@phonebook/database';
import { eq, desc, and, sql } from '@phonebook/database';
import { z } from 'zod';
import { requireAgentAuth } from '../auth.js';

const createRatingSchema = z.object({
  agentId: z.string().uuid(),
  dimension: z.enum(['response_speed', 'accuracy', 'communication', 'reliability', 'helpfulness']),
  value: z.number().min(1).max(5),
  comment: z.string().max(500).optional(),
});

const ratingIdParam = z.object({
  id: z.string().uuid(),
});

export async function ratingsRouter(fastify: FastifyInstance) {
  // Get ratings for an agent
  fastify.get('/agent/:agentId', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const { dimension, limit = '20' } = request.query as Record<string, string>;

    const conditions = [eq(ratings.agentId, agentId)];
    if (dimension) {
      conditions.push(eq(ratings.dimension, dimension as any));
    }

    const agentRatings = await db.select({
      id: ratings.id,
      agentId: ratings.agentId,
      raterId: ratings.raterId,
      dimension: ratings.dimension,
      value: ratings.value,
      comment: ratings.comment,
      weight: ratings.weight,
      createdAt: ratings.createdAt,
      raterName: agents.name,
    })
      .from(ratings)
      .leftJoin(agents, eq(ratings.raterId, agents.id))
      .where(and(...conditions))
      .orderBy(desc(ratings.createdAt))
      .limit(parseInt(limit, 10));

    // Calculate average by dimension
    const averages = await db.select({
      dimension: ratings.dimension,
      avg: sql<number>`avg(${ratings.value})`,
      count: sql<number>`count(*)::int`,
    })
      .from(ratings)
      .where(eq(ratings.agentId, agentId))
      .groupBy(ratings.dimension);

    return {
      ratings: agentRatings,
      averages: averages.reduce((acc, row) => {
        acc[row.dimension] = {
          average: parseFloat(row.avg.toString()),
          count: row.count,
        };
        return acc;
      }, {} as Record<string, { average: number; count: number }>),
    };
  });

  // Create a rating (requires auth)
  fastify.post('/', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const data = createRatingSchema.parse(request.body);
    const raterId = (request as any).agent.id;

    // Check if agents exist
    const [targetAgent, raterAgent] = await Promise.all([
      db.select({ id: agents.id, trustScore: agents.trustScore })
        .from(agents)
        .where(eq(agents.id, data.agentId))
        .limit(1),
      db.select({ id: agents.id, trustScore: agents.trustScore })
        .from(agents)
        .where(eq(agents.id, raterId))
        .limit(1),
    ]);

    if (targetAgent.length === 0 || raterAgent.length === 0) {
      reply.code(400);
      return { error: 'Agent not found' };
    }

    // Check for mutual rating (anti-gaming)
    const existingReverseRating = await db.select({ id: ratings.id })
      .from(ratings)
      .where(
        and(
          eq(ratings.agentId, raterId),
          eq(ratings.raterId, data.agentId)
        )
      )
      .limit(1);

    // Calculate weight based on rater's trust score
    const raterTrustScore = raterAgent[0].trustScore;
    const baseWeight = Math.min(2.4, Math.max(0.1, raterTrustScore / 5));
    const mutualPenalty = existingReverseRating.length > 0 ? 0.5 : 1.0;
    const finalWeight = baseWeight * mutualPenalty;

    // Check account age (anti-gaming)
    const raterAge = new Date().getTime() - raterAgent[0].id.getTime();
    const ageFactor = raterAge < 24 * 60 * 60 * 1000 ? 0.1 : 1.0;

    const [newRating] = await db.insert(ratings).values({
      agentId: data.agentId,
      raterId,
      dimension: data.dimension,
      value: data.value,
      comment: data.comment,
      weight: finalWeight * ageFactor,
      isMutual: existingReverseRating.length > 0,
    }).returning();

    // Update agent's reputation score
    await recalculateReputation(data.agentId);

    return newRating;
  });

  // Get ratings given by an agent (what they think of others)
  fastify.get('/given/:agentId', async (request) => {
    const { agentId } = request.params as { agentId: string };

    const givenRatings = await db.select({
      id: ratings.id,
      agentId: ratings.agentId,
      dimension: ratings.dimension,
      value: ratings.value,
      comment: ratings.comment,
      createdAt: ratings.createdAt,
      targetName: agents.name,
    })
      .from(ratings)
      .leftJoin(agents, eq(ratings.agentId, agents.id))
      .where(eq(ratings.raterId, agentId))
      .orderBy(desc(ratings.createdAt));

    return givenRatings;
  });
}

// Helper function to recalculate reputation
async function recalculateReputation(agentId: string) {
  const agentRatings = await db.select({
    dimension: ratings.dimension,
    value: ratings.value,
    weight: ratings.weight,
    decayFactor: ratings.decayFactor,
    createdAt: ratings.createdAt,
  })
    .from(ratings)
    .where(eq(ratings.agentId, agentId));

  if (agentRatings.length < 5) {
    // Not enough ratings for public score
    return;
  }

  // Dimension weights from plan
  const dimensionWeights: Record<string, number> = {
    response_speed: 0.20,
    accuracy: 0.35,
    communication: 0.20,
    reliability: 0.15,
    helpfulness: 0.10,
  };

  // Calculate weighted average with decay
  const now = new Date();
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const rating of agentRatings) {
    // Decay factor: 50% after 90 days
    const daysOld = (now.getTime() - new Date(rating.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const timeDecay = daysOld > 90 ? Math.pow(0.5, (daysOld - 90) / 90) : 1;
    
    const dimensionWeight = dimensionWeights[rating.dimension] || 0.2;
    const effectiveWeight = rating.weight * timeDecay * dimensionWeight;
    
    totalWeightedScore += rating.value * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  const reputationScore = totalWeight > 0 ? (totalWeightedScore / totalWeight) * 2 : 0; // Scale to 0-10

  // Update agent
  await db.update(agents)
    .set({ reputationScore: Math.min(10, reputationScore) })
    .where(eq(agents.id, agentId));
}
