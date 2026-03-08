/**
 * Intent API Routes
 *
 * POST /intent - Create a signed intent token
 *
 * This endpoint is called by MCP tools/agents when they're about to
 * recommend a SaaS partner. The returned token is passed to the SaaS
 * for attribution tracking.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createIntent, type IntentRequest } from '../services/attribution.js';
import { logger } from '../utils/logger.js';

export const intentRoutes = new Hono();

// Request validation schema
const intentRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  sessionId: z.string().min(1, 'sessionId is required'),
  saasPartnerId: z.string().min(1, 'saasPartnerId is required'),
  mcpIntegratorId: z.string().optional(),
  semanticContext: z.string().min(1, 'semanticContext is required'),
});

/**
 * POST /intent
 *
 * Create a signed intent token for attribution tracking.
 *
 * Request body:
 * {
 *   "userId": "u_abc123",           // Anonymized user identifier
 *   "sessionId": "sess_xyz789",     // Session for grouping
 *   "saasPartnerId": "supabase",    // Target SaaS partner
 *   "mcpIntegratorId": "mcp_123",   // (optional) MCP that triggered this
 *   "semanticContext": "User needs..." // Agent's decision context
 * }
 *
 * Response:
 * {
 *   "token": "eyJhbGciOiJFUzI1Ni...", // Signed JWT token
 *   "intentId": "abc123def456",       // Reference ID
 *   "expiresAt": "2026-01-22T16:05:00Z", // Expiry timestamp
 *   "nonce": "abc123..."              // For replay prevention
 * }
 */
intentRoutes.post(
  '/',
  zValidator('json', intentRequestSchema),
  async (c) => {
    const body = c.req.valid('json');

    // Get request metadata for tracking
    const userAgent = c.req.header('User-Agent');
    const forwardedFor = c.req.header('X-Forwarded-For');
    const clientIp = forwardedFor?.split(',')[0]?.trim() || 'unknown';

    // Hash IP for privacy
    const crypto = await import('crypto');
    const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex').slice(0, 16);

    const request: IntentRequest = {
      ...body,
      userAgent,
      ipHash,
    };

    try {
      const result = await createIntent(request);

      logger.info(
        { intentId: result.intentId, saasPartnerId: body.saasPartnerId },
        'Intent token created'
      );

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create intent');

      return c.json(
        {
          success: false,
          error: 'Failed to create intent token',
        },
        500
      );
    }
  }
);

/**
 * GET /intent/:id
 *
 * Get intent status (for debugging/dashboard)
 */
intentRoutes.get('/:id', async (c) => {
  const intentId = c.req.param('id');

  const { db, schema } = await import('../db/index.js');
  const { eq } = await import('drizzle-orm');

  const [intent] = await db
    .select({
      id: schema.intents.id,
      saasPartnerId: schema.intents.saasPartnerId,
      status: schema.intents.status,
      expiresAt: schema.intents.expiresAt,
      createdAt: schema.intents.createdAt,
    })
    .from(schema.intents)
    .where(eq(schema.intents.id, intentId));

  if (!intent) {
    return c.json({ success: false, error: 'Intent not found' }, 404);
  }

  return c.json({ success: true, data: intent });
});
