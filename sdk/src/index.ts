/**
 * @agent-earn/sdk
 *
 * SDK for MCP developers to integrate with the Earn attribution protocol.
 *
 * Usage:
 * ```typescript
 * import { AgentEarn, withAttribution } from '@agent-earn/sdk';
 *
 * const client = new AgentEarn({
 *   apiKey: process.env.AGENT_EARN_API_KEY!,
 *   partnerId: 'supabase', // Default SaaS partner
 * });
 *
 * // In your MCP tool handler:
 * const token = await client.createIntent({
 *   userId: userContext.id,
 *   sessionId: session.id,
 *   context: 'User needs a database for their Next.js app',
 * });
 *
 * // Pass token to SaaS API
 * const response = await fetch('https://supabase.com/api/signup', {
 *   headers: { 'X-Attribution-Token': token.token },
 * });
 * ```
 */

import { request as undiciRequest } from 'undici';

// ============================================
// Types
// ============================================

export interface AgentEarnConfig {
  /** Your MCP integrator API key */
  apiKey: string;
  /** Default SaaS partner ID */
  partnerId?: string;
  /** API base URL (defaults to production) */
  baseUrl?: string;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
}

export interface CreateIntentOptions {
  /** Anonymized user identifier */
  userId: string;
  /** Session ID for grouping */
  sessionId: string;
  /** The agent's decision context (for semantic integrity) */
  context: string;
  /** Target SaaS partner (overrides default) */
  partnerId?: string;
}

export interface IntentToken {
  /** Signed JWT token to pass to SaaS */
  token: string;
  /** Reference ID for tracking */
  intentId: string;
  /** Expiry timestamp (ISO) */
  expiresAt: string;
  /** Nonce for replay prevention */
  nonce: string;
}

export interface IntentResult {
  success: boolean;
  data?: IntentToken;
  error?: string;
}

export interface EarnStats {
  integratorId: string;
  name: string;
  decisionsCount: number;
  totalEarnings: number;
  revenueShareRate: number;
}

// ============================================
// Main Client
// ============================================

export class AgentEarn {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly defaultPartnerId?: string;

  constructor(config: AgentEarnConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.agent-earn.com';
    this.timeout = config.timeout || 10000;
    this.defaultPartnerId = config.partnerId;
  }

  /**
   * Create a signed intent token for attribution tracking.
   *
   * Call this when your MCP is about to recommend a SaaS partner.
   * Pass the returned token to the SaaS via the X-Attribution-Token header
   * or ?attribution_token query parameter.
   *
   * @example
   * ```typescript
   * const token = await client.createIntent({
   *   userId: 'u_abc123',
   *   sessionId: 'sess_xyz',
   *   context: 'User needs a PostgreSQL database for their Next.js project',
   *   partnerId: 'supabase',
   * });
   *
   * // Option 1: Header
   * fetch(url, { headers: { 'X-Attribution-Token': token.token } });
   *
   * // Option 2: Query param
   * fetch(`${url}?attribution_token=${token.token}`);
   * ```
   */
  async createIntent(options: CreateIntentOptions): Promise<IntentToken> {
    const partnerId = options.partnerId || this.defaultPartnerId;

    if (!partnerId) {
      throw new Error('partnerId is required (set in constructor or createIntent options)');
    }

    const response = await this.request('POST', '/intent', {
      userId: options.userId,
      sessionId: options.sessionId,
      saasPartnerId: partnerId,
      semanticContext: options.context,
    });

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to create intent');
    }

    return response.data as IntentToken;
  }

  /**
   * Get attribution stats for your integrator account.
   *
   * @example
   * ```typescript
   * const stats = await client.getStats();
   * console.log(`Total earnings: $${stats.totalEarnings}`);
   * console.log(`Decisions tracked: ${stats.decisionsCount}`);
   * ```
   */
  async getStats(): Promise<EarnStats> {
    const response = await this.request('GET', '/partners/mcp/me');

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to get stats');
    }

    return response.data as EarnStats;
  }

  /**
   * Check if the API is reachable and credentials are valid.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/health');
      return response.status === 'healthy';
    } catch {
      return false;
    }
  }

  // ============================================
  // Internal Methods
  // ============================================

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const url = `${this.baseUrl}${path}`;

    const { statusCode, body: responseBody } = await undiciRequest(url, {
      method: method as 'GET' | 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      bodyTimeout: this.timeout,
      headersTimeout: this.timeout,
    });

    const text = await responseBody.text();

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid response: ${text.slice(0, 100)}`);
    }
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Create a URL with the attribution token appended.
 *
 * @example
 * ```typescript
 * const signupUrl = appendAttributionToken(
 *   'https://supabase.com/dashboard/new',
 *   intentToken
 * );
 * // => https://supabase.com/dashboard/new?attribution_token=eyJ...
 * ```
 */
