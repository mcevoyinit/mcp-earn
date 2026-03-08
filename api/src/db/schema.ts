/**
 * MCP Earn Database Schema
 *
 * Core tables for the attribution protocol:
 * - saas_partners: Demand side (Vercel, Supabase, etc.)
 * - mcp_integrators: Supply side (MCP developers)
 * - intents: Tracked intent tokens
 * - conversions: Verified conversions linked to intents
 * - payouts: Revenue splits (70/20/10)
 */

import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Actor 1: Demand Side - SaaS Affiliate Advertisers
export const saasPartners = sqliteTable('saas_partners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  apiKey: text('api_key').notNull().unique(),
  webhookSecret: text('webhook_secret').notNull(),
  // Commission config
  defaultCommissionRate: real('default_commission_rate').default(0.20), // 20% of LTV
  minCommission: real('min_commission').default(10.0), // $10 minimum
  maxCommission: real('max_commission').default(500.0), // $500 cap
  // Tracking
  status: text('status', { enum: ['active', 'paused', 'suspended'] }).default('active'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// Actor 3: Supply Side - MCP Developers (Publishers)
export const mcpIntegrators = sqliteTable('mcp_integrators', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  apiKey: text('api_key').notNull().unique(),
  // Revenue config (default 70% to MCP dev)
  revenueShareRate: real('revenue_share_rate').default(0.70),
  // Payout config
  payoutMethod: text('payout_method', { enum: ['usdc', 'ach', 'paypal'] }).default('usdc'),
  payoutAddress: text('payout_address'), // Wallet address or bank info hash
  // Tracking
  status: text('status', { enum: ['pending', 'active', 'suspended'] }).default('pending'),
  decisionsCount: integer('decisions_count').default(0),
  totalEarnings: real('total_earnings').default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// Intent Tokens - Core of Attribution Protocol
export const intents = sqliteTable('intents', {
  id: text('id').primaryKey(), // nanoid
  token: text('token').notNull().unique(), // Signed JWT-like token
  // Actor references
  mcpIntegratorId: text('mcp_integrator_id').references(() => mcpIntegrators.id),
  saasPartnerId: text('saas_partner_id').references(() => saasPartners.id).notNull(),
  // User tracking (anonymized)
  userId: text('user_id').notNull(), // Hash of user identifier
  sessionId: text('session_id').notNull(),
  // Semantic integrity
  semanticIntentHash: text('semantic_intent_hash').notNull(), // SHA256 of TEE-attested context
  klDivergence: real('kl_divergence'), // Semantic drift metric (must be < 0.05)
  // Token lifecycle
  nonce: text('nonce').notNull().unique(), // Replay prevention
  expiresAt: text('expires_at').notNull(),
  status: text('status', { enum: ['pending', 'converted', 'expired', 'rejected'] }).default('pending'),
  // Metadata
  userAgent: text('user_agent'),
  ipHash: text('ip_hash'), // Hashed for privacy
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// Conversions - Verified outcomes
export const conversions = sqliteTable('conversions', {
  id: text('id').primaryKey(),
  intentId: text('intent_id').references(() => intents.id).notNull(),
  // SaaS-reported data
  orderId: text('order_id').notNull(),
  revenue: real('revenue').notNull(),
  currency: text('currency').default('USD'),
  // Verification
  signatureValid: integer('signature_valid', { mode: 'boolean' }).notNull(),
  semanticMatch: integer('semantic_match', { mode: 'boolean' }).notNull(),
  timeWindowValid: integer('time_window_valid', { mode: 'boolean' }).notNull(),
  nonceValid: integer('nonce_valid', { mode: 'boolean' }).notNull(),
  // Status
  status: text('status', { enum: ['pending', 'verified', 'rejected', 'disputed'] }).default('pending'),
  rejectionReason: text('rejection_reason'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  verifiedAt: text('verified_at'),
});

// Payouts - 70/20/10 split tracking
export const payouts = sqliteTable('payouts', {
  id: text('id').primaryKey(),
  conversionId: text('conversion_id').references(() => conversions.id).notNull(),
  // Recipient
  recipientType: text('recipient_type', { enum: ['mcp_integrator', 'mcp-earn_attribution', 'mcp-earn_platform'] }).notNull(),
  recipientId: text('recipient_id'), // MCP integrator ID or 'mcp-earn'
  // Amounts
  grossAmount: real('gross_amount').notNull(), // Total commission
  splitRate: real('split_rate').notNull(), // 0.70, 0.20, or 0.10
  netAmount: real('net_amount').notNull(), // grossAmount * splitRate
  // Status
  status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] }).default('pending'),
  payoutMethod: text('payout_method'),
  transactionHash: text('transaction_hash'), // For crypto payouts
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});

// Audit log for TEE attestations
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  eventType: text('event_type', {
    enum: ['intent_created', 'intent_expired', 'conversion_verified', 'conversion_rejected', 'payout_initiated', 'payout_completed']
  }).notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  // TEE attestation data
  teeAttestation: text('tee_attestation'), // Base64 encoded attestation document
  // Metadata
  metadata: text('metadata'), // JSON string of additional data
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// Types for TypeScript
export type SaasPartner = typeof saasPartners.$inferSelect;
export type NewSaasPartner = typeof saasPartners.$inferInsert;
export type McpIntegrator = typeof mcpIntegrators.$inferSelect;
export type NewMcpIntegrator = typeof mcpIntegrators.$inferInsert;
export type Intent = typeof intents.$inferSelect;
export type NewIntent = typeof intents.$inferInsert;
export type Conversion = typeof conversions.$inferSelect;
export type NewConversion = typeof conversions.$inferInsert;
export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;
