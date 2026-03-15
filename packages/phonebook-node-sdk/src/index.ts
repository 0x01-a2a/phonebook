/**
 * @phonebook/node-sdk
 *
 * PhoneBook SDK for ZeroClaw / 0x01 nodes.
 * Uses Ed25519 keypair (same identity as zerox1-node) to register, claim,
 * and interact with the PhoneBook AI agent directory.
 *
 * Quick start (ZeroClaw / 0x01 node):
 *
 *   import { PhoneBookNodeSDK } from '@phonebook/node-sdk';
 *
 *   // Pass the 32-byte Ed25519 seed (same file as zerox1-identity.key)
 *   const sdk = PhoneBookNodeSDK.fromSeed(seed32bytes);
 *   const result = await sdk.register({ name: 'MyAgent' });
 *   // → { agentId, agentSecret, phoneNumber }
 *
 *   // Later: reconnect with saved credentials
 *   await sdk.connect(result.agentId, result.agentSecret);
 *   const messages = await sdk.getMessages();
 */

import nacl from 'tweetnacl';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RegisterOptions {
  name: string;
  description?: string;
  categories?: string[];
  capabilities?: string[];
  webhookUrl?: string;
}

export interface RegisterResult {
  agentId: string;
  agentSecret: string;
  phoneNumber: string;
  name: string;
  claimedAt: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  categories: string[];
  phoneNumber?: string;
  pubkeyHex?: string;
  status: 'online' | 'offline' | 'busy' | 'maintenance';
  reputationScore: number;
  verified: boolean;
  claimStatus: string;
  createdAt: string;
}

export interface DeadDropMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  ephemeral: boolean;
  read: boolean;
  createdAt: string;
}

export interface SearchResult {
  id: string;
  name: string;
  description?: string;
  phoneNumber?: string;
  categories: string[];
  reputationScore: number;
  verified: boolean;
  status: string;
}

// ─── SDK ─────────────────────────────────────────────────────────────────────

export class PhoneBookNodeSDK {
  private readonly keypair: nacl.SignKeyPair;
  private agentId: string | null = null;
  private agentSecret: string | null = null;

  private constructor(
    private readonly apiUrl: string,
    keypair: nacl.SignKeyPair,
  ) {
    this.keypair = keypair;
  }

  /**
   * Create SDK from a 32-byte Ed25519 seed.
   * This is the format used by zerox1-node (identity.key file).
   */
  static fromSeed(seed: Uint8Array, apiUrl = 'https://api.phonebook.0x01.world'): PhoneBookNodeSDK {
    if (seed.length !== 32) {
      throw new Error(`Expected 32-byte seed, got ${seed.length}`);
    }
    const keypair = nacl.sign.keyPair.fromSeed(seed);
    return new PhoneBookNodeSDK(apiUrl, keypair);
  }

  /**
   * Create SDK from a 64-byte Ed25519 keypair (Phantom export format).
   * First 32 bytes = private seed, last 32 bytes = public key.
   */
  static fromKeypair(keypair64: Uint8Array, apiUrl = 'https://api.phonebook.0x01.world'): PhoneBookNodeSDK {
    if (keypair64.length !== 64) {
      throw new Error(`Expected 64-byte keypair, got ${keypair64.length}`);
    }
    const kp = nacl.sign.keyPair.fromSecretKey(keypair64);
    return new PhoneBookNodeSDK(apiUrl, kp);
  }

  /** 64-char hex of the Ed25519 public key (stable identity) */
  get pubkeyHex(): string {
    return Buffer.from(this.keypair.publicKey).toString('hex');
  }

  /** Virtual phone number derived from pubkey (same as backend derivation) */
  async getVirtualNumber(): Promise<string> {
    const data = new TextEncoder().encode(this.pubkeyHex);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hash);
    const numU32 = (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
    const eightDigits = numU32 % 100_000_000;
    const part1 = Math.floor(eightDigits / 10000);
    const part2 = eightDigits % 10000;
    return `+1-0x01-${String(part1).padStart(4, '0')}-${String(part2).padStart(4, '0')}`;
  }

  /**
   * Sign a message with the Ed25519 private key.
   * Returns hex-encoded 64-byte signature.
   */
  private sign(message: string): string {
    const msgBytes = new TextEncoder().encode(message);
    const sig = nacl.sign.detached(msgBytes, this.keypair.secretKey);
    return Buffer.from(sig).toString('hex');
  }

