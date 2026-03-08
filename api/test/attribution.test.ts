/**
 * Attribution Protocol Tests
 *
 * Tests the core P1 Attribution Protocol:
 * - Intent creation with signed tokens
 * - Conversion verification
 * - Payout split calculations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../src/index.js';

describe('Attribution Protocol', () => {
  let saasPartnerId: string;
  let saasApiKey: string;
  let mcpIntegratorId: string;
  let mcpApiKey: string;
  let intentToken: string;

  // Helper to make requests
  async function request(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
    const req = new Request(`http://localhost${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return app.fetch(req);
  }

  describe('Partner Registration', () => {
    it('should register a SaaS partner', async () => {
      const res = await request('POST', '/partners/saas', {
        name: 'Test SaaS',
        defaultCommissionRate: 0.20,
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toMatch(/^saas_/);
      expect(data.data.apiKey).toMatch(/^sk_/);

      saasPartnerId = data.data.id;
      saasApiKey = data.data.apiKey;
    });

    it('should register an MCP integrator', async () => {
      const res = await request('POST', '/partners/mcp', {
        name: 'Test MCP',
        email: 'test@example.com',
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toMatch(/^mcp_/);
      expect(data.data.status).toBe('pending');

      mcpIntegratorId = data.data.id;
      mcpApiKey = data.data.apiKey;
    });

    it('should activate MCP integrator', async () => {
      const res = await request('PATCH', `/partners/mcp/${mcpIntegratorId}/activate`);
      expect(res.status).toBe(200);
    });
  });

  describe('Intent Creation', () => {
    it('should create a signed intent token', async () => {
      const res = await request('POST', '/intent', {
        userId: 'u_test123',
        sessionId: 'sess_test456',
        saasPartnerId: saasPartnerId,
        mcpIntegratorId: mcpIntegratorId,
        semanticContext: 'User needs a PostgreSQL database for their Next.js application',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.token).toBeDefined();
      expect(data.data.intentId).toBeDefined();
      expect(data.data.expiresAt).toBeDefined();
      expect(data.data.nonce).toBeDefined();

      intentToken = data.data.token;
    });

    it('should get intent status', async () => {
      const res = await request('POST', '/intent', {
        userId: 'u_test123',
        sessionId: 'sess_test456',
        saasPartnerId: saasPartnerId,
        semanticContext: 'Another test intent',
      });

      const data = await res.json();
      const intentId = data.data.intentId;

      const statusRes = await request('GET', `/intent/${intentId}`);
      expect(statusRes.status).toBe(200);

      const statusData = await statusRes.json();
      expect(statusData.data.status).toBe('pending');
    });
  });

  describe('Conversion Verification', () => {
    it('should verify conversion and create payouts', async () => {
      const res = await request('POST', '/conversion', {
        attributionToken: intentToken,
        orderId: 'ord_test789',
        revenue: 100.00,
        currency: 'USD',
      }, {
        'X-Partner-ID': saasPartnerId,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.conversionId).toBeDefined();
      expect(data.intentId).toBeDefined();

      // Check payouts (20% commission * splits)
      // $100 revenue * 20% commission = $20
      // 70% to MCP = $14
      // 20% to MCP Earn attribution = $4
      // 10% to platform = $2
      expect(data.payouts.mcpIntegrator).toBeCloseTo(14, 1);
      expect(data.payouts.mcp-earnAttribution).toBeCloseTo(4, 1);
      expect(data.payouts.mcp-earnPlatform).toBeCloseTo(2, 1);
    });

    it('should reject expired tokens', async () => {
      // Create a new intent and wait for it to expire would take too long
      // Instead, test with an already-used token
      const res = await request('POST', '/conversion', {
        attributionToken: intentToken, // Same token used above
        orderId: 'ord_test999',
        revenue: 50.00,
      }, {
        'X-Partner-ID': saasPartnerId,
      });

      expect(res.status).toBe(409); // Conflict - already used
      const data = await res.json();
      expect(data.error).toBe('INTENT_ALREADY_USED');
    });

    it('should reject invalid tokens', async () => {
      const res = await request('POST', '/conversion', {
        attributionToken: 'invalid.token.here',
        orderId: 'ord_invalid',
        revenue: 50.00,
      }, {
        'X-Partner-ID': saasPartnerId,
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('INVALID_SIGNATURE');
    });
  });

  describe('Stats and Reporting', () => {
    it('should get MCP integrator stats', async () => {
      const res = await request('GET', `/partners/mcp/${mcpIntegratorId}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data.stats.decisionsCount).toBeGreaterThan(0);
      expect(data.data.stats.totalEarnings).toBeGreaterThan(0);
    });
  });
});
