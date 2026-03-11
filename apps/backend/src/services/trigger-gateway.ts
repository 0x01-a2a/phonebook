/**
 * Off-Grid Trigger Gateway
 * 
 * Handles waking up sleeping agents via:
 * - FCM (Firebase Cloud Messaging) for Android
 * - APNs (Apple Push Notification Service) for iOS
 * - Webhook for cloud agents
 * 
 * This is the "Regional Gateway" that receives PROPOSE messages
 * and fires appropriate wake signals to mobile/cloud nodes.
 */

import { deviceTriggers, pendingJobs, wakeEvents, gatewayNodes, agents } from '@phonebook/database';
import { db, schema } from '@phonebook/database';
import { eq, desc, and, or, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';

// Push notification providers
import * as FCM from './fcm';
import * as APNs from './apns';
import * as aggregator from './aggregator-bridge';

// Configuration
const DEFAULT_WAKE_TIMEOUT = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;

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

const createJobSchema = z.object({
  fromAgentId: z.string().uuid().optional(),
  toAgentId: z.string().uuid().optional(),
  jobType: z.enum(['task', 'payment', 'message', 'call']),
  payload: z.record(z.any()),
  priority: z.number().int().default(0),
  expiresInMinutes: z.number().default(60),
  minPayment: z.string().optional(),
});

/**
 * Register a device trigger for an agent
 */
export async function registerDeviceTrigger(data: z.infer<typeof registerDeviceSchema>) {
  // Check if agent exists
  const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, data.agentId)).limit(1);
  if (!agent) {
    throw new Error('Agent not found');
  }

  // Check for existing registration
  const existing = await db.select()
    .from(deviceTriggers)
    .where(
      and(
        eq(deviceTriggers.agentId, data.agentId),
        eq(deviceTriggers.deviceType, data.deviceType)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing
    const updated = (await db.update(deviceTriggers)
      .set({
        pushToken: data.pushToken,
        webhookUrl: data.webhookUrl,
        fcmToken: data.fcmToken,
        apnsToken: data.apnsToken,
        capabilities: data.capabilities,
        minJobPayment: data.minJobPayment,
        region: data.region,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(deviceTriggers.id, existing[0].id))
      .returning() as any[])[0];
    return updated;
  }

  // Create new
  const created = (await db.insert(deviceTriggers).values({
    agentId: data.agentId,
    deviceType: data.deviceType,
    pushToken: data.pushToken,
    webhookUrl: data.webhookUrl,
    fcmToken: data.fcmToken,
    apnsToken: data.apnsToken,
    capabilities: data.capabilities,
    minJobPayment: data.minJobPayment,
    region: data.region,
    isActive: true,
    lastSeen: new Date(),
    batteryLevel: 100,
    registeredAt: new Date(),
  }).returning() as any[])[0];

  return created;
}

/**
 * Update device presence and battery
 */
export async function updateDeviceStatus(
  deviceId: string,
  status: { batteryLevel?: number; isActive?: boolean }
) {
  const updated = (await db.update(deviceTriggers)
    .set({
      ...status,
      lastSeen: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deviceTriggers.id, deviceId))
    .returning() as any[])[0];

  return updated;
}

/**
 * Create a pending job and trigger wake if agent is offline
 */
export async function createAndDispatchJob(data: z.infer<typeof createJobSchema>) {
  // If specific agent requested, check if they're online
  let targetDevice: typeof deviceTriggers.$inferSelect | null = null;
  
  if (data.toAgentId) {
    const devices = await db.select()
      .from(deviceTriggers)
      .where(
        and(
          eq(deviceTriggers.agentId, data.toAgentId),
          eq(deviceTriggers.isActive, true)
        )
      )
      .limit(1);
    
    if (devices.length > 0) {
      targetDevice = devices[0];
    }
  } else {
    // Find any available agent with matching capabilities
    const devices = await db.select()
      .from(deviceTriggers)
      .where(
        and(
          eq(deviceTriggers.isActive, true),
          sql`${deviceTriggers.minJobPayment} <= ${data.minPayment || '0.001'}`
        )
      )
      .orderBy(desc(deviceTriggers.lastSeen))
      .limit(1);
    
    if (devices.length > 0) {
      targetDevice = devices[0];
    }
  }

  // Create job record
  const job = (await db.insert(pendingJobs).values({
    fromAgentId: data.fromAgentId,
    toAgentId: data.toAgentId,
    jobType: data.jobType,
    payload: data.payload,
    priority: data.priority,
    expiresAt: new Date(Date.now() + data.expiresInMinutes * 60 * 1000),
    status: 'pending',
  }).returning() as any[])[0];

  // If we found a device, trigger wake
  if (targetDevice) {
    await triggerWake(targetDevice, job.id);
  }

  return { job, deviceTriggerId: targetDevice?.id };
}

/**
 * Trigger wake on a specific device
 */
export async function triggerWake(device: typeof deviceTriggers.$inferSelect, jobId: string) {
  const startTime = Date.now();
  let wakeType: 'fcm' | 'apns' | 'webhook';
  let status: 'sent' | 'delivered' | 'failed' = 'failed';

  try {
    // Try the 0x01 aggregator first -- it already has the FCM token
    // from the node's register_fcm_token() and handles delivery natively.
    if (device.deviceType !== 'cloud') {
      const sent = await aggregator.sendWakeViaAggregator(
        device.agentId,
        'phonebook-gateway',
        jobId,
      );
      if (sent) {
        wakeType = device.deviceType === 'android' ? 'fcm' : 'apns';
        status = 'sent';
      }
    }

    // Fall back to direct push / webhook if aggregator didn't handle it
    if (status === 'failed') {
      if (device.deviceType === 'android' && device.fcmToken) {
        await FCM.send({
          token: device.fcmToken,
          title: 'Job Available!',
          body: 'You have a new job waiting. Open to accept.',
          data: { jobId, type: 'wake' },
        });
        wakeType = 'fcm';
      } else if (device.deviceType === 'ios' && device.apnsToken) {
        await APNs.send({
          token: device.apnsToken,
          alert: { title: 'Job Available!', body: 'You have a new job waiting.' },
          payload: { jobId, type: 'wake' },
        });
        wakeType = 'apns';
      } else if (device.deviceType === 'cloud' && device.webhookUrl) {
        await fetch(device.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, type: 'wake' }),
        });
        wakeType = 'webhook';
      } else {
        throw new Error('No valid wake channel available');
      }
      status = 'sent';
    }
  } catch (error) {
    console.error('Wake trigger failed:', error);
    status = 'failed';
  }

  // Log wake event
  const latency = Date.now() - startTime;
  const wakeEvent = (await db.insert(wakeEvents).values({
    deviceTriggerId: device.id,
    jobId,
    wakeType,
    status,
    latency,
    createdAt: new Date(),
  }).returning() as any[])[0];

  // Update job status
  if (status === 'sent') {
    await db.update(pendingJobs)
      .set({ status: 'dispatched', dispatchedAt: new Date() })
      .where(eq(pendingJobs.id, jobId));
  }

  return wakeEvent;
}