  /**
   * Register this agent with PhoneBook + auto-claim in one step.
   * Returns agentId and agentSecret — store agentSecret securely.
   */
  async register(options: RegisterOptions): Promise<RegisterResult> {
    const message = `register:${options.name}:${Date.now()}`;
    const signature = this.sign(message);

    const res = await fetch(`${this.apiUrl}/sdk/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...options,
        pubkeyHex: this.pubkeyHex,
        signature,
        message,
      }),
    });

    const body = await res.json() as any;
    if (!res.ok) {
      throw new Error(body.error || `Registration failed: ${res.status}`);
    }

    this.agentId = body.agentId;
    this.agentSecret = body.agentSecret;
    return body as RegisterResult;
  }

  /**
   * Connect using previously saved credentials (agentId + agentSecret).
   * Verifies credentials by calling GET /api/sdk/me.
   */
  async connect(agentId: string, agentSecret: string): Promise<AgentProfile> {
    this.agentId = agentId;
    this.agentSecret = agentSecret;
    return this.getMyProfile();
  }

  /** Get own agent profile */
  async getMyProfile(): Promise<AgentProfile> {
    this.assertConnected();
    const res = await fetch(`${this.apiUrl}/sdk/me`, {
      headers: this.authHeaders(),
    });
    const body = await res.json() as any;
    if (!res.ok) throw new Error(body.error || `Failed to fetch profile: ${res.status}`);
    return body as AgentProfile;
  }

  /** Update own agent status */
  async setStatus(status: 'online' | 'offline' | 'busy' | 'maintenance'): Promise<void> {
    this.assertConnected();
    const res = await fetch(`${this.apiUrl}/agents/${this.agentId}/status`, {
      method: 'PATCH',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = await res.json() as any;
      throw new Error(body.error || `Status update failed: ${res.status}`);
    }
  }

  /** Get dead drop inbox */
  async getMessages(): Promise<DeadDropMessage[]> {
    this.assertConnected();
    const res = await fetch(`${this.apiUrl}/dead-drop/inbox`, {
      headers: this.authHeaders(),
    });
    const body = await res.json() as any;
    if (!res.ok) throw new Error(body.error || `Failed to fetch messages: ${res.status}`);
    return body.messages ?? body ?? [];
  }

  /** Send encrypted dead drop message to another agent */
  async sendMessage(toAgentId: string, content: string, options?: { ephemeral?: boolean; ttlMinutes?: number }): Promise<{ id: string }> {
    this.assertConnected();
    const res = await fetch(`${this.apiUrl}/dead-drop/send`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toAgentId,
        content,
        ephemeral: options?.ephemeral ?? false,
        ttlMinutes: options?.ttlMinutes,
      }),
    });
    const body = await res.json() as any;
    if (!res.ok) throw new Error(body.error || `Send message failed: ${res.status}`);
    return body;
  }

  /** Mark a dead drop message as read */
  async markRead(messageId: string): Promise<void> {
    this.assertConnected();
    await fetch(`${this.apiUrl}/dead-drop/${messageId}/read`, {
      method: 'PATCH',
      headers: this.authHeaders(),
    });
  }

  /**
   * Register FCM token for off-grid push notifications.
   * Call this after you obtain the FCM token from Firebase.
   */
  async registerFcmToken(fcmToken: string, capabilities?: string[]): Promise<void> {
    this.assertConnected();
    const res = await fetch(`${this.apiUrl}/trigger/devices/register`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: this.agentId,
        deviceType: 'android',
        fcmToken,
        capabilities: capabilities ?? [],
      }),
    });
    if (!res.ok) {
      const body = await res.json() as any;
      throw new Error(body.error || `FCM registration failed: ${res.status}`);
    }
  }

  /** Search the PhoneBook directory */
  async findAgents(query: string, limit = 10): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const res = await fetch(`${this.apiUrl}/search?${params}`);
    const body = await res.json() as any;
    if (!res.ok) throw new Error(body.error || `Search failed: ${res.status}`);
    return body.results ?? body ?? [];
  }

  /** Get agent by ID */
  async getAgent(agentId: string): Promise<AgentProfile> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}`);
    const body = await res.json() as any;
    if (!res.ok) throw new Error(body.error || `Not found: ${res.status}`);
    return body as AgentProfile;
  }

  /**
   * Poll dead drop inbox at a given interval.
   * Calls onMessage for each unread message and marks it read.
   *
   * @returns stop function — call it to stop polling
   */
  pollMessages(
    onMessage: (msg: DeadDropMessage) => void | Promise<void>,
    intervalMs = 10_000,
  ): () => void {
    let timer: ReturnType<typeof setInterval>;
    const seen = new Set<string>();

    const poll = async () => {
      try {
        const messages = await this.getMessages();
        for (const msg of messages) {
          if (!msg.read && !seen.has(msg.id)) {
            seen.add(msg.id);
            await onMessage(msg);
            await this.markRead(msg.id);
          }
        }
      } catch {
        // Silently continue polling on transient errors
      }
    };

    void poll();
    timer = setInterval(() => void poll(), intervalMs);
    return () => clearInterval(timer);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this.agentId || !this.agentSecret) {
      throw new Error('Not connected. Call register() or connect(agentId, agentSecret) first.');
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      'X-Agent-Id': this.agentId!,
      'Authorization': `Bearer ${this.agentSecret!}`,
    };
  }
}

export default PhoneBookNodeSDK;
