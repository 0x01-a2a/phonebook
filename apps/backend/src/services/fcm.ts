/**
 * Firebase Cloud Messaging (FCM) Service
 * 
 * Sends push notifications to Android devices to wake up sleeping agents.
 */

interface FCMMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: 'high' | 'normal';
}

interface FCMResponse {
  success: number;
  failure: number;
  results?: Array<{ error?: string }>;
}

// Configuration from environment
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY || '';
const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID || '';

/**
 * Send push notification via FCM
 */
export async function send(message: FCMMessage): Promise<FCMResponse> {
  if (!FCM_SERVER_KEY) {
    console.warn('[FCM] No server key configured, skipping send');
    return { success: 0, failure: 1, results: [{ error: 'FCM not configured' }] };
  }

  try {
    const response = await fetch(`https://fcm.googleapis.com/fcm/send`, {
      method: 'POST',
      headers: {
        'Authorization': `key=${FCM_SERVER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: message.token,
        notification: {
          title: message.title,
          body: message.body,
          sound: 'default',
          priority: message.priority || 'high',
        },
        data: message.data || {},
        content_available: true,
        priority: message.priority || 'high',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[FCM] Send failed:', error);
      return { success: 0, failure: 1, results: [{ error }] };
    }

    return response.json() as Promise<FCMResponse>;
  } catch (error) {
    console.error('[FCM] Error:', error);
    return { success: 0, failure: 1, results: [{ error: String(error) }] };
  }
}

/**
 * Send silent push notification (no UI, just wake the app)
 */
export async function sendSilent(token: string, data: Record<string, string>): Promise<FCMResponse> {
  return send({
    token,
    title: '',
    body: '',
    data,
    priority: 'high',
  });
}

/**
 * Verify FCM token is valid
 */
export async function verifyToken(token: string): Promise<boolean> {
  // In production, you would validate with Firebase Admin SDK
  // For now, we assume tokens are valid
  return !!token && token.length > 0;
}

/**
 * Subscribe to topic (for batch notifications)
 */
export async function subscribeToTopic(tokens: string[], topic: string): Promise<FCMResponse> {
  if (!FCM_SERVER_KEY) {
    return { success: 0, failure: tokens.length };
  }

  try {
    const response = await fetch(`https://iid.googleapis.com/iid/v1:batchAdd`, {
      method: 'POST',
      headers: {
        'Authorization': `key=${FCM_SERVER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: `/topics/${topic}`,
        registration_tokens: tokens,
      }),
    });

    return response.json() as Promise<FCMResponse>;
  } catch (error) {
    return { success: 0, failure: tokens.length };
  }
}
