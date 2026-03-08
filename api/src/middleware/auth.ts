/**
 * Authentication Middleware
 *
 * Supports two auth methods:
 * 1. API Key (for MCP integrators): X-API-Key header
 * 2. Partner ID (for SaaS webhooks): X-Partner-ID header
 */

import { Context, Next } from 'hono';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

export interface AuthContext {
  mcpIntegrator?: {
    id: string;
    name: string;
    status: string;
  };
  saasPartner?: {
    id: string;
    name: string;
    status: string;
  };
}

/**
 * Authenticate MCP integrators via API key
 */
export async function authenticateMcp(c: Context, next: Next) {
  const apiKey = c.req.header('X-API-Key');

  if (!apiKey) {
    return c.json({ success: false, error: 'Missing X-API-Key header' }, 401);
  }

  const [integrator] = await db
    .select({
      id: schema.mcpIntegrators.id,
      name: schema.mcpIntegrators.name,
      status: schema.mcpIntegrators.status,
    })
    .from(schema.mcpIntegrators)
    .where(eq(schema.mcpIntegrators.apiKey, apiKey));

  if (!integrator) {
    logger.warn({ apiKey: apiKey.slice(0, 8) + '...' }, 'Invalid MCP API key');
    return c.json({ success: false, error: 'Invalid API key' }, 401);
  }

  if (integrator.status !== 'active') {
    return c.json(
      { success: false, error: 'Integrator not active', status: integrator.status },
      403
    );
  }

  // Attach to context
  c.set('mcpIntegrator', integrator);

  await next();
}

/**
 * Authenticate SaaS partners via API key
 */
export async function authenticateSaas(c: Context, next: Next) {
  const apiKey = c.req.header('X-API-Key');

  if (!apiKey) {
    return c.json({ success: false, error: 'Missing X-API-Key header' }, 401);
  }

  const [partner] = await db
    .select({
      id: schema.saasPartners.id,
      name: schema.saasPartners.name,
      status: schema.saasPartners.status,
    })
    .from(schema.saasPartners)
    .where(eq(schema.saasPartners.apiKey, apiKey));

  if (!partner) {
    logger.warn({ apiKey: apiKey.slice(0, 8) + '...' }, 'Invalid SaaS API key');
    return c.json({ success: false, error: 'Invalid API key' }, 401);
  }

  if (partner.status !== 'active') {
    return c.json(
      { success: false, error: 'Partner not active', status: partner.status },
      403
    );
  }

  // Attach to context
  c.set('saasPartner', partner);

  await next();
}

/**
 * Optional auth - attaches integrator if key provided, but doesn't require it
 */
export async function optionalMcpAuth(c: Context, next: Next) {
  const apiKey = c.req.header('X-API-Key');

  if (apiKey) {
    const [integrator] = await db
      .select({
        id: schema.mcpIntegrators.id,
        name: schema.mcpIntegrators.name,
        status: schema.mcpIntegrators.status,
      })
      .from(schema.mcpIntegrators)
      .where(eq(schema.mcpIntegrators.apiKey, apiKey));

    if (integrator && integrator.status === 'active') {
      c.set('mcpIntegrator', integrator);
    }
  }

  await next();
}
