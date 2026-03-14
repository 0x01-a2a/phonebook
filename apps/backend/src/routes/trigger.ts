import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as trigger from '../services/trigger-gateway.js';
import { requireAgentAuth } from '../auth.js';
import { db } from '@phonebook/database';
import { deviceTriggers, pendingJobs, agents } from '@phonebook/database';
import { eq, desc } from '@phonebook/database';

const registerDeviceSchema = z.object({
  agentId: z.string().uuid(),
  deviceType: z.enum(['ios', 'android', 'cloud']),
  pushToken: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  fcmToken: z.string().optional(),
  apnsToken: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  minJobPayment: z.string().default('0.001'),
  region: z.string().default('us-east'),
});

const updateStatusSchema = z.object({
  batteryLevel: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

const createJobSchema = z.object({
  fromAgentId: z.string().uuid().optional(),
  toAgentId: z.string().uuid().optional(),
  jobType: z.enum(['task', 'payment', 'message', 'call']),
  payload: z.record(z.any()),
  priority: z.number().int().default(0),
  expiresInMinutes: z.number().default(60),
  minPayment: z.string().optional(),
});

export async function triggerRouter(fastify: FastifyInstance) {
  // Register a device trigger (requires auth; agent can only register for themselves)
  fastify.post('/devices/register', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const body = registerDeviceSchema.parse(request.body);
    const agentId = (request as any).agent.id;
    const data = { ...body, agentId }; // Override agentId with authenticated agent
    
    try {
      const device = await trigger.registerDeviceTrigger(data);
      reply.code(201);
      return device;
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Failed to register device' };
    }
  });

  // Update device status (battery, online/offline)
  fastify.patch('/devices/:id/status', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateStatusSchema.parse(request.body);

    try {
      const device = await trigger.updateDeviceStatus(id, data);
      if (!device) {
        reply.code(404);
        return { error: 'Device not found' };
      }
      return device;
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Failed to update status' };
    }
  });

  // Get device stats for an agent
  fastify.get('/devices/stats/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };

    try {
      const stats = await trigger.getDeviceStats(agentId);
      return stats;
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get stats' };
    }
  });

  // Create and dispatch a job (requires auth; triggers wake if agent is offline)
  fastify.post('/jobs', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const data = createJobSchema.parse(request.body);
    const agentId = (request as any).agent.id;
    if (!data.fromAgentId) {
      data.fromAgentId = agentId;
    }

    try {
      const result = await trigger.createAndDispatchJob(data);
      reply.code(201);
      return result;
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Failed to create job' };
    }
  });

  // Get pending jobs for a device (called by mobile app when it wakes up)
  fastify.get('/jobs/pending/:deviceId', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };

    try {
      const jobs = await trigger.getPendingJobs(deviceId);
      return { jobs };
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get jobs' };
    }
  });

  // Complete a job
  fastify.post('/jobs/:id/complete', {
    preHandler: requireAgentAuth,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { result } = request.body as { result: Record<string, any> };

    try {
      const job = await trigger.completeJob(id, result);
      if (!job) {
        reply.code(404);
        return { error: 'Job not found' };
      }
      return job;
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Failed to complete job' };
    }
  });

  // Acknowledge wake received (for latency tracking)
  fastify.post('/wake/:eventId/ack', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };

    // In production, update wake event with acknowledgment
    return { success: true, eventId };
  });

  // List all registered devices (public, for dashboard)
  fastify.get('/devices', async (request, reply) => {
    try {
      const rows = await db
        .select({
          id: deviceTriggers.id,
          agentId: deviceTriggers.agentId,
          agentName: agents.name,
          deviceType: deviceTriggers.deviceType,
          isActive: deviceTriggers.isActive,
          lastSeen: deviceTriggers.lastSeen,
          batteryLevel: deviceTriggers.batteryLevel,
          capabilities: deviceTriggers.capabilities,
          minJobPayment: deviceTriggers.minJobPayment,
          region: deviceTriggers.region,
        })
        .from(deviceTriggers)
        .leftJoin(agents, eq(deviceTriggers.agentId, agents.id))
        .orderBy(desc(deviceTriggers.updatedAt));
      return { devices: rows };
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to list devices' };
    }
  });

  // List recent jobs (public, for dashboard)
  fastify.get('/jobs', async (request, reply) => {
    try {
      const rows = await db
        .select({
          id: pendingJobs.id,
          fromAgentId: pendingJobs.fromAgentId,
          toAgentId: pendingJobs.toAgentId,
          jobType: pendingJobs.jobType,
          payload: pendingJobs.payload,
          status: pendingJobs.status,
          priority: pendingJobs.priority,
          createdAt: pendingJobs.createdAt,
        })
        .from(pendingJobs)
        .orderBy(desc(pendingJobs.createdAt))
        .limit(50);
      return { jobs: rows };
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to list jobs' };
    }
  });

  // Health check for gateway
  fastify.get('/health', async () => {
    return { 
      status: 'ok', 
      service: 'trigger-gateway',
      timestamp: new Date().toISOString(),
      capabilities: ['fcm', 'apns', 'webhook'],
    };
  });
}
