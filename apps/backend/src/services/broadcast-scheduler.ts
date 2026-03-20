/**
 * Broadcast Scheduler — cron-based broadcast triggers
 *
 * Loads agents with broadcastEnabled=true and schedules periodic broadcasts.
 * Staggering: random offset per agent to avoid all broadcasting at once.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { db, agents, sql } from '@phonebook/database';
import type { VoiceConfig } from '@phonebook/database';
import { createBroadcast } from './broadcast-engine.js';
import { checkFfmpeg } from '../lib/audio-convert.js';

interface ScheduledAgent {
  agentId: string;
  task: ScheduledTask;
}

const scheduled = new Map<string, ScheduledAgent>();

/**
 * Initialize scheduler: load broadcast-enabled agents and schedule them.
 */
export async function initialize(): Promise<void> {
  // Check ffmpeg availability
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    console.warn('[Scheduler] ffmpeg not found — audio conversion will fail. Install with: apt install ffmpeg');
  }

  // Load agents with broadcastEnabled
  const broadcastAgents = await db
    .select({
      id: agents.id,
      name: agents.name,
      voiceConfig: agents.voiceConfig,
    })
    .from(agents)
    .where(sql`(${agents.voiceConfig}->>'broadcastEnabled')::boolean = true`);

  console.log(`[Scheduler] Found ${broadcastAgents.length} broadcast-enabled agents`);

  for (const agent of broadcastAgents) {
    scheduleAgent(agent.id, agent.voiceConfig as VoiceConfig);
  }
}

/**
 * Schedule a single agent for periodic broadcasting.
 */
export function scheduleAgent(agentId: string, vc?: VoiceConfig): void {
  // Remove existing schedule
  unscheduleAgent(agentId);

  const intervalMinutes = vc?.broadcastIntervalMinutes || 60;
  const topics = vc?.topics || [];

  if (topics.length === 0) {
    console.log(`[Scheduler] Agent ${agentId} has no topics configured, skipping`);
    return;
  }

  // Random offset (0-10 minutes) to stagger broadcasts
  const offsetMinutes = Math.floor(Math.random() * 10);
  const effectiveMinute = offsetMinutes % 60;

  // Build cron expression: every N minutes (with offset)
  let cronExpr: string;
  if (intervalMinutes >= 1440) {
    // Daily or longer — run once per day at the offset minute
    cronExpr = `${effectiveMinute} 0 * * *`;
  } else if (intervalMinutes >= 60) {
    const hours = Math.min(Math.floor(intervalMinutes / 60), 23);
    cronExpr = `${effectiveMinute} */${hours} * * *`;
  } else {
    cronExpr = `*/${intervalMinutes} * * * *`;
  }

  const task = cron.schedule(cronExpr, async () => {
    // Pick a random topic from the agent's list
    const topicSlug = topics[Math.floor(Math.random() * topics.length)];
    console.log(`[Scheduler] Triggering broadcast: agent=${agentId}, topic=${topicSlug}`);

    try {
      await createBroadcast({
        agentId,
        topicSlug,
        triggerType: 'cron',
      });
    } catch (error) {
      console.error(`[Scheduler] Broadcast failed for ${agentId}:`, error);
    }
  });

  scheduled.set(agentId, { agentId, task });
  console.log(`[Scheduler] Scheduled agent ${agentId}: cron="${cronExpr}", topics=[${topics.join(',')}]`);
}

/**
 * Remove an agent from the scheduler.
 */
export function unscheduleAgent(agentId: string): void {
  const existing = scheduled.get(agentId);
  if (existing) {
    existing.task.stop();
    scheduled.delete(agentId);
  }
}

/**
 * Graceful shutdown of all scheduled tasks.
 */
export function shutdown(): void {
  for (const [, entry] of scheduled) {
    entry.task.stop();
  }
  scheduled.clear();
  console.log('[Scheduler] All broadcast tasks stopped');
}
