/**
 * Conversion Webhook Routes
 *
 * POST /conversion - SaaS partners report conversions here
 *
 * This endpoint receives webhook calls from SaaS partners when a user
 * converts (signup, paid subscription, etc.). The MCP Earn token is verified
 * and payouts are triggered on success.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createHmac, timingSafeEqual } from 'crypto';
import { verifyConversion, type ConversionRequest } from '../services/attribution.js';
import { logger } from '../utils/logger.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

export const conversionRoutes = new Hono();

// Request validation schema
const conversionRequestSchema = z.object({
  attributionToken: z.string().min(1, 'attributionToken is required'),
  orderId: z.string().min(1, 'orderId is required'),
  revenue: z.number().positive('revenue must be positive'),
  currency: z.string().default('USD'),
  userId: z.string().optional(), // For additional verification
});

/**
 * Verify webhook signature from SaaS partner
 */
async function verifyWebhookSignature(
  partnerId: string,
  payload: string,
  signature: string | undefined
): Promise<boolean> {
  if (!signature) {
    return false;
  }

  // Get partner's webhook secret
  const [partner] = await db
    .select({ webhookSecret: schema.saasPartners.webhookSecret })
    .from(schema.saasPartners)
    .where(eq(schema.saasPartners.id, partnerId));

  if (!partner) {
    return false;
  }

  // Compute expected signature
  const expectedSignature = createHmac('sha256', partner.webhookSecret)
    .update(payload)
    .digest('hex');

  // Timing-safe comparison
  try {
    const sig = Buffer.from(signature, 'hex');
    const expected = Buffer.from(expectedSignature, 'hex');
    return sig.length === expected.length && timingSafeEqual(sig, expected);
  } catch {
    return false;
  }
}

/**
 * POST /conversion
 *
 * Webhook endpoint for SaaS partners to report conversions.
 *
 * Headers:
 * - X-Partner-ID: Partner identifier
 * - X-MCP Earn-Signature: HMAC-SHA256 signature of request body
 *
 * Request body:
 * {
 *   "attributionToken": "eyJhbGciOiJFUzI1Ni...", // Token from /intent
 *   "orderId": "ord_xyz789",              // SaaS order/transaction ID
 *   "revenue": 100.00,                    // Revenue amount
 *   "currency": "USD"                     // Currency code
 * }
 *
 * Response (success):
 * {
 *   "success": true,
 *   "conversionId": "conv_abc123",
 *   "intentId": "int_def456",
 *   "payouts": {
 *     "mcpIntegrator": 14.00,   // 70% of 20% commission
 *     "mcp-earnAttribution": 4.00,  // 20% of 20% commission
 *     "mcp-earnPlatform": 2.00      // 10% of 20% commission
 *   }
 * }
 *
 * Response (failure):
 * {
 *   "success": false,
 *   "error": "INVALID_SIGNATURE" | "TOKEN_EXPIRED" | etc.
 * }
 */
conversionRoutes.post(
  '/',
  zValidator('json', conversionRequestSchema),
  async (c) => {
    const body = c.req.valid('json');
    const partnerId = c.req.header('X-Partner-ID');
    const signature = c.req.header('X-MCP Earn-Signature');

    if (!partnerId) {
      return c.json(
        { success: false, error: 'Missing X-Partner-ID header' },
        400
      );
    }

    // Verify webhook signature (skip in development for easier testing)
    if (process.env.NODE_ENV === 'production') {
      const rawBody = await c.req.text();
      const isValid = await verifyWebhookSignature(partnerId, rawBody, signature);

      if (!isValid) {
        logger.warn({ partnerId }, 'Invalid webhook signature');
        return c.json({ success: false, error: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
      }
    }

    const request: ConversionRequest = {
      attributionToken: body.attributionToken,
      orderId: body.orderId,
      revenue: body.revenue,
      currency: body.currency,
      webhookSignature: signature,
    };

    try {
      const result = await verifyConversion(request, partnerId);

      if (result.success) {
        logger.info(
          {
            conversionId: result.conversionId,
            intentId: result.intentId,
            revenue: body.revenue,
            partnerId,
          },
          'Conversion verified and payouts created'
        );

        return c.json({
          success: true,
          conversionId: result.conversionId,
          intentId: result.intentId,
          payouts: result.payouts,
        });
      } else {
        logger.warn(
          { error: result.error, partnerId, orderId: body.orderId },
          'Conversion verification failed'
        );

        // Map error to appropriate HTTP status
        const statusMap: Record<string, number> = {
          INVALID_SIGNATURE: 401,
          INTENT_NOT_FOUND: 404,
          INTENT_ALREADY_USED: 409,
          TOKEN_EXPIRED: 410,
          INVALID_NONCE: 400,
        };

        return c.json(
          { success: false, error: result.error },
          (statusMap[result.error ?? 'VERIFICATION_FAILED'] || 400) as 400 | 401 | 404 | 409 | 500
        );
      }
    } catch (error) {
      logger.error({ error, partnerId, orderId: body.orderId }, 'Conversion processing error');

      return c.json(
        { success: false, error: 'INTERNAL_ERROR' },
        500
      );
    }
  }
);

/**
 * GET /conversion/:id
 *
 * Get conversion status (for dashboard/debugging)
 */
conversionRoutes.get('/:id', async (c) => {
  const conversionId = c.req.param('id');

  const [conversion] = await db
    .select({
      id: schema.conversions.id,
      intentId: schema.conversions.intentId,
      orderId: schema.conversions.orderId,
      revenue: schema.conversions.revenue,
      status: schema.conversions.status,
      createdAt: schema.conversions.createdAt,
      verifiedAt: schema.conversions.verifiedAt,
    })
    .from(schema.conversions)
    .where(eq(schema.conversions.id, conversionId));

  if (!conversion) {
    return c.json({ success: false, error: 'Conversion not found' }, 404);
  }

  // Get associated payouts
  const payouts = await db
    .select({
      recipientType: schema.payouts.recipientType,
      netAmount: schema.payouts.netAmount,
      status: schema.payouts.status,
    })
    .from(schema.payouts)
    .where(eq(schema.payouts.conversionId, conversionId));

  return c.json({
    success: true,
    data: {
      ...conversion,
      payouts,
    },
  });
});
