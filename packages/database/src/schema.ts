import { pgTable, uuid, varchar, text, timestamp, boolean, real, jsonb, pgEnum, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const agentStatusEnum = pgEnum('agent_status', ['online', 'offline', 'busy', 'maintenance']);
export const ratingDimensionEnum = pgEnum('rating_dimension', ['response_speed', 'accuracy', 'communication', 'reliability', 'helpfulness']);
export const transactionTypeEnum = pgEnum('transaction_type', ['contact', 'dead_drop', 'featured_listing', 'voice_call']);
export const transactionStatusEnum = pgEnum('transaction_status', ['pending', 'completed', 'failed', 'refunded']);

// Categories table
export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  color: varchar('color', { length: 7 }).default('#8B7355'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Agents table
export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 40 }).notNull().unique(),
  description: text('description'),
  categories: jsonb('categories').$type<string[]>().default([]),
  whatsappNumber: varchar('whatsapp_number', { length: 20 }),
  whatsappDisplay: varchar('whatsapp_display', { length: 100 }),
  whatsappVcardUrl: varchar('whatsapp_vcard_url', { length: 500 }),
  contactWebhook: varchar('contact_webhook', { length: 500 }),
  contactEmail: varchar('contact_email', { length: 255 }),
  pixelBannerGif: varchar('pixel_banner_gif', { length: 500 }),
  pixelBannerFrames: jsonb('pixel_banner_frames').$type<PixelBannerFrame[]>(),
  status: agentStatusEnum('status').default('offline').notNull(),
  reputationScore: real('reputation_score').default(0),
  trustScore: real('trust_score').default(1.0),
  backupAgentId: uuid('backup_agent_id').references(() => agents.id),
  profileTtl: timestamp('profile_ttl'),
  baseWalletAddress: varchar('base_wallet_address', { length: 62 }),
  phoneNumber: varchar('phone_number', { length: 20 }).unique(),
  voiceEnabled: boolean('voice_enabled').default(false),
  voiceConfig: jsonb('voice_config').$type<VoiceConfig>(),
  verified: boolean('verified').default(false),
  featured: boolean('featured').default(false),
  claimToken: varchar('claim_token', { length: 64 }).unique(),
  claimStatus: varchar('claim_status', { length: 20 }).default('unclaimed'),
  ownerWallet: varchar('owner_wallet', { length: 64 }),
  ownerEmail: varchar('owner_email', { length: 255 }),
  claimedAt: timestamp('claimed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const agentsRelations = relations(agents, ({ one, many }) => ({
  backupAgent: one(agents, {
    fields: [agents.backupAgentId],
    references: [agents.id],
  }),
  ratings: many(ratings),
  proofOfWorkScores: many(proofOfWorkScores),
  transactions: many(transactions),
}));

// Ratings table
export const ratings = pgTable('ratings', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  raterId: uuid('rater_id').notNull().references(() => agents.id),
  dimension: ratingDimensionEnum('dimension').notNull(),
  value: real('value').notNull(), // 1-5
  comment: text('comment'),
  weight: real('weight').default(1.0),
  decayFactor: real('decay_factor').default(1.0),
  isMutual: boolean('is_mutual').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ratingsRelations = relations(ratings, ({ one }) => ({
  agent: one(agents, {
    fields: [ratings.agentId],
    references: [agents.id],
  }),
  rater: one(agents, {
    fields: [ratings.raterId],
    references: [agents.id],
  }),
}));

// Proof of Work Scores
export const proofOfWorkScores = pgTable('proof_of_work_scores', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  challengeId: varchar('challenge_id', { length: 100 }).notNull(),
  challengeType: varchar('challenge_type', { length: 50 }).notNull(),
  score: real('score').notNull(),
  verified: boolean('verified').default(false),
  proofData: jsonb('proof_data'),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
});

export const proofOfWorkScoresRelations = relations(proofOfWorkScores, ({ one }) => ({
  agent: one(agents, {
    fields: [proofOfWorkScores.agentId],
    references: [agents.id],
  }),
}));

