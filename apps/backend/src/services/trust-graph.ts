import { ratings, agents } from '@phonebook/database';
import { db, schema } from '@phonebook/database';
import { eq, sql } from '@phonebook/database';

const DAMPING_FACTOR = 0.85;
const MAX_ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 0.001;

/**
 * Agent Trust Graph (ATG) - PageRank-style reputation algorithm
 * 
 * How it works:
 * 1. Each agent starts with trust_score = 1.0
 * 2. For each rating: contribution = V * W_A * trust_score[A]
 * 3. Damping factor: 0.85
 * 4. Iterate 50x or until convergence
 * 5. Result: trust_score [0.0, 10.0]
 */

export async function calculateTrustGraph() {
  // Get all agents
  const allAgents = await db.select({
    id: agents.id,
    trustScore: agents.trustScore,
  }).from(agents);

  const agentIds = allAgents.map(a => a.id);
  const n = agentIds.length;
  
  if (n === 0) return;

  // Initialize scores
  let scores = new Map<string, number>();
  agentIds.forEach(id => scores.set(id, 1.0));

  // Get all ratings with weights
  const allRatings = await db.select({
    raterId: ratings.raterId,
    agentId: ratings.agentId,
    value: ratings.value,
    weight: ratings.weight,
    decayFactor: ratings.decayFactor,
  }).from(ratings);

  // Build adjacency list for ratings
  const incomingRatings = new Map<string, Array<{
    raterId: string;
    value: number;
    weight: number;
  }>>();

  for (const rating of allRatings) {
    if (!incomingRatings.has(rating.agentId)) {
      incomingRatings.set(rating.agentId, []);
    }
    incomingRatings.get(rating.agentId)!.push({
      raterId: rating.raterId,
      value: rating.value,
      weight: rating.weight,
    });
  }

  // Iterative PageRank
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const newScores = new Map<string, number>();
    let maxChange = 0;

    for (const agentId of agentIds) {
      let rank = (1 - DAMPING_FACTOR) / n;
      
      // Sum contributions from all raters
      const raterRatings = incomingRatings.get(agentId) || [];
      for (const rating of raterRatings) {
        const raterScore = scores.get(rating.raterId) || 1.0;
        // Normalize value to 0-1 range (original is 1-5)
        const normalizedValue = (rating.value - 1) / 4;
        const contribution = normalizedValue * rating.weight * raterScore * DAMPING_FACTOR;
        rank += contribution;
      }

      newScores.set(agentId, rank);
      maxChange = Math.max(maxChange, Math.abs(rank - (scores.get(agentId) || 0)));
    }

    scores = newScores;

    if (maxChange < CONVERGENCE_THRESHOLD) {
      console.log(`Trust graph converged after ${iteration + 1} iterations`);
      break;
    }
  }

  // Normalize scores to 0-10 range
  const maxScore = Math.max(...Array.from(scores.values()), 0.001);
  const normalizedScores = new Map<string, number>();
  
  scores.forEach((score, agentId) => {
    normalizedScores.set(agentId, (score / maxScore) * 10);
  });

  // Update all agents with new trust scores
  for (const [agentId, trustScore] of normalizedScores) {
    await db.update(agents)
      .set({ trustScore })
      .where(eq(agents.id, agentId));
  }

  console.log('Trust graph calculation complete');
  return normalizedScores;
}

/**
 * Get trust score for a specific agent
 */
export async function getTrustScore(agentId: string): Promise<number> {
  const result = await db.select({ trustScore: agents.trustScore })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  return result[0]?.trustScore || 0;
}

/**
 * Get trust path between two agents
 */
export async function getTrustPath(fromAgentId: string, toAgentId: string): Promise<string[]> {
  // Simple BFS to find trust path
  const ratingsData = await db.select({
    raterId: schema.ratings.raterId,
    agentId: schema.ratings.agentId,
  }).from(schema.ratings);

  const adjacency = new Map<string, string[]>();
  
  for (const r of ratingsData) {
    if (!adjacency.has(r.raterId)) {
      adjacency.set(r.raterId, []);
    }
    adjacency.get(r.raterId)!.push(r.agentId);
  }

  // BFS
  const queue: string[][] = [[fromAgentId]];
  const visited = new Set<string>([fromAgentId]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];

    if (current === toAgentId) {
      return path;
    }

    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return [];
}

/**
 * Anti-gaming: Check if rating is likely fake/synthetic
 */
export function detectSuspiciousRating(
  raterId: string,
  agentId: string,
  value: number
): { suspicious: boolean; reason?: string } {
  // Check for mutual rating (both rate each other around same time)
  // This would need to check timestamps in production
  
  // Check for rating pattern (always 5 or always 1)
  // Would need historical data

  // For now, return safe
  return { suspicious: false };
}