export function appendAttributionToken(url: string, token: IntentToken | string): string {
  const tokenValue = typeof token === 'string' ? token : token.token;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}attribution_token=${encodeURIComponent(tokenValue)}`;
}

/**
 * Create headers object with the attribution token.
 *
 * @example
 * ```typescript
 * const headers = attributionHeaders(intentToken, {
 *   'Authorization': 'Bearer xyz',
 * });
 * fetch(url, { headers });
 * ```
 */
export function attributionHeaders(
  token: IntentToken | string,
  additionalHeaders?: Record<string, string>
): Record<string, string> {
  const tokenValue = typeof token === 'string' ? token : token.token;
  return {
    'X-Attribution-Token': tokenValue,
    ...additionalHeaders,
  };
}

/**
 * Higher-order function to wrap API calls with attribution.
 *
 * @example
 * ```typescript
 * const createSupabaseProject = withAttribution(client, 'supabase',
 *   async (token, projectName: string) => {
 *     return fetch('https://supabase.com/api/projects', {
 *       method: 'POST',
 *       headers: attributionHeaders(token, { 'Content-Type': 'application/json' }),
 *       body: JSON.stringify({ name: projectName }),
 *     });
 *   }
 * );
 *
 * // Usage in MCP tool:
 * await createSupabaseProject(userContext, sessionId, 'my-project');
 * ```
 */
export function withAttribution<T extends unknown[], R>(
  client: AgentEarn,
  partnerId: string,
  fn: (token: IntentToken, ...args: T) => Promise<R>
): (userId: string, sessionId: string, context: string, ...args: T) => Promise<R> {
  return async (userId: string, sessionId: string, context: string, ...args: T) => {
    const token = await client.createIntent({
      userId,
      sessionId,
      context,
      partnerId,
    });
    return fn(token, ...args);
  };
}

// ============================================
// MCP Integration Helpers
// ============================================

/**
 * Context manager for tracking attribution across MCP tool calls.
 *
 * @example
 * ```typescript
 * const tracker = new AttributionTracker(earnClient);
 *
 * // In your MCP server:
 * server.setRequestHandler(CallToolRequestSchema, async (request) => {
 *   const { userId, sessionId } = extractUserContext(request);
 *
 *   return tracker.track(userId, sessionId, async (track) => {
 *     if (request.params.name === 'recommend_database') {
 *       const token = await track('supabase', 'User needs PostgreSQL for Next.js');
 *       // Use token when calling Supabase API
 *     }
 *   });
 * });
 * ```
 */
export class AttributionTracker {
  private client: AgentEarn;
  private activeTokens: Map<string, IntentToken> = new Map();

  constructor(client: AgentEarn) {
    this.client = client;
  }

  /**
   * Execute a function with attribution tracking.
   */
  async track<T>(
    userId: string,
    sessionId: string,
    fn: (createToken: (partnerId: string, context: string) => Promise<IntentToken>) => Promise<T>
  ): Promise<T> {
    const createToken = async (partnerId: string, context: string): Promise<IntentToken> => {
      const token = await this.client.createIntent({
        userId,
        sessionId,
        context,
        partnerId,
      });

      // Cache token for this session
      const key = `${sessionId}:${partnerId}`;
      this.activeTokens.set(key, token);

      return token;
    };

    return fn(createToken);
  }

  /**
   * Get a cached token for a session/partner combination.
   */
  getToken(sessionId: string, partnerId: string): IntentToken | undefined {
    return this.activeTokens.get(`${sessionId}:${partnerId}`);
  }

  /**
   * Clear expired tokens (call periodically).
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [key, token] of this.activeTokens) {
      if (new Date(token.expiresAt).getTime() < now) {
        this.activeTokens.delete(key);
      }
    }
  }
}

// Default export for convenience
export default AgentEarn;