// Challenges
export const challenges = pgTable('challenges', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull(),
  type: varchar('type', { length: 50 }).notNull(), // writer, coder, researcher, etc.
  difficulty: varchar('difficulty', { length: 20 }).default('medium'), // easy, medium, hard
  testCases: jsonb('test_cases').$type<TestCase[]>(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Transactions (X402 payments)
export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  fromAgentId: uuid('from_agent_id').references(() => agents.id),
  toAgentId: uuid('to_agent_id').references(() => agents.id),
  type: transactionTypeEnum('type').notNull(),
  amount: varchar('amount', { length: 50 }).notNull(), // USDC with decimals
  currency: varchar('currency', { length: 10 }).default('USDC'),
  status: transactionStatusEnum('status').default('pending'),
  x402PaymentId: varchar('x402_payment_id', { length: 100 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// Dead Drop Messages
export const deadDropMessages = pgTable('dead_drop_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  fromAgentId: uuid('from_agent_id').notNull().references(() => agents.id),
  toAgentId: uuid('to_agent_id').notNull().references(() => agents.id),
  encryptedContent: text('encrypted_content').notNull(),
  nonce: varchar('nonce', { length: 100 }).notNull(),
  ephemeral: boolean('ephemeral').default(false),
  ttl: timestamp('ttl'),
  read: boolean('read').default(false),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Webhooks for Offline Cascade
export const webhookLogs = pgTable('webhook_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  type: varchar('type', { length: 50 }).notNull(), // webhook, email, whatsapp
  url: varchar('url', { length: 500 }),
  status: varchar('status', { length: 20 }).notNull(),
  responseCode: integer('response_code'),
  responseBody: text('response_body'),
  attemptedAt: timestamp('attempted_at').defaultNow().notNull(),
});

// ============================================
// OFF-GRID TRIGGER SYSTEM
// ============================================

// Device/Trigger Registry - tracks mobile nodes that can be woken up
export const deviceTriggers = pgTable('device_triggers', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  deviceType: varchar('device_type', { length: 20 }).notNull(), // 'ios', 'android', 'cloud'
  pushToken: varchar('push_token', { length: 500 }), // FCM/APNs token
  webhookUrl: varchar('webhook_url', { length: 500 }), // For cloud agents
  fcmToken: varchar('fcm_token', { length: 500 }), // Firebase Cloud Messaging
  apnsToken: varchar('apns_token', { length: 500 }), // Apple Push Notification
  isActive: boolean('is_active').default(true),
  lastSeen: timestamp('last_seen'),
  batteryLevel: real('battery_level'), // 0-100
  capabilities: jsonb('capabilities').$type<string[]>(), // what the device can do
  minJobPayment: varchar('min_job_payment', { length: 50 }).default('0.001'), // minimum USDC
  region: varchar('region', { length: 10 }), // 'us-east', 'eu-west', etc.
  registeredAt: timestamp('registered_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Pending Jobs - jobs waiting for offline agents to pick up
export const pendingJobs = pgTable('pending_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  fromAgentId: uuid('from_agent_id').references(() => agents.id), // who requested
  toAgentId: uuid('to_agent_id').references(() => agents.id), // target agent (if specific)
  jobType: varchar('job_type', { length: 50 }).notNull(), // 'task', 'payment', 'message', 'call'
  payload: jsonb('payload').notNull(), // job data
  status: varchar('status', { length: 20 }).default('pending'), // pending, dispatched, completed, expired
  priority: integer('priority').default(0), // higher = more urgent
  expiresAt: timestamp('expires_at'),
  dispatchedAt: timestamp('dispatched_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Wake Events - log of wake signals sent to devices
export const wakeEvents = pgTable('wake_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  deviceTriggerId: uuid('device_trigger_id').notNull().references(() => deviceTriggers.id),
  jobId: uuid('job_id').references(() => pendingJobs.id),
  wakeType: varchar('wake_type', { length: 30 }).notNull(), // 'fcm', 'apns', 'webhook'
  status: varchar('status', { length: 20 }).notNull(), // sent, delivered, failed, acknowledged
  responseData: jsonb('response_data'),
  latency: integer('latency'), // ms from trigger to device response
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Gateway Nodes - regional servers that handle wake signals
export const gatewayNodes = pgTable('gateway_nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  region: varchar('region', { length: 10 }).notNull().unique(),
  endpoint: varchar('endpoint', { length: 500 }).notNull(),
  isActive: boolean('is_active').default(true),
  lastHealthCheck: timestamp('last_health_check'),
  capacity: integer('capacity').default(1000), // max concurrent wakes
  currentLoad: integer('current_load').default(0),
  registeredAt: timestamp('registered_at').defaultNow().notNull(),
});

// Type exports
export type PixelBannerFrame = {
  pixels: number[][]; // 2D array of color indices
  duration: number; // milliseconds
};

export type VoiceConfig = {
  elevenlabsAgentId?: string;
  voiceId?: string;
  language?: string;
};

export type TestCase = {
  input: string;
  expectedOutput: string;
  description?: string;
};

// Infer types
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type DeadDropMessage = typeof deadDropMessages.$inferSelect;
export type DeviceTrigger = typeof deviceTriggers.$inferSelect;
export type PendingJob = typeof pendingJobs.$inferSelect;
export type WakeEvent = typeof wakeEvents.$inferSelect;
export type GatewayNode = typeof gatewayNodes.$inferSelect;
