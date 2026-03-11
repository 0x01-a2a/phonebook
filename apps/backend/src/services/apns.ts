/**
 * Apple Push Notification Service (APNs)
 * 
 * Sends push notifications to iOS devices to wake up sleeping agents.
 * Uses APNs HTTP/2 API for reliable delivery.
 */

interface APNsMessage {
  token: string;
  alert?: {
    title?: string;
    body?: string;
    subtitle?: string;
    'title-loc-key'?: string;
    'loc-args'?: string[];
  };
  payload?: Record<string, any>;
  priority?: number;
  expiration?: number;
  topic?: string;
}

interface APNsResponse {
  'apns-id'?: string;
  reason?: string;
}

// Configuration from environment
const APNS_KEY_ID = process.env.APNS_KEY_ID || '';
const APNS_TEAM_ID = process.env.APNS_TEAM_ID || '';
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'com.zeroclaw.agent';
const APNS_PRIVATE_KEY = process.env.APNS_PRIVATE_KEY || '';

// Cache for JWT token
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Generate JWT token for APNs authentication
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
    console.warn('[APNs] No credentials configured, using mock token');
    return 'mock-token';
  }

  // In production, use proper JWT signing with apple-apns library
  // For now, return a placeholder
  const now = Date.now();
  cachedToken = {
    token: `mock-jwt-token-${now}`,
    expiresAt: now + 3600000, // 1 hour
  };

  return cachedToken.token;
}

/**
 * Send push notification via APNs
 */
export async function send(message: APNsMessage): Promise<APNsResponse> {
  const token = await getAccessToken();

  if (!APNS_KEY_ID) {
    console.warn('[APNs] No credentials configured, skipping send');
    return { reason: 'APNs not configured' };
  }

  try {
    const response = await fetch(`https://api.push.apple.com/3/device/${message.token}`, {
      method: 'POST',
      headers: {
        'apns-topic': message.topic || APNS_BUNDLE_ID,
        'apns-priority': String(message.priority || 10),
        'apns-expiration': String(message.expiration || Math.floor(Date.now() / 1000) + 86400), // 24 hours
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        aps: {
          alert: message.alert || {},
          'content-available': 1, // Silent push - wakes app in background
          payload: message.payload || {},
        },
        ...message.payload,
      }),
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      console.error('[APNs] Send failed:', responseText);
      return { reason: responseText };
    }

    return { 'apns-id': response.headers.get('apns-id') || undefined };
  } catch (error) {
    console.error('[APNs] Error:', error);
    return { reason: String(error) };
  }
}

/**
 * Send silent push notification (background refresh)
 */
export async function sendSilent(token: string, payload: Record<string, any>): Promise<APNsResponse> {
  return send({
    token,
    payload,
    priority: 5, // Low priority for background
    expiration: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  });
}

/**
 * Send notification with custom sound
 */
export async function sendWithSound(token: string, title: string, body: string, sound: string = 'default'): Promise<APNsResponse> {
  return send({
    token,
    alert: { title, body },
    payload: { sound },
    priority: 10,
  });
}

/**
 * Verify APNs token format
 */
export function isValidToken(token: string): boolean {
  // APNs tokens are 64-character hex strings
  return /^[a-f0-9]{64}$/.test(token);
}

/**
 * Get APNs connection status
 */
export async function getConnectionStatus(): Promise<{ connected: boolean; reason?: string }> {
  if (!APNS_KEY_ID) {
    return { connected: false, reason: 'APNs not configured' };
  }

  try {
    // Test connection with a fake token
    const response = await fetch(`https://api.push.apple.com/3/device/0000000000000000000000000000000000000000000000000000000000000000`, {
      method: 'POST',
      headers: {
        'apns-topic': APNS_BUNDLE_ID,
        'Authorization': `Bearer ${await getAccessToken()}`,
      },
      body: JSON.stringify({ aps: {} }),
    });

    // 400 Bad Request is expected for invalid token, means we're connected
    return { connected: response.status === 400 };
  } catch (error) {
    return { connected: false, reason: String(error) };
  }
}
