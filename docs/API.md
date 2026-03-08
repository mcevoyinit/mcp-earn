# MCP Earn API Documentation

**Version**: 0.1.0
**Base URL**: `http://localhost:3000` (development) or `https://api.earn.mcp-earn.ai` (production)

---

## Authentication

### API Keys

All mutating endpoints require authentication via the `X-MCP Earn-API-Key` header.

```bash
curl -X POST http://localhost:3000/intent \
  -H "X-MCP Earn-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

### Partner Authentication (Webhooks)

For conversion webhooks, use the `X-Partner-ID` header along with HMAC signature verification.

```bash
curl -X POST http://localhost:3000/conversion \
  -H "X-Partner-ID: saas_xxx" \
  -H "X-MCP Earn-Signature: sha256=..." \
  -H "Content-Type: application/json" \
  -d '{...}'
```

---

## Core Endpoints

### POST /intent

Create a signed intent token for a tool recommendation.

**Request Body**:
```json
{
  "userId": "u_abc123",
  "sessionId": "sess_xyz",
  "saasPartnerId": "saas_xxx",
  "mcpIntegratorId": "mcp_yyy",      // Optional
  "semanticContext": "User needs a PostgreSQL database for Next.js app"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
    "intentId": "GqO3J5wyqxeGdOJx",
    "expiresAt": "2026-01-22T16:05:00.000Z",
    "saasPartnerId": "saas_xxx"
  }
}
```

**Errors**:
| Code | Error | Description |
|------|-------|-------------|
| 400 | VALIDATION_ERROR | Missing required fields |
| 404 | PARTNER_NOT_FOUND | Invalid saasPartnerId |
| 500 | INTERNAL_ERROR | Server error |

**Token Structure** (JWT payload):
```json
{
  "iid": "intent_id",
  "uid": "user_id_hash",
  "sid": "session_id",
  "pid": "saas_partner_id",
  "mid": "mcp_integrator_id",
  "shash": "sha256_of_semantic_context",
  "nonce": "unique_replay_prevention",
  "exp": 1706022300
}
```

---

### POST /conversion

Report a conversion event (webhook from SaaS partner).

**Headers**:
- `X-Partner-ID`: Your partner ID (required)
- `X-MCP Earn-Signature`: HMAC-SHA256 signature (recommended)

**Request Body**:
```json
{
  "attributionToken": "eyJhbGciOiJFUzI1NiIs...",
  "orderId": "ord_123456",
  "revenue": 100.00,
  "currency": "USD"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "conversionId": "GtZAWODyWkXxa6bU",
    "status": "verified",
    "payouts": [
      {
        "recipientType": "mcp_integrator",
        "amount": 14.00
      },
      {
        "recipientType": "mcp-earn_attribution",
        "amount": 4.00
      },
      {
        "recipientType": "mcp-earn_platform",
        "amount": 2.00
      }
    ]
  }
}
```

**Verification Steps**:
1. **Signature Valid**: Token signed by MCP Earn
2. **Time Window Valid**: Token not expired (5 min default)
3. **Nonce Valid**: Token not already used (replay prevention)
4. **Semantic Match**: Context hash matches (fraud prevention)

**Errors**:
| Code | Error | Description |
|------|-------|-------------|
| 400 | INVALID_TOKEN | Malformed or unsigned token |
| 401 | UNAUTHORIZED | Invalid partner credentials |
| 404 | INTENT_NOT_FOUND | Token references unknown intent |
| 409 | ALREADY_CONVERTED | Token already redeemed |
| 410 | TOKEN_EXPIRED | Token past expiry time |

---

## Partner Management

### GET /partners/saas

List all SaaS partners.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "saas_xxx",
      "name": "Supabase",
      "defaultCommissionRate": 0.20,
      "status": "active",
      "createdAt": "2026-01-22T16:00:00.000Z"
    }
  ]
}
```

### POST /partners/saas

Register a new SaaS partner.

**Request Body**:
```json
{
  "name": "Supabase",
  "defaultCommissionRate": 0.20,
  "minCommission": 10.00,
  "maxCommission": 500.00
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "id": "saas_xxx",
    "apiKey": "mcp-earn_saas_xxx_secretkey",
    "webhookSecret": "whsec_xxx"
  }
}
```

---

### GET /partners/mcp

List all MCP integrators.

### POST /partners/mcp

Register a new MCP integrator.

**Request Body**:
```json
{
  "name": "My Awesome MCP",
  "email": "dev@example.com",
  "payoutMethod": "usdc",
  "payoutAddress": "0x..."
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "id": "mcp_xxx",
    "apiKey": "mcp-earn_mcp_xxx_secretkey",
    "status": "pending"
  }
}
```

---

## Dashboard Endpoints

### GET /dashboard

Returns the HTML admin dashboard UI.

### GET /dashboard/stats

Overview statistics for the platform.

