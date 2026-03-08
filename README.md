# Agent Earn MCP - AI Agent Attribution Protocol

**TEE-attested signed intent tokens for trustworthy AI agent monetization.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EARN MCP ARCHITECTURE                                    │
│                    "70/20/10 Revenue Split"                                 │
└─────────────────────────────────────────────────────────────────────────────┘

    Agent Decision          Attribution Engine          SaaS Conversion
    ┌─────────────┐         ┌─────────────┐            ┌─────────────┐
    │ MCP Tool    │ ──1──▶  │ /intent API │  ──2──▶    │ Partner     │
    │ (recommend) │ ◀──────  │ (sign token)│            │ (Supabase)  │
    └─────────────┘   token └─────────────┘            └──────┬──────┘
                                   │                          │
                                   │  ◀──────────3────────────┘
                                   │     /conversion webhook
                                   ▼
                        ┌─────────────────────┐
                        │  PAYOUT SPLITS      │
                        │  • 70% MCP Dev      │
                        │  • 20% Attribution  │
                        │  • 10% Platform     │
                        └─────────────────────┘
```

## Quick Start

### 1. Start the API Server

```bash
cd api
npm install
npm run dev
```

### 2. Register Partners

```bash
# Register a SaaS partner (demand side)
curl -X POST http://localhost:3000/partners/saas \
  -H "Content-Type: application/json" \
  -d '{"name": "Supabase", "defaultCommissionRate": 0.20}'

# Register an MCP integrator (supply side)
curl -X POST http://localhost:3000/partners/mcp \
  -H "Content-Type: application/json" \
  -d '{"name": "My MCP", "email": "dev@example.com"}'
```

### 3. Create Intent Tokens

```bash
curl -X POST http://localhost:3000/intent \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u_abc123",
    "sessionId": "sess_xyz",
    "saasPartnerId": "saas_xxx",
    "semanticContext": "User needs a PostgreSQL database for Next.js"
  }'
```

### 4. Report Conversions (SaaS Webhook)

```bash
curl -X POST http://localhost:3000/conversion \
  -H "Content-Type: application/json" \
  -H "X-Partner-ID: saas_xxx" \
  -d '{
    "attributionToken": "eyJhbGciOiJFUzI1Ni...",
    "orderId": "ord_123",
    "revenue": 100.00
  }'
```

## Project Structure

```
earn-mcp/
├── api/                 # Attribution Protocol API
│   ├── src/
│   │   ├── db/          # Database schema (SQLite/Drizzle)
│   │   ├── services/    # Attribution logic, TEE tokens
│   │   ├── routes/      # API endpoints
│   │   └── index.ts     # Hono server
│   └── package.json
│
├── sdk/                 # MCP Developer SDK
│   ├── src/
│   │   └── index.ts     # AgentEarn client, helpers
│   └── package.json
│
├── mcp-reference/       # Reference MCP Server
│   ├── src/
│   │   └── index.ts     # SaaS recommender MCP
│   └── package.json
│
└── dashboard/           # Admin UI (integrated in API)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/intent` | POST | Create signed intent token |
| `/conversion` | POST | Report conversion (webhook) |
| `/partners/saas` | GET/POST | Manage SaaS partners |
| `/partners/mcp` | GET/POST | Manage MCP integrators |
| `/dashboard` | GET | Admin UI (HTML) |
| `/dashboard/stats` | GET | Overview statistics |
| `/dashboard/conversions` | GET | Recent conversions feed |
| `/dashboard/payouts` | GET | Payout ledger |
| `/dashboard/integrators` | GET | MCP integrator leaderboard |
| `/health` | GET | Health check |

## Revenue Split

| Recipient | Share | Description |
|-----------|-------|-------------|
| MCP Developer | 70% | Publisher who owns the "decision point" |
| Attribution | 20% | For verifiable attribution infrastructure |
| Platform | 10% | Platform fee |

## SDK Usage

```typescript
import { AgentEarn, appendAttributionToken } from '@agent-earn/sdk';

const client = new AgentEarn({
  apiKey: process.env.AGENT_EARN_API_KEY!,
});

// In your MCP tool handler:
const token = await client.createIntent({
  userId: 'u_abc123',
  sessionId: 'sess_xyz',
  context: 'User needs PostgreSQL for Next.js',
  partnerId: 'supabase',
});

// Pass token to SaaS
const signupUrl = appendAttributionToken('https://supabase.com/dashboard/new', token);
```

## Architecture

### Two-Sided Marketplace

- **Demand Side**: SaaS partners (Vercel, Supabase, Clerk) pay for conversions
- **Supply Side**: MCP developers earn 70% of commissions

### Attribution Protocol

1. **Intent Creation**: Agent creates signed token before recommendation
2. **Token Passing**: Token attached to SaaS API call (header or URL)
3. **Conversion Webhook**: SaaS reports conversion with token
4. **Verification**: Verifies signature, semantic hash, time window, nonce
5. **Payout**: 70/20/10 split triggered on verification

### Security

- **TEE-Attested Tokens**: Keys protected by Trusted Execution Environment
- **Semantic Integrity**: Hash of decision context prevents manipulation
- **5-Minute Expiry**: Short window prevents stale claims
- **Nonce Replay Prevention**: Each token usable only once

## Development

```bash
# Run API in dev mode
cd api && npm run dev

# Run SDK tests
cd sdk && npm test

# Test MCP with inspector
cd mcp-reference && npm run inspector
```

## License

MIT
