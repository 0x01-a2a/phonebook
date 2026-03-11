import type { FastifyInstance } from 'fastify';
import { challenges, proofOfWorkScores, agents } from '@phonebook/database';
import { db, schema } from '@phonebook/database';
import { eq, desc, asc, and, sql } from 'drizzle-orm';
import { z } from 'zod';

const submitChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  answer: z.any(), // Can be text, code, or JSON depending on challenge type
});

export async function challengesRouter(fastify: FastifyInstance) {
  // Get active challenges
  fastify.get('/active', async (request) => {
    const { type, difficulty } = request.query as Record<string, string>;

    const conditions = [eq(challenges.active, true)];
    
    if (type) {
      conditions.push(eq(challenges.type, type));
    }
    if (difficulty) {
      conditions.push(eq(challenges.difficulty, difficulty));
    }

    const activeChallenges = await db.select({
      id: challenges.id,
      title: challenges.title,
      description: challenges.description,
      type: challenges.type,
      difficulty: challenges.difficulty,
      createdAt: challenges.createdAt,
    })
      .from(challenges)
      .where(and(...conditions))
      .orderBy(asc(challenges.difficulty));

    return { challenges: activeChallenges };
  });

  // Get challenge details
  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };

    const challenge = await db.select()
      .from(challenges)
      .where(eq(challenges.id, id))
      .limit(1);

    if (challenge.length === 0) {
      return { error: 'Challenge not found' };
    }

    // Don't expose test cases in response
    const { testCases, ...safeChallenge } = challenge[0];
    return safeChallenge;
  });

  // Submit challenge answer
  fastify.post('/:id/submit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { answer } = submitChallengeSchema.parse(request.body);
    const agentId = request.headers['x-agent-id'] as string;

    if (!agentId) {
      reply.code(401);
      return { error: 'Agent ID required' };
    }

    // Get challenge
    const challenge = await db.select()
      .from(challenges)
      .where(eq(challenges.id, id))
      .limit(1);

    if (challenge.length === 0 || !challenge[0].active) {
      reply.code(404);
      return { error: 'Challenge not found or inactive' };
    }

    const { testCases } = challenge[0];
    
    // Evaluate answer based on challenge type
    let score = 0;
    let verified = false;
    const results: { passed: boolean; description?: string }[] = [];

    if (testCases && Array.isArray(testCases)) {
      for (const testCase of testCases) {
        const passed = evaluateAnswer(
          challenge[0].type,
          answer,
          testCase.input,
          testCase.expectedOutput
        );
        results.push({ 
          passed, 
          description: testCase.description 
        });
        if (passed) score += 100 / testCases.length;
      }
      verified = results.every(r => r.passed);
    } else {
      // For non-testable challenges, do simple verification
      score = answer && answer.length > 0 ? 50 : 0;
      verified = score === 100;
    }

    // Save score
    const [submission] = await db.insert(proofOfWorkScores).values({
      agentId,
      challengeId: id,
      challengeType: challenge[0].type,
      score,
      verified,
      proofData: {
        answer,
        results,
        submittedAt: new Date().toISOString(),
      },
    }).returning();

    // If verified, check if agent should be marked as verified
    if (verified) {
      const agentScores = await db.select({ id: proofOfWorkScores.id })
        .from(proofOfWorkScores)
        .where(
          and(
            eq(proofOfWorkScores.agentId, agentId),
            eq(proofOfWorkScores.verified, true)
          )
        );

      if (agentScores.length >= 3) {
        await db.update(agents)
          .set({ verified: true })
          .where(eq(agents.id, agentId));
      }
    }

    return {
      submissionId: submission.id,
      score,
      verified,
      results,
    };
  });

  // Get agent's proof of work scores
  fastify.get('/scores/:agentId', async (request) => {
    const { agentId } = request.params as { agentId: string };

    const scores = await db.select({
      id: proofOfWorkScores.id,
      challengeId: proofOfWorkScores.challengeId,
      challengeType: proofOfWorkScores.challengeType,
      score: proofOfWorkScores.score,
      verified: proofOfWorkScores.verified,
      submittedAt: proofOfWorkScores.submittedAt,
      challengeTitle: challenges.title,
    })
      .from(proofOfWorkScores)
      .leftJoin(challenges, eq(proofOfWorkScores.challengeId, challenges.id))
      .where(eq(proofOfWorkScores.agentId, agentId))
      .orderBy(desc(proofOfWorkScores.submittedAt));

    return { scores };
  });

  // Admin: Create challenge (would need admin auth)
  fastify.post('/', async (request, reply) => {
    const { title, description, type, difficulty, testCases } = request.body as {
      title: string;
      description: string;
      type: string;
      difficulty: 'easy' | 'medium' | 'hard';
      testCases?: Array<{
        input: string;
        expectedOutput: string;
        description?: string;
      }>;
    };

    const [challenge] = await db.insert(challenges).values({
      title,
      description,
      type,
      difficulty,
      testCases: testCases || [],
    }).returning();

    reply.code(201);
    return challenge;
  });
}

// Answer evaluation based on challenge type
function evaluateAnswer(
  type: string,
  answer: any,
  input: string,
  expectedOutput: string
): boolean {
  switch (type) {
    case 'coder':
      // For coding challenges, check if output matches expected
      try {
        // In production, this would run actual code in a sandbox
        const result = String(answer).trim().toLowerCase();
        const expected = expectedOutput.trim().toLowerCase();
        return result.includes(expected) || expected.includes(result);
      } catch {
        return false;
      }
    case 'writer':
      // For writing challenges, check length and basic quality
      if (typeof answer !== 'string') return false;
      const sentences = answer.split(/[.!?]+/).filter((s: string) => s.trim().length > 0);
      return sentences.length > 0;
    case 'researcher':
      // For research, check if sources are provided
      if (typeof answer !== 'object') return false;
      const sources = answer.sources || [];
      return sources.length >= parseInt(expectedOutput) || sources.length > 0;
    default:
      return String(answer) === expectedOutput;
  }
}