**Response**:
```json
{
  "success": true,
  "data": {
    "overview": {
      "saasPartners": 5,
      "mcpIntegrators": 12,
      "totalIntents": 1500,
      "verifiedConversions": 85,
      "conversionRate": "5.67%"
    },
    "revenue": {
      "total": 8500,
      "average": 100
    },
    "payouts": {
      "mcp_integrator": { "total": 5950, "count": 85 },
      "mcp-earn_attribution": { "total": 1700, "count": 85 },
      "mcp-earn_platform": { "total": 850, "count": 85 }
    }
  }
}
```

### GET /dashboard/conversions

Recent conversions feed.

**Query Parameters**:
- `limit`: Number of results (default: 20, max: 100)
- `offset`: Pagination offset

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "conv_xxx",
      "orderId": "ord_123",
      "revenue": 100,
      "status": "verified",
      "createdAt": "2026-01-22T16:02:00.000Z",
      "saasPartnerName": "Supabase",
      "mcpIntegratorName": "My MCP"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "hasMore": false
  }
}
```

### GET /dashboard/payouts

Payout ledger with totals.

**Query Parameters**:
- `limit`: Number of results (default: 50)
- `status`: Filter by status (`pending`, `completed`)

**Response**:
```json
{
  "success": true,
  "data": [...],
  "summary": {
    "pendingTotal": 150.00,
    "completedTotal": 5800.00,
    "pendingCount": 3
  }
}
```

### GET /dashboard/integrators

MCP integrator leaderboard by earnings.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "mcp_xxx",
      "name": "Top MCP",
      "totalEarnings": 2500.00,
      "decisionsCount": 150,
      "status": "active"
    }
  ]
}
```

---

## Health Check

### GET /health

**Response**:
```json
{
  "status": "healthy",
  "service": "mcp-earn-mcp-api",
  "version": "0.1.0",
  "timestamp": "2026-01-22T16:30:00.000Z"
}
```

---

## SDK Integration

### TypeScript/JavaScript

```typescript
import { McpEarn } from '@mcp-earn/sdk';

const mcp-earn = new McpEarn({
  apiKey: process.env.MCP_EARN_API_KEY!,
  baseUrl: 'https://api.earn.mcp-earn.ai', // Optional
});

// Create intent before recommending a tool
const { token } = await mcp-earn.createIntent({
  userId: hashUserId(user.id),
  sessionId: session.id,
  partnerId: 'supabase',
  context: 'User needs PostgreSQL for Next.js'
});

// Pass token to SaaS (URL param or header)
const signupUrl = `https://supabase.com/new?mcp-earn=${token}`;
```

### MCP Server Integration

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpEarn, wrapToolWithAttribution } from '@mcp-earn/sdk';

const server = new McpServer({ name: 'my-mcp' });
const mcp-earn = new McpEarn({ apiKey: 'xxx' });

// Wrap your tool with automatic attribution
server.tool(
  'recommend_database',
  wrapToolWithAttribution(mcp-earn, {
    partnerId: 'supabase',
    handler: async (args, context) => {
      return {
        recommendation: 'Supabase',
        signupUrl: context.mcp-earnSignupUrl, // Has token appended
      };
    }
  })
);
```

---

## Revenue Split Details

| Recipient | Rate | Description |
|-----------|------|-------------|
| **MCP Developer** | 70% | The publisher who owns the "decision point" |
| **Attribution** | 20% | For verifiable attribution infrastructure |
| **Platform** | 10% | Platform operating fee |

### Commission Calculation

```
Total Commission = SaaS Revenue × Commission Rate

Example:
- User signs up for Supabase Pro ($100/mo)
- Supabase pays 20% commission = $20
- Split: MCP Dev ($14) + MCP Earn Attrib ($4) + Platform ($2)
```

### Payout Schedule

- **Pending**: Conversion verified, awaiting payout batch
- **Processing**: Included in current payout batch
- **Completed**: Funds transferred
- **Failed**: Transfer failed (retry queued)

---

## Error Handling

All errors follow this format:

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Invalid request body |
| UNAUTHORIZED | 401 | Missing or invalid API key |
| NOT_FOUND | 404 | Resource not found |
| ALREADY_CONVERTED | 409 | Token already redeemed |
| TOKEN_EXPIRED | 410 | Intent token expired |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |

---

## Rate Limits

| Endpoint | Rate Limit |
|----------|------------|
| `/intent` | 100/min per API key |
| `/conversion` | 1000/min per partner |
| `/dashboard/*` | 60/min |
| Others | 1000/min |

---

## Webhook Security

### HMAC Signature Verification

SaaS partners should verify webhooks from MCP Earn:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### Replay Prevention

Each intent token contains a unique nonce. Tokens can only be converted once.

---

## Changelog

### v0.1.0 (2026-01-22)
- Initial release
- Core attribution protocol (intent/conversion)
- Partner management API
- Dashboard UI and analytics endpoints
- TypeScript SDK
- Reference MCP implementation
