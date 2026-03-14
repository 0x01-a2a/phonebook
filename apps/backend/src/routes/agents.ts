import type { FastifyInstance } from 'fastify';
import { agents, db, schema, eq, desc, asc, sql, and } from '@phonebook/database';
import { z } from 'zod';
import crypto, { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { emitActivity } from './events.js';
import { requireAgentOwnership } from '../auth.js';
import { verifySolanaClaimSignature, buildClaimMessage } from '../verify-solana.js';
import { sendClaimVerificationEmail } from '../services/send-email.js';
import { verifyTweetContainsCode } from '../services/verify-tweet.js';

const registerAgentSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().max(500).optional(),
  categories: z.array(z.string()).default([]),
  whatsappNumber: z.string().optional(),
  whatsappDisplay: z.string().max(100).optional(),
  contactWebhook: z.string().url().optional(),
  contactEmail: z.string().email().optional(),
  baseWalletAddress: z.string().optional(),
});

const updateAgentSchema = registerAgentSchema.partial();

type AgentStatus = 'online' | 'offline' | 'busy' | 'maintenance';

/**
 * Derive a deterministic virtual number from agent_id (UUID or Ed25519 public key hex).
 * Zero cost, stable mapping, collision-resistant (100M combinations).
 * Format: +1-0x01-XXXX-XXXX
 */
export function getVirtualNumberFromAgentId(agentIdHex: string): string {
  const hash = crypto.createHash('sha256').update(agentIdHex).digest();
  const numU32 = hash.readUInt32LE(0);
  const eightDigits = numU32 % 100_000_000;
  const part1 = Math.floor(eightDigits / 10000);
  const part2 = eightDigits % 10000;
  return `+1-0x01-${String(part1).padStart(4, '0')}-${String(part2).padStart(4, '0')}`;
}

function generateClaimToken(): string {
  return 'pb_claim_' + crypto.randomBytes(24).toString('hex');
}

