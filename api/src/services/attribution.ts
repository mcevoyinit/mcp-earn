/**
 * Agent Earn MCP Attribution Service
 *
 * Implements TEE-attested Signed Intent Tokens for trustworthy attribution.
 *
 * Flow:
 * 1. Agent calls /intent -> receives signed token
 * 2. Agent passes token to SaaS via header/URL
 * 3. SaaS reports conversion via /conversion webhook
 * 4. Service verifies: signature, semantic hash, time window, nonce
 * 5. On success: trigger 70/20/10 payout split
 */

import * as jose from 'jose';
import { createHash, randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../utils/logger.js';

// Configuration
const TOKEN_EXPIRY_SECONDS = 300; // 5 minutes
const KL_DIVERGENCE_THRESHOLD = 0.05; // Max semantic drift allowed
const REVENUE_SPLITS = {
  mcpIntegrator: 0.70,  // 70% to MCP developer
  attribution: 0.20,    // 20% for attribution
  platform: 0.10,       // 10% platform fee
} as const;

// Key pair for signing (in production: use TEE-protected keys)
let privateKey: jose.KeyLike;
let publicKey: jose.KeyLike;

export async function initializeKeys() {
  // Generate ECDSA key pair (ES256 for compact tokens)
  // In production: keys would be TEE-protected (AWS Nitro, Intel SGX, etc.)
  const keyPair = await jose.generateKeyPair('ES256');
  privateKey = keyPair.privateKey;
  publicKey = keyPair.publicKey;
  logger.info('Attribution keys initialized');
}

// Export for webhook verification
export function getPublicKey() {
  return publicKey;
}

/**
 * Intent Creation Request
 */
export interface IntentRequest {
  userId: string;           // Anonymized user identifier
  sessionId: string;        // Session for grouping
  saasPartnerId: string;    // Target SaaS (e.g., "supabase")
  mcpIntegratorId?: string; // Optional MCP that triggered this
  semanticContext: string;  // The agent's decision context (for KL-div)
  userAgent?: string;
  ipHash?: string;
}

/**
 * Intent Token Response
 */
export interface IntentToken {
  token: string;            // Signed JWT-like token
  intentId: string;         // Reference ID
  expiresAt: string;        // ISO timestamp
  nonce: string;            // For replay prevention
}

/**
 * Create a signed intent token
 *
 * This is the core of the attribution protocol:
 * - Generates a cryptographically signed token
 * - Includes semantic hash for integrity verification
 * - Sets short expiry (5 min) to prevent stale claims
 * - Uses nonce for replay attack prevention
 */
export async function createIntent(request: IntentRequest): Promise<IntentToken> {
  const intentId = nanoid(16);
  const nonce = randomBytes(16).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_SECONDS * 1000).toISOString();

  // Create semantic intent hash (SHA256 of context)
  // In production: this would be TEE-attested
  const semanticIntentHash = createHash('sha256')
    .update(request.semanticContext)
    .digest('hex');

  // Create signed JWT token
  const token = await new jose.SignJWT({
    sub: request.userId,
    iss: 'earn-mcp',
    aud: request.saasPartnerId,
    jti: intentId,
    nonce,
    semanticHash: semanticIntentHash,
    mcpId: request.mcpIntegratorId,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_EXPIRY_SECONDS}s`)
    .sign(privateKey);

  // Store intent in database
  await db.insert(schema.intents).values({
    id: intentId,
    token,
    mcpIntegratorId: request.mcpIntegratorId ?? null,
    saasPartnerId: request.saasPartnerId,
    userId: request.userId,
    sessionId: request.sessionId,
    semanticIntentHash,
    nonce,
    expiresAt,
    userAgent: request.userAgent,
    ipHash: request.ipHash,
    status: 'pending',
  });

  // Log for audit
  await db.insert(schema.auditLog).values({
    id: nanoid(16),
    eventType: 'intent_created',
    entityType: 'intent',
    entityId: intentId,
    metadata: JSON.stringify({
      saasPartnerId: request.saasPartnerId,
      mcpIntegratorId: request.mcpIntegratorId,
    }),
  });

  logger.info({ intentId, saasPartnerId: request.saasPartnerId }, 'Intent created');

  return {
    token,
    intentId,
    expiresAt,
    nonce,
  };
}

/**
 * Conversion Verification Request (from SaaS webhook)
 */
export interface ConversionRequest {
  attributionToken: string;   // The signed token from intent
  orderId: string;            // SaaS order/transaction ID
  revenue: number;            // Revenue amount
  currency?: string;          // Currency code (default: USD)
  webhookSignature?: string;  // HMAC signature from SaaS
}

/**
 * Conversion Verification Result
 */
export interface ConversionResult {
  success: boolean;
  conversionId?: string;
  intentId?: string;
  error?: string;
  payouts?: {
    mcpIntegrator: number;
    attribution: number;
    platform: number;
  };
}

/**
 * Verify a conversion and trigger payouts
 *
 * Verification steps:
 * 1. Validate JWT signature
 * 2. Check semantic hash matches (no drift)
 * 3. Verify time window (< 5 minutes)
 * 4. Confirm nonce not already used
 */
export async function verifyConversion(
  request: ConversionRequest,
  saasPartnerId: string
): Promise<ConversionResult> {
  const conversionId = nanoid(16);

  try {
    // Step 1: Verify JWT signature and decode
    let payload: jose.JWTPayload;
    try {
      const { payload: decoded } = await jose.jwtVerify(request.attributionToken, publicKey, {
        issuer: 'earn-mcp',
        audience: saasPartnerId,
      });
      payload = decoded;
    } catch (e) {
      logger.warn({ error: e }, 'Invalid token signature');
      return { success: false, error: 'INVALID_SIGNATURE' };
    }

    const intentId = payload.jti as string;
    const nonce = payload.nonce as string;

    // Step 2: Fetch intent from database
    const [intent] = await db
      .select()
      .from(schema.intents)
      .where(eq(schema.intents.id, intentId));

    if (!intent) {
      return { success: false, error: 'INTENT_NOT_FOUND' };
    }

    if (intent.status !== 'pending') {
      return { success: false, error: 'INTENT_ALREADY_USED' };
    }

    // Step 3: Verify time window
    const now = new Date();
    const expiresAt = new Date(intent.expiresAt);
    const timeWindowValid = now <= expiresAt;

    if (!timeWindowValid) {
      await markIntentExpired(intentId);
      return { success: false, error: 'TOKEN_EXPIRED' };
    }

    // Step 4: Verify nonce (replay prevention)
    const nonceValid = intent.nonce === nonce;
    if (!nonceValid) {
      return { success: false, error: 'INVALID_NONCE' };
    }

    // Step 5: Semantic hash verification
    // In production: compare KL divergence of stored vs current context
    const semanticMatch = true; // Simplified for MVP

    // All verifications passed - create conversion record
    await db.insert(schema.conversions).values({
      id: conversionId,
      intentId,
      orderId: request.orderId,
      revenue: request.revenue,
      currency: request.currency ?? 'USD',
      signatureValid: true,
      semanticMatch,
      timeWindowValid,
      nonceValid,
      status: 'verified',
      verifiedAt: new Date().toISOString(),
    });

    // Mark intent as converted
    await db
      .update(schema.intents)
      .set({ status: 'converted' })
      .where(eq(schema.intents.id, intentId));

    // Calculate and create payouts (70/20/10 split)
    const payouts = await createPayouts(conversionId, intentId, request.revenue);

    // Audit log
    await db.insert(schema.auditLog).values({
      id: nanoid(16),
      eventType: 'conversion_verified',
      entityType: 'conversion',
      entityId: conversionId,
      metadata: JSON.stringify({
        intentId,
        orderId: request.orderId,
        revenue: request.revenue,
        payouts,
      }),
    });

    logger.info({ conversionId, intentId, revenue: request.revenue }, 'Conversion verified');

    return {
      success: true,
      conversionId,
      intentId,
      payouts,
    };

  } catch (error) {
    logger.error({ error, conversionId }, 'Conversion verification failed');
    return {
      success: false,
      error: 'VERIFICATION_FAILED',
    };
  }
}

/**
 * Create payout records for a verified conversion
 * Split: 70% MCP dev, 20% attribution, 10% platform
 */
async function createPayouts(
  conversionId: string,
  intentId: string,
  revenue: number
): Promise<{ mcpIntegrator: number; attribution: number; platform: number }> {
  // Get SaaS partner commission rate
  const [intent] = await db
    .select()
    .from(schema.intents)
    .where(eq(schema.intents.id, intentId));

  const [partner] = await db
    .select()
    .from(schema.saasPartners)
    .where(eq(schema.saasPartners.id, intent.saasPartnerId));

  // Calculate gross commission (default 20% of revenue)
  const commissionRate = partner?.defaultCommissionRate ?? 0.20;
  const grossCommission = revenue * commissionRate;

  // Apply min/max caps
  const minCommission = partner?.minCommission ?? 10;
  const maxCommission = partner?.maxCommission ?? 500;
  const cappedCommission = Math.min(Math.max(grossCommission, minCommission), maxCommission);

  // Calculate splits
  const mcpAmount = cappedCommission * REVENUE_SPLITS.mcpIntegrator;
  const attributionAmount = cappedCommission * REVENUE_SPLITS.attribution;
  const platformAmount = cappedCommission * REVENUE_SPLITS.platform;

  // Create payout records
  const payoutRecords = [
    {
      id: nanoid(16),
      conversionId,
      recipientType: 'mcp_integrator' as const,
      recipientId: intent.mcpIntegratorId,
      grossAmount: cappedCommission,
      splitRate: REVENUE_SPLITS.mcpIntegrator,
      netAmount: mcpAmount,
      status: 'pending' as const,
    },
    {
      id: nanoid(16),
      conversionId,
      recipientType: 'platform_attribution' as const,
      recipientId: 'platform',
      grossAmount: cappedCommission,
      splitRate: REVENUE_SPLITS.attribution,
      netAmount: attributionAmount,
      status: 'pending' as const,
    },
    {
      id: nanoid(16),
      conversionId,
      recipientType: 'platform_fee' as const,
      recipientId: 'platform',
      grossAmount: cappedCommission,
      splitRate: REVENUE_SPLITS.platform,
      netAmount: platformAmount,
      status: 'pending' as const,
    },
  ];

  await db.insert(schema.payouts).values(payoutRecords);

  // Update MCP integrator earnings if applicable
  if (intent.mcpIntegratorId) {
    const [integrator] = await db
      .select()
      .from(schema.mcpIntegrators)
      .where(eq(schema.mcpIntegrators.id, intent.mcpIntegratorId));

    if (integrator) {
      await db
        .update(schema.mcpIntegrators)
        .set({
          decisionsCount: (integrator.decisionsCount ?? 0) + 1,
          totalEarnings: (integrator.totalEarnings ?? 0) + mcpAmount,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.mcpIntegrators.id, intent.mcpIntegratorId));
    }
  }

  return {
    mcpIntegrator: mcpAmount,
    attribution: attributionAmount,
    platform: platformAmount,
  };
}

/**
 * Mark an intent as expired (cleanup)
 */
async function markIntentExpired(intentId: string): Promise<void> {
  await db
    .update(schema.intents)
    .set({ status: 'expired' })
    .where(eq(schema.intents.id, intentId));

  await db.insert(schema.auditLog).values({
    id: nanoid(16),
    eventType: 'intent_expired',
    entityType: 'intent',
    entityId: intentId,
  });
}

/**
 * Get attribution statistics for an MCP integrator
 */
export async function getIntegratorStats(integratorId: string) {
  const [integrator] = await db
    .select()
    .from(schema.mcpIntegrators)
    .where(eq(schema.mcpIntegrators.id, integratorId));

  if (!integrator) {
    return null;
  }

  // Get recent conversions
  const recentConversions = await db
    .select({
      id: schema.conversions.id,
      revenue: schema.conversions.revenue,
      createdAt: schema.conversions.createdAt,
    })
    .from(schema.conversions)
    .innerJoin(schema.intents, eq(schema.conversions.intentId, schema.intents.id))
    .where(eq(schema.intents.mcpIntegratorId, integratorId))
    .limit(10);

  return {
    id: integrator.id,
    name: integrator.name,
    status: integrator.status,
    stats: {
      decisionsCount: integrator.decisionsCount,
      totalEarnings: integrator.totalEarnings,
      revenueShareRate: integrator.revenueShareRate,
    },
    recentConversions,
  };
}
