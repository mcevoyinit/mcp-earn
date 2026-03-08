/**
 * Agent Earn MCP Attribution Protocol API
 *
 * Core endpoints:
 * - POST /intent - Create signed intent tokens
 * - POST /conversion - Webhook for SaaS conversion reports
 * - /partners/* - Partner management
 *
 * Architecture:
 * - TEE-attested signed tokens for trustworthy attribution
 * - 70/20/10 revenue split (MCP dev / attribution / platform)
 * - 5-minute token expiry with nonce replay prevention
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { timing } from 'hono/timing';

import { initializeDatabase } from './db/index.js';
import { initializeKeys } from './services/attribution.js';
import { intentRoutes } from './routes/intent.js';
import { conversionRoutes } from './routes/conversion.js';
import { partnerRoutes } from './routes/partners.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { optionalMcpAuth } from './middleware/auth.js';
import { logger } from './utils/logger.js';

const app = new Hono();

// Global middleware
app.use('*', cors({
  origin: process.env.CORS_ORIGIN || '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowHeaders: ['Content-Type', 'X-API-Key', 'X-Partner-ID', 'X-Signature'],
}));
app.use('*', honoLogger());
app.use('*', timing());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'earn-mcp-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// API info
app.get('/', (c) => {
  return c.json({
    name: 'Agent Earn MCP Attribution Protocol',
    version: '0.1.0',
    description: 'TEE-attested signed intent tokens for AI agent monetization',
    docs: 'https://docs.agent-earn.com/earn-mcp',
    endpoints: {
      '/intent': 'POST - Create signed intent tokens',
      '/conversion': 'POST - Report conversions (webhook)',
      '/partners/saas': 'Manage SaaS partners',
      '/partners/mcp': 'Manage MCP integrators',
    },
  });
});

// Mount routes
app.route('/intent', intentRoutes);
app.route('/conversion', conversionRoutes);
app.route('/partners', partnerRoutes);
app.route('/dashboard', dashboardRoutes);

// Error handler
app.onError((err, c) => {
  logger.error({ error: err, path: c.req.path }, 'Unhandled error');
  return c.json(
    {
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json({ success: false, error: 'Not found' }, 404);
});

// Startup
async function start() {
  try {
    // Initialize database
    logger.info('Initializing database...');
    initializeDatabase();

    // Initialize signing keys
    logger.info('Initializing attribution keys...');
    await initializeKeys();

    // Start server
    const port = parseInt(process.env.PORT || '3000', 10);

    serve({
      fetch: app.fetch,
      port,
    });

    logger.info({ port }, 'Agent Earn MCP API started');
    logger.info(`   Dashboard: http://localhost:${port}/dashboard`);
    logger.info(`   Health: http://localhost:${port}/health`);
    logger.info(`   Intent:  POST http://localhost:${port}/intent`);
    logger.info(`   Convert: POST http://localhost:${port}/conversion`);

  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();

export { app };
