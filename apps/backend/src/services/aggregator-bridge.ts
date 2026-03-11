/**
 * 0x01 Aggregator Bridge
 *
 * Bridges PhoneBook's trigger-gateway with the 0x01 mesh aggregator.
 * The aggregator already manages FCM tokens, sleep states, and pending
 * message queues at the protocol level. PhoneBook uses it as the
 * delivery layer while keeping its own job tracking and metrics.
 *
 * Aggregator endpoints used:
 *   POST /agents/{id}/pending  - queue a message for a sleeping agent (triggers FCM)
 *   GET  /agents/{id}/sleeping - check if an agent is currently sleeping
 *   POST /fcm/register         - register an FCM token (done by the node binary)
 *   POST /fcm/sleep            - set sleep mode (done by the node binary)
 */

const AGGREGATOR_URL = process.env.AGGREGATOR_URL || 'http://localhost:8080';
const BRIDGE_TIMEOUT_MS = 5000;

export interface AggregatorPendingMessage {
  from: string;
  msg_type: string;
  payload: string;
}

/**
 * Check if an agent is sleeping on the mesh.
 * Returns true if the agent is in sleep mode at the aggregator.
 */
export async function isAgentSleeping(agentId: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);

  try {
    const res = await fetch(`${AGGREGATOR_URL}/agents/${agentId}/sleeping`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return false;
    const data: { sleeping?: boolean } = await res.json();
    return data.sleeping === true;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

/**
 * Queue a wake message on the aggregator for a sleeping agent.
 * The aggregator will send an FCM push with action: "wake" to
 * the agent's registered device token.
 *
 * Returns true if the aggregator accepted the message.
 */
export async function sendWakeViaAggregator(
  agentId: string,
  fromAgentId: string,
  jobId: string,
  msgType: string = 'PROPOSE',
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);

  try {
    const res = await fetch(`${AGGREGATOR_URL}/agents/${agentId}/pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        from: fromAgentId,
        msg_type: msgType,
        payload: JSON.stringify({ jobId, type: 'wake', source: 'phonebook' }),
      }),
    });
    clearTimeout(timeout);

    return res.ok;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

/**
 * Check if the aggregator is reachable.
 */
export async function isAggregatorAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(`${AGGREGATOR_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}
