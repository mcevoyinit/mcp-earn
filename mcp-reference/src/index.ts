#!/usr/bin/env node
/**
 * MCP Earn SaaS Recommender MCP
 *
 * A reference MCP server that recommends SaaS tools with MCP Earn attribution.
 * This is the "Model 1: Lovable Connector" implementation from the architecture.
 *
 * Supported partners:
 * - Supabase (databases, auth, storage)
 * - Vercel (deployment, edge functions)
 * - Clerk (authentication)
 * - Stripe (payments)
 *
 * Usage:
 * 1. Set MCP_EARN_API_KEY environment variable
 * 2. Run: npx @mcp-earn/saas-recommender-mcp
 * 3. Connect from Claude Desktop or other MCP client
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { McpEarn, appendAttributionToken, type IntentToken } from '@mcp-earn/sdk';

// ============================================
// Configuration
// ============================================

const MCP_EARN_API_KEY = process.env.MCP_EARN_API_KEY;
const MCP Earn_API_URL = process.env.MCP Earn_API_URL || 'http://localhost:3000';

// Partner configurations
const PARTNERS = {
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    signupUrl: 'https://supabase.com/dashboard/new',
    categories: ['database', 'auth', 'storage', 'realtime', 'edge-functions'],
    description: 'Open source Firebase alternative with PostgreSQL',
  },
  vercel: {
    id: 'vercel',
    name: 'Vercel',
    signupUrl: 'https://vercel.com/new',
    categories: ['deployment', 'hosting', 'edge-functions', 'analytics'],
    description: 'Frontend cloud platform for deploying web applications',
  },
  clerk: {
    id: 'clerk',
    name: 'Clerk',
    signupUrl: 'https://dashboard.clerk.com/sign-up',
    categories: ['auth', 'user-management', 'session'],
    description: 'Complete user management and authentication',
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    signupUrl: 'https://dashboard.stripe.com/register',
    categories: ['payments', 'subscriptions', 'invoicing', 'billing'],
    description: 'Payment processing and financial infrastructure',
  },
} as const;

type PartnerId = keyof typeof PARTNERS;

// ============================================
// MCP Earn Client
// ============================================

let earnClient: McpEarn | null = null;

function initEarnClient(): McpEarn | null {
  if (!MCP_EARN_API_KEY) {
    console.error('[MCP Earn] Warning: MCP_EARN_API_KEY not set. Attribution tracking disabled.');
    return null;
  }

  return new McpEarn({
    apiKey: MCP_EARN_API_KEY,
    baseUrl: MCP Earn_API_URL,
  });
}

// ============================================
// Tool Definitions
// ============================================

const TOOLS: Tool[] = [
  {
    name: 'recommend_saas',
    description: `Recommend a SaaS tool based on the user's needs. Returns the best matching service with a signup link. Supported categories: database, auth, storage, deployment, payments, hosting, edge-functions.`,
    inputSchema: {
      type: 'object',
      properties: {
        need: {
          type: 'string',
          description: 'What the user needs (e.g., "PostgreSQL database", "user authentication", "payment processing")',
        },
        userId: {
          type: 'string',
          description: 'User identifier for attribution tracking',
        },
        sessionId: {
          type: 'string',
          description: 'Session identifier for grouping related recommendations',
        },
      },
      required: ['need', 'userId', 'sessionId'],
    },
  },
  {
    name: 'get_partner_info',
    description: 'Get detailed information about a specific SaaS partner',
    inputSchema: {
      type: 'object',
      properties: {
        partnerId: {
          type: 'string',
          enum: Object.keys(PARTNERS),
          description: 'The partner ID to get info for',
        },
      },
      required: ['partnerId'],
    },
  },
  {
    name: 'list_partners',
    description: 'List all available SaaS partners and their categories',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ============================================
// Recommendation Logic
// ============================================

interface Recommendation {
  partner: typeof PARTNERS[PartnerId];
  relevance: number;
  reason: string;
}

function findBestMatch(need: string): Recommendation | null {
  const needLower = need.toLowerCase();

  // Keyword matching with scoring
  const matches: Recommendation[] = [];

  for (const [id, partner] of Object.entries(PARTNERS)) {
    let score = 0;
    const reasons: string[] = [];

    // Check category matches
    for (const category of partner.categories) {
      if (needLower.includes(category)) {
        score += 10;
        reasons.push(`matches category: ${category}`);
      }
    }

    // Check specific keywords
    const keywords: Record<string, string[]> = {
      supabase: ['postgres', 'postgresql', 'database', 'db', 'realtime', 'supabase', 'storage', 'bucket'],
      vercel: ['deploy', 'hosting', 'next.js', 'nextjs', 'frontend', 'vercel', 'serverless'],
      clerk: ['auth', 'authentication', 'login', 'signup', 'user management', 'clerk', 'session'],
      stripe: ['payment', 'checkout', 'subscription', 'billing', 'invoice', 'stripe', 'credit card'],
    };

    for (const keyword of keywords[id] || []) {
      if (needLower.includes(keyword)) {
        score += 5;
        reasons.push(`keyword match: ${keyword}`);
      }
    }

    if (score > 0) {
      matches.push({
        partner: partner as typeof PARTNERS[PartnerId],
        relevance: score,
        reason: reasons.join(', '),
      });
    }
  }

  // Return highest scoring match
  matches.sort((a, b) => b.relevance - a.relevance);
  return matches[0] || null;
}

// ============================================
// Tool Handlers
// ============================================

async function handleRecommendSaas(
  args: { need: string; userId: string; sessionId: string }
): Promise<string> {
  const match = findBestMatch(args.need);

  if (!match) {
    return JSON.stringify({
      success: false,
      message: 'No matching SaaS partner found for your needs. Try being more specific about what you need (database, auth, payments, deployment, etc.)',
    });
  }

  let signupUrl = match.partner.signupUrl;
  let attributionToken: IntentToken | null = null;

  // Create attribution token if MCP Earn client is available
  if (earnClient) {
    try {
      attributionToken = await earnClient.createIntent({
        userId: args.userId,
        sessionId: args.sessionId,
        context: `User needs: ${args.need}. Recommended: ${match.partner.name} because ${match.reason}`,
        partnerId: match.partner.id,
      });

      // Append token to signup URL
      signupUrl = appendAttributionToken(signupUrl, attributionToken);

      console.error(`[MCP Earn] Attribution token created: ${attributionToken.intentId}`);
    } catch (error) {
      console.error('[MCP Earn] Failed to create attribution token:', error);
      // Continue without attribution - don't block the recommendation
    }
  }

  return JSON.stringify({
    success: true,
    recommendation: {
      partner: match.partner.name,
      partnerId: match.partner.id,
      description: match.partner.description,
      categories: match.partner.categories,
      relevance: match.relevance,
      matchReason: match.reason,
    },
    signupUrl,
    attribution: attributionToken ? {
      intentId: attributionToken.intentId,
      expiresAt: attributionToken.expiresAt,
      tracked: true,
    } : {
      tracked: false,
      reason: 'MCP Earn attribution not configured',
    },
    instructions: `To get started with ${match.partner.name}:
1. Click the signup link above
2. Create your account
3. Follow the setup wizard

The link includes attribution tracking so the recommendation can be properly credited.`,
  });
}

async function handleGetPartnerInfo(args: { partnerId: string }): Promise<string> {
  const partner = PARTNERS[args.partnerId as PartnerId];

  if (!partner) {
    return JSON.stringify({
      success: false,
      message: `Unknown partner: ${args.partnerId}`,
      availablePartners: Object.keys(PARTNERS),
    });
  }

  return JSON.stringify({
    success: true,
    partner: {
      id: partner.id,
      name: partner.name,
      description: partner.description,
      categories: partner.categories,
      signupUrl: partner.signupUrl,
    },
  });
}

async function handleListPartners(): Promise<string> {
  const partners = Object.entries(PARTNERS).map(([id, partner]) => ({
    id,
    name: partner.name,
    description: partner.description,
    categories: partner.categories,
  }));

  return JSON.stringify({
    success: true,
    partners,
    totalCount: partners.length,
  });
}

// ============================================
// MCP Server Setup
// ============================================

const server = new Server(
  {
    name: 'mcp-earn-saas-recommender',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case 'recommend_saas':
        result = await handleRecommendSaas(args as any);
        break;
      case 'get_partner_info':
        result = await handleGetPartnerInfo(args as any);
        break;
      case 'list_partners':
        result = await handleListPartners();
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ============================================
// Startup
// ============================================

async function main() {
  // Initialize MCP Earn client
  earnClient = initEarnClient();

  if (earnClient) {
    // Verify connection
    const healthy = await earnClient.healthCheck();
    if (healthy) {
      console.error('[MCP Earn] Attribution tracking enabled');
    } else {
      console.error('[MCP Earn] Warning: API unreachable. Attribution may not work.');
    }
  }

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP] MCP Earn SaaS Recommender MCP server started');
  console.error('[MCP] Partners:', Object.keys(PARTNERS).join(', '));
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