/**
 * Handle job completion callback from device
 */
export async function completeJob(jobId: string, result: Record<string, any>) {
  const updated = (await db.update(pendingJobs)
    .set({
      status: 'completed',
      completedAt: new Date(),
      payload: sql`${JSON.stringify({ ...result, completedAt: new Date().toISOString() })}`,
    })
    .where(eq(pendingJobs.id, jobId))
    .returning() as any[])[0];

  return updated;
}

/**
 * Get pending jobs for a device
 */
export async function getPendingJobs(deviceId: string) {
  const device = await db.select()
    .from(deviceTriggers)
    .where(eq(deviceTriggers.id, deviceId))
    .limit(1);

  if (!device.length) return [];

  const jobs = await db.select()
    .from(pendingJobs)
    .where(
      and(
        eq(pendingJobs.status, 'dispatched'),
        or(
          eq(pendingJobs.toAgentId, device[0].agentId),
          isNull(pendingJobs.toAgentId)
        ),
        sql`${pendingJobs.expiresAt} > NOW()`
      )
    )
    .orderBy(desc(pendingJobs.priority))
    .limit(10);

  return jobs;
}

/**
 * Clean up expired jobs
 */
export async function cleanupExpiredJobs() {
  const result = await db.update(pendingJobs)
    .set({ status: 'expired' })
    .where(
      and(
        eq(pendingJobs.status, 'pending'),
        sql`${pendingJobs.expiresAt} < NOW()`
      )
    )
    .returning();

  return result;
}

/**
 * Get device statistics
 */
export async function getDeviceStats(agentId: string) {
  const devices = await db.select()
    .from(deviceTriggers)
    .where(eq(deviceTriggers.agentId, agentId));

  const stats = {
    totalDevices: devices.length,
    activeDevices: devices.filter(d => d.isActive).length,
    byType: {} as Record<string, number>,
    lastSeen: devices[0]?.lastSeen,
  };

  for (const device of devices) {
    stats.byType[device.deviceType] = (stats.byType[device.deviceType] || 0) + 1;
  }

  return stats;
}
