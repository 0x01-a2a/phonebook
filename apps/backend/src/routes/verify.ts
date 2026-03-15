/**
 * Additional verification endpoints — strengthen agent identity after initial claim.
 *
 * POST /api/verify/:id/email   — add email verification badge
 * POST /api/verify/:id/wallet  — add Phantom wallet badge
 *
 * Both require X-Agent-Id + X-Agent-Secret (agent must own the resource).
 * Each method can only be added once per agent.
 */
import type { FastifyInstance } from 'fastify';
import { agents, db, eq } from '@phonebook/database';
import crypto from 'crypto';
import { requireAgentOwnership } from '../auth.js';
import { sendClaimVerificationEmail } from '../services/send-email.js';
import { verifySolanaClaimSignature } from '../verify-solana.js';

export async function verifyRouter(fastify: FastifyInstance) {

  /**
   * POST /api/verify/:id/email
   * Body (step 1): { action: 'send_code', email: 'user@example.com' }
   * Body (step 2): { action: 'confirm_code', code: '123456' }
   */
  fastify.post('/:id/email', { preHandler: requireAgentOwnership }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { action: 'send_code' | 'confirm_code'; email?: string; code?: string };

    const [agent] = await db.select({
      id: agents.id,
      name: agents.name,
      verifiedMethods: agents.verifiedMethods,
      claimEmailCode: agents.claimEmailCode,
      claimEmailCodeExpires: agents.claimEmailCodeExpires,
      ownerEmail: agents.ownerEmail,
    }).from(agents).where(eq(agents.id, id)).limit(1);

    if (!agent) { reply.code(404); return { error: 'Agent not found' }; }

    const methods = (agent.verifiedMethods as string[]) ?? [];
    if (methods.includes('email')) {
      reply.code(409);
      return { error: 'Email already verified for this agent' };
    }

    // ─── Step 1: send code ───
    if (body.action === 'send_code') {
      if (!body.email?.includes('@')) { reply.code(400); return { error: 'Valid email required' }; }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + 15 * 60 * 1000);
      await db.update(agents).set({
        ownerEmail: body.email,
        claimEmailCode: code,
        claimEmailCodeExpires: expires,
        updatedAt: new Date(),
      }).where(eq(agents.id, id));
      const { ok, error } = await sendClaimVerificationEmail(body.email, agent.name, code);
      if (!ok && process.env.RESEND_API_KEY) { reply.code(500); return { error: error || 'Failed to send email' }; }
      const devCode = !process.env.RESEND_API_KEY ? code : undefined;
      return { success: true, ...(devCode && { devCode }) };
    }

    // ─── Step 2: confirm code ───
    if (body.action === 'confirm_code') {
      if (!body.code || body.code.length !== 6) { reply.code(400); return { error: '6-digit code required' }; }
      if (agent.claimEmailCode !== body.code) { reply.code(400); return { error: 'Invalid code' }; }
      if (agent.claimEmailCodeExpires && new Date() > agent.claimEmailCodeExpires) {
        reply.code(400); return { error: 'Code expired' };
      }
      const newMethods = [...methods, 'email'];
      await db.update(agents).set({
        verifiedMethods: newMethods,
        claimEmailCode: null,
        claimEmailCodeExpires: null,
        updatedAt: new Date(),
      }).where(eq(agents.id, id));
      return { success: true, verifiedMethods: newMethods };
    }

    reply.code(400);
    return { error: 'action must be send_code or confirm_code' };
  });

  /**
   * POST /api/verify/:id/wallet
   * Body: { walletAddress: string, signature: string }
   * Signs "Claim agent {id} for 0x01 PhoneBook" — same message as initial claim.
   */
  fastify.post('/:id/wallet', { preHandler: requireAgentOwnership }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { walletAddress, signature } = request.body as { walletAddress?: string; signature?: string };

    if (!walletAddress || !signature) {
      reply.code(400); return { error: 'walletAddress and signature required' };
    }

    const [agent] = await db.select({
      id: agents.id,
      verifiedMethods: agents.verifiedMethods,
    }).from(agents).where(eq(agents.id, id)).limit(1);

    if (!agent) { reply.code(404); return { error: 'Agent not found' }; }

    const methods = (agent.verifiedMethods as string[]) ?? [];
    if (methods.includes('wallet')) {
      reply.code(409); return { error: 'Wallet already verified for this agent' };
    }

    if (!verifySolanaClaimSignature(walletAddress, signature, id)) {
      reply.code(401); return { error: 'Invalid signature' };
    }

    const newMethods = [...methods, 'wallet'];
    await db.update(agents).set({
      verifiedMethods: newMethods,
      ownerWallet: walletAddress,
      updatedAt: new Date(),
    }).where(eq(agents.id, id));

    return { success: true, verifiedMethods: newMethods };
  });
}