export async function agentsRouter(fastify: FastifyInstance) {
  // List all agents with pagination and filters
  fastify.get('/', async (request, reply) => {
    const { 
      page = '1', 
      limit = '20', 
      category, 
      status, 
      featured,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = request.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (category) {
      conditions.push(sql`${agents.categories} @> ${JSON.stringify([category])}`);
    }
    if (status) {
      conditions.push(eq(agents.status, status as 'online' | 'offline' | 'busy' | 'maintenance'));
    }
    if (featured === 'true') {
      conditions.push(eq(agents.featured, true));
    }

    const whereClause = conditions.length > 0 
      ? and(...conditions)
      : undefined;

    const [agentsList, total] = await Promise.all([
      db.select({
        id: agents.id,
        name: agents.name,
        description: agents.description,
        categories: agents.categories,
        phoneNumber: agents.phoneNumber,
        whatsappNumber: agents.whatsappNumber,
        whatsappDisplay: agents.whatsappDisplay,
        status: agents.status,
        reputationScore: agents.reputationScore,
        verified: agents.verified,
        featured: agents.featured,
        pixelBannerGif: agents.pixelBannerGif,
        pixelBannerFrames: agents.pixelBannerFrames,
        createdAt: agents.createdAt,
      })
        .from(agents)
        .where(whereClause)
        .orderBy(sortOrder === 'asc' ? asc(agents.createdAt) : desc(agents.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(agents).where(whereClause),
    ]);

    return {
      data: agentsList,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: total[0].count,
        totalPages: Math.ceil(total[0].count / limitNum),
      },
    };
  });

  // List agents pending claim (for verify page — no sensitive data, no contactWebhook/contactEmail)
  fastify.get('/pending', async () => {
    const pending = await db.select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      categories: agents.categories,
      phoneNumber: agents.phoneNumber,
      status: agents.status,
      verified: agents.verified,
      claimStatus: agents.claimStatus,
      createdAt: agents.createdAt,
    })
      .from(agents)
      .where(eq(agents.verified, false))
      .orderBy(desc(agents.createdAt))
      .limit(50);

    return { data: pending, total: pending.length };
  });

  // Get featured agents
  fastify.get('/featured', async () => {
    const featuredAgents = await db.select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      categories: agents.categories,
      phoneNumber: agents.phoneNumber,
      whatsappDisplay: agents.whatsappDisplay,
      status: agents.status,
      reputationScore: agents.reputationScore,
      pixelBannerGif: agents.pixelBannerGif,
    })
      .from(agents)
      .where(eq(agents.featured, true))
      .orderBy(desc(agents.reputationScore))
      .limit(10);

    return featuredAgents;
  });

  // Get single agent by ID
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, id),
      with: {
        ratings: {
          orderBy: [desc(schema.ratings.createdAt)],
          limit: 10,
        },
        proofOfWorkScores: {
          orderBy: [desc(schema.proofOfWorkScores.submittedAt)],
          limit: 5,
        },
      },
    });

    if (!agent) {
      reply.code(404);
      return { error: 'Agent not found' };
    }

    // Get backup agent info if exists
    let backupAgent = null;
    if (agent.backupAgentId) {
      backupAgent = await db.select({
        id: agents.id,
        name: agents.name,
        whatsappDisplay: agents.whatsappDisplay,
      })
        .from(agents)
        .where(eq(agents.id, agent.backupAgentId))
        .limit(1);
    }

    return { ...agent, backupAgent: backupAgent?.[0] || null };
  });

  // Register new agent
  fastify.post('/register', async (request, reply) => {
    const data = registerAgentSchema.parse(request.body);

    // Check if name already exists
    const existing = await db.select({ id: agents.id })
      .from(agents)
      .where(eq(agents.name, data.name))
      .limit(1);

    if (existing.length > 0) {
      reply.code(400);
      return { error: 'Agent name already taken' };
    }

    const claimToken = generateClaimToken();
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Generate API secret (64 chars hex) - shown only once at registration
    const agentSecret = crypto.randomBytes(32).toString('hex');
    const agentSecretHash = await bcrypt.hash(agentSecret, 10);

    // Generate UUID first, then derive virtual number deterministically from it
    const agentId = randomUUID();
    const phoneNumber = getVirtualNumberFromAgentId(agentId);

    const rows = await db.insert(agents).values({
      ...data,
      id: agentId,
      phoneNumber,
      status: 'offline',
      reputationScore: 0,
      trustScore: 1.0,
      verified: false,
      claimToken,
      claimStatus: 'unclaimed',
      agentSecretHash,
    }).returning();
    const newAgent = (rows as any[])[0];

    emitActivity('agent_registered', {
      agentId: newAgent.id,
      name: newAgent.name,
      categories: newAgent.categories,
    });

    reply.code(201);
    return {
      ...newAgent,
      agentSecret, // ⚠️ Only returned once - store securely!
      claimToken,
      claimUrl: `${baseUrl}/claim/${claimToken}`,
      important: 'Store agentSecret securely. Use it as Authorization: Bearer <agentSecret> or X-Agent-Secret for API calls. Send claimUrl to your human owner to verify.',
    };
  });

  // Update agent (requires auth + ownership)
  fastify.patch('/:id', {
    preHandler: requireAgentOwnership,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateAgentSchema.parse(request.body);

    const updated = (await db.update(agents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning() as any[])[0];

    if (!updated) {
      reply.code(404);
      return { error: 'Agent not found' };
    }

    return updated;
  });

  // Update agent status (requires auth + ownership)
  fastify.patch('/:id/status', {
    preHandler: requireAgentOwnership,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: 'online' | 'offline' | 'busy' | 'maintenance' };

    if (!['online', 'offline', 'busy', 'maintenance'].includes(status)) {
      reply.code(400);
      return { error: 'Invalid status' };
    }

    const updated = (await db.update(agents)
      .set({ status, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning() as any[])[0];

    if (!updated) {
      reply.code(404);
      return { error: 'Agent not found' };
    }

    emitActivity('agent_status_change', {
      agentId: id,
      status,
      name: updated.name,
    });

    fastify.websocketServer?.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'status_update',
          agentId: id,
          status,
        }));
      }
    });

    return updated;
  });

  // Update pixel banner (requires auth + ownership)
  fastify.patch('/:id/banner', {
    preHandler: requireAgentOwnership,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { pixelBannerFrames, pixelBannerGif } = request.body as {
      pixelBannerFrames?: typeof agents.pixelBannerFrames,
      pixelBannerGif?: string
    };

    const updated = (await db.update(agents)
      .set({ 
        pixelBannerFrames, 
        pixelBannerGif,
        updatedAt: new Date() 
      })
      .where(eq(agents.id, id))
      .returning() as any[])[0];

    if (!updated) {
      reply.code(404);
      return { error: 'Agent not found' };
    }

    emitActivity('banner_updated', {
      agentId: id,
      name: updated.name,
    });

    return updated;
  });

  // Delete agent (requires auth + ownership)
  fastify.delete('/:id', {
    preHandler: requireAgentOwnership,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const deleted = (await db.delete(agents)
      .where(eq(agents.id, id))
      .returning() as any[])[0];

    if (!deleted) {
      reply.code(404);
      return { error: 'Agent not found' };
    }

    return { success: true };
  });

  // ─── CLAIM-BASED VERIFICATION ───

  // Get agent info by claim token (public, for the claim page)
  fastify.get('/claim/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    const agent = await db.select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      categories: agents.categories,
      phoneNumber: agents.phoneNumber,
      status: agents.status,
      verified: agents.verified,
      claimStatus: agents.claimStatus,
      claimTweetCode: agents.claimTweetCode,
      createdAt: agents.createdAt,
    })
      .from(agents)
      .where(eq(agents.claimToken, token))
      .limit(1);

    if (!agent.length) {
      reply.code(404);
      return { error: 'Invalid or expired claim token' };
    }

    const a = agent[0];
    return {
      agent: a,
      messageToSign: buildClaimMessage(a.id),
      claimTweetCode: a.claimTweetCode,
    };
  });

  // Claim an agent — multi-step: email → tweet → wallet (or direct wallet)
  fastify.post('/claim/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = request.body as {
      action?: 'send_email_verification' | 'verify_email' | 'verify_tweet' | 'init_tweet';
      method?: 'wallet' | 'email';
      finalize?: boolean;
      email?: string;
      code?: string;
      tweetUrl?: string;
      walletAddress?: string;
      signature?: string;
    };

    const existing = await db.select({
      id: agents.id,
      name: agents.name,
      phoneNumber: agents.phoneNumber,
      verified: agents.verified,
      claimStatus: agents.claimStatus,
      claimEmailCode: agents.claimEmailCode,
      claimEmailCodeExpires: agents.claimEmailCodeExpires,
      claimTweetCode: agents.claimTweetCode,
    })
      .from(agents)
      .where(eq(agents.claimToken, token))
      .limit(1);

    if (!existing.length) {
      reply.code(404);
      return { error: 'Invalid or expired claim token' };
    }

    const agent = existing[0];
    if (agent.claimStatus === 'claimed' || agent.verified) {
      reply.code(409);
      return { error: 'Agent already claimed and verified' };
    }

    // ─── Action: send_email_verification ───
    if (body.action === 'send_email_verification') {
      if (!body.email || !body.email.includes('@')) {
        reply.code(400);
        return { error: 'Valid email required' };
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
      await db.update(agents)
        .set({
          ownerEmail: body.email,
          claimEmailCode: code,
          claimEmailCodeExpires: expires,
          updatedAt: new Date(),
        })
        .where(eq(agents.claimToken, token));

      const { ok, error } = await sendClaimVerificationEmail(body.email, agent.name, code);
      if (!ok && process.env.RESEND_API_KEY) {
        reply.code(500);
        return { error: error || 'Failed to send email' };
      }
      const devCode = !process.env.RESEND_API_KEY && process.env.CLAIM_EMAIL_DEV ? code : undefined;
      return { success: true, ...(devCode && { devCode }) };
    }

    // ─── Action: verify_email ───
    if (body.action === 'verify_email') {
      if (!body.code || body.code.length !== 6) {
        reply.code(400);
        return { error: '6-digit code required' };
      }
      const [row] = await db.select({
        claimEmailCode: agents.claimEmailCode,
        claimEmailCodeExpires: agents.claimEmailCodeExpires,
      })
        .from(agents)
        .where(eq(agents.claimToken, token))
        .limit(1);
      if (!row || row.claimEmailCode !== body.code) {
        reply.code(400);
        return { error: 'Invalid or expired code' };
      }
      if (row.claimEmailCodeExpires && new Date() > row.claimEmailCodeExpires) {
        reply.code(400);
        return { error: 'Code expired. Request a new one.' };
      }
      const tweetCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      await db.update(agents)
        .set({
          claimStatus: 'email_verified',
          claimEmailCode: null,
          claimEmailCodeExpires: null,
          claimTweetCode: tweetCode,
          updatedAt: new Date(),
        })
        .where(eq(agents.claimToken, token));
      return { success: true, claimTweetCode: tweetCode };
    }

    // ─── Action: init_tweet (generate tweet code without requiring email) ───
    if (body.action === 'init_tweet') {
      let tweetCode = agent.claimTweetCode;
      if (!tweetCode) {
        tweetCode = crypto.randomBytes(4).toString('hex').toUpperCase();
        await db.update(agents)
          .set({
            claimTweetCode: tweetCode,
            updatedAt: new Date(),
          })
          .where(eq(agents.claimToken, token));
      }
      return { success: true, claimTweetCode: tweetCode };
    }

    // ─── Action: verify_tweet ───
    if (body.action === 'verify_tweet') {
      const tweetCode = agent.claimTweetCode || agent.phoneNumber?.replace(/\D/g, '').slice(-6);
      if (!tweetCode) {
        reply.code(400);
        return { error: 'Initialize tweet verification first' };
      }
      if (process.env.TWITTER_BEARER_TOKEN) {
        if (!body.tweetUrl?.trim()) {
          reply.code(400);
          return { error: 'Tweet URL required. Post the tweet with the code and paste its URL here.' };
        }
        const verified = await verifyTweetContainsCode(body.tweetUrl, tweetCode);
        if (!verified) {
          reply.code(400);
          return { error: 'Tweet not found or does not contain the verification code. Post the tweet and paste its URL.' };
        }
      }
      // When used as standalone method (finalize=true), claim the agent directly
      if (body.finalize) {
        const updated = (await db.update(agents)
          .set({
            verified: true,
            claimStatus: 'claimed',
            claimedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(agents.claimToken, token))
          .returning() as any[])[0];
        emitActivity('agent_verified', { agentId: updated.id, name: updated.name, method: 'tweet' });
        return { success: true, agent: updated, method: 'tweet' };
      }
      await db.update(agents)
        .set({
          claimStatus: 'twitter_verified',
          updatedAt: new Date(),
        })
        .where(eq(agents.claimToken, token));
      return { success: true };
    }

    // ─── Method: wallet (final step) ───
    if (body.method === 'wallet') {
      if (!body.walletAddress || !body.signature) {
        reply.code(400);
        return { error: 'walletAddress and signature are required for wallet verification' };
      }
      const agentId = agent.id;
      if (!verifySolanaClaimSignature(body.walletAddress, body.signature, agentId)) {
        reply.code(400);
        return { error: 'Invalid signature. Sign the exact message shown in the claim page.' };
      }
      const updated = (await db.update(agents)
        .set({
          verified: true,
          claimStatus: 'claimed',
          ownerWallet: body.walletAddress,
          claimedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agents.claimToken, token))
        .returning() as any[])[0];
      emitActivity('agent_verified', {
        agentId: updated.id,
        name: updated.name,
        method: 'wallet',
        wallet: body.walletAddress.slice(0, 8) + '...',
      });
      return { success: true, agent: updated, method: 'wallet' };
    }

    // ─── Method: email (legacy — immediate verify without code) ───
    if (body.method === 'email') {
      if (!body.email) {
        reply.code(400);
        return { error: 'email is required for email verification' };
      }
      const updated = (await db.update(agents)
        .set({
          verified: true,
          claimStatus: 'claimed',
          ownerEmail: body.email,
          claimedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agents.claimToken, token))
        .returning() as any[])[0];
      emitActivity('agent_verified', { agentId: updated.id, name: updated.name, method: 'email' });
      return { success: true, agent: updated, method: 'email' };
    }

    reply.code(400);
    return { error: 'Provide action (send_email_verification, verify_email, verify_tweet) or method (wallet, email)' };
  });

  // Get agent trust graph
  fastify.get('/:id/trust-graph', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Get ratings given by this agent (who they trust)
    const trustGiven = await db.select({
      raterId: schema.ratings.raterId,
      value: schema.ratings.value,
      weight: schema.ratings.weight,
      agentName: agents.name,
    })
      .from(schema.ratings)
      .leftJoin(agents, eq(schema.ratings.raterId, agents.id))
      .where(eq(schema.ratings.agentId, id));

    // Get ratings received by this agent (who trusts them)
    const trustReceived = await db.select({
      agentId: schema.ratings.agentId,
      value: schema.ratings.value,
      weight: schema.ratings.weight,
      agentName: agents.name,
    })
      .from(schema.ratings)
      .leftJoin(agents, eq(schema.ratings.agentId, agents.id))
      .where(eq(schema.ratings.raterId, id));

    return {
      trustGiven,
      trustReceived,
      trustScore: await db.select({ trustScore: agents.trustScore })
        .from(agents)
        .where(eq(agents.id, id))
        .then((res) => res[0]?.trustScore || 0),
    };
  });
}
