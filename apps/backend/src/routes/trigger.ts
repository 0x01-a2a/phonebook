import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as trigger from '../services/trigger-gateway.js';

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
  // Register a device trigger
  fastify.post('/devices/register', async (request, reply) => {
    const data = registerDeviceSchema.parse(request.body);
    
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
  fastify.patch('/devices/:id/status', async (request, reply) => {
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

  // Create and dispatch a job (triggers wake if agent is offline)
  fastify.post('/jobs', async (request, reply) => {
    const data = createJobSchema.parse(request.body);
    const agentId = request.headers['x-agent-id'] as string;
    
    if (agentId && !data.fromAgentId) {
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
  fastify.get('/jobs/pending/:deviceId', async (request, reply) => {
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
  fastify.post('/jobs/:id/complete', async (request, reply) => {
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
