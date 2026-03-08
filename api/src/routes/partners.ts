/**
 * Partner Management Routes
 *
 * Manage SaaS partners (demand side) and MCP integrators (supply side)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { nanoid } from 'nanoid';
import { randomBytes } from 'crypto';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

export const partnerRoutes = new Hono();

// ============================================
// SaaS Partners (Demand Side)
// ============================================

const createPartnerSchema = z.object({
  name: z.string().min(1),
  defaultCommissionRate: z.number().min(0).max(1).default(0.20),
  minCommission: z.number().min(0).default(10),
  maxCommission: z.number().min(0).default(500),
});

/**
 * POST /partners/saas
 * Register a new SaaS partner
 */
partnerRoutes.post(
  '/saas',
  zValidator('json', createPartnerSchema),
  async (c) => {
    const body = c.req.valid('json');
    const id = `saas_${nanoid(12)}`;
    const apiKey = `sk_${randomBytes(24).toString('base64url')}`;
    const webhookSecret = `whsec_${randomBytes(24).toString('base64url')}`;

    await db.insert(schema.saasPartners).values({
      id,
      name: body.name,
      apiKey,
      webhookSecret,
      defaultCommissionRate: body.defaultCommissionRate,
      minCommission: body.minCommission,
      maxCommission: body.maxCommission,
      status: 'active',
    });

    logger.info({ partnerId: id, name: body.name }, 'SaaS partner registered');

    return c.json({
      success: true,
      data: {
        id,
        name: body.name,
        apiKey,
        webhookSecret, // Only shown once at creation
        defaultCommissionRate: body.defaultCommissionRate,
      },
    }, 201);
  }
);

/**
 * GET /partners/saas
 * List all SaaS partners
 */
partnerRoutes.get('/saas', async (c) => {
  const partners = await db
    .select({
      id: schema.saasPartners.id,
      name: schema.saasPartners.name,
      status: schema.saasPartners.status,
      defaultCommissionRate: schema.saasPartners.defaultCommissionRate,
      createdAt: schema.saasPartners.createdAt,
    })
    .from(schema.saasPartners);

  return c.json({ success: true, data: partners });
});

/**
 * GET /partners/saas/:id
 * Get SaaS partner details
 */
partnerRoutes.get('/saas/:id', async (c) => {
  const id = c.req.param('id');

  const [partner] = await db
    .select({
      id: schema.saasPartners.id,
      name: schema.saasPartners.name,
      status: schema.saasPartners.status,
      defaultCommissionRate: schema.saasPartners.defaultCommissionRate,
      minCommission: schema.saasPartners.minCommission,
      maxCommission: schema.saasPartners.maxCommission,
      createdAt: schema.saasPartners.createdAt,
    })
    .from(schema.saasPartners)
    .where(eq(schema.saasPartners.id, id));

  if (!partner) {
    return c.json({ success: false, error: 'Partner not found' }, 404);
  }

  return c.json({ success: true, data: partner });
});

// ============================================
// MCP Integrators (Supply Side)
// ============================================

const createIntegratorSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  revenueShareRate: z.number().min(0).max(1).default(0.70),
  payoutMethod: z.enum(['usdc', 'ach', 'paypal']).default('usdc'),
  payoutAddress: z.string().optional(),
});

/**
 * POST /partners/mcp
 * Register a new MCP integrator
 */
partnerRoutes.post(
  '/mcp',
  zValidator('json', createIntegratorSchema),
  async (c) => {
    const body = c.req.valid('json');
    const id = `mcp_${nanoid(12)}`;
    const apiKey = `mcp_${randomBytes(24).toString('base64url')}`;

    await db.insert(schema.mcpIntegrators).values({
      id,
      name: body.name,
      email: body.email,
      apiKey,
      revenueShareRate: body.revenueShareRate,
      payoutMethod: body.payoutMethod,
      payoutAddress: body.payoutAddress,
      status: 'pending', // Requires approval
    });

    logger.info({ integratorId: id, name: body.name }, 'MCP integrator registered');

    return c.json({
      success: true,
      data: {
        id,
        name: body.name,
        email: body.email,
        apiKey, // Only shown once at creation
        status: 'pending',
        revenueShareRate: body.revenueShareRate,
      },
    }, 201);
  }
);

/**
 * GET /partners/mcp
 * List all MCP integrators
 */
partnerRoutes.get('/mcp', async (c) => {
  const integrators = await db
    .select({
      id: schema.mcpIntegrators.id,
      name: schema.mcpIntegrators.name,
      email: schema.mcpIntegrators.email,
      status: schema.mcpIntegrators.status,
      decisionsCount: schema.mcpIntegrators.decisionsCount,
      totalEarnings: schema.mcpIntegrators.totalEarnings,
      createdAt: schema.mcpIntegrators.createdAt,
    })
    .from(schema.mcpIntegrators);

  return c.json({ success: true, data: integrators });
});

/**
 * GET /partners/mcp/:id
 * Get MCP integrator details and stats
 */
partnerRoutes.get('/mcp/:id', async (c) => {
  const id = c.req.param('id');

  const { getIntegratorStats } = await import('../services/attribution.js');
  const stats = await getIntegratorStats(id);

  if (!stats) {
    return c.json({ success: false, error: 'Integrator not found' }, 404);
  }

  return c.json({ success: true, data: stats });
});

/**
 * PATCH /partners/mcp/:id/activate
 * Activate a pending MCP integrator
 */
partnerRoutes.patch('/mcp/:id/activate', async (c) => {
  const id = c.req.param('id');

  await db
    .update(schema.mcpIntegrators)
    .set({ status: 'active', updatedAt: new Date().toISOString() })
    .where(eq(schema.mcpIntegrators.id, id));

  logger.info({ integratorId: id }, 'MCP integrator activated');

  return c.json({ success: true, message: 'Integrator activated' });
});
