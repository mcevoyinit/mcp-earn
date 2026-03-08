/**
 * Dashboard Routes - Admin UI and Analytics
 *
 * Provides:
 * - Overview stats (conversions, revenue, payouts)
 * - Partner management views
 * - Real-time conversion feed
 * - HTML admin dashboard
 */

import { Hono } from 'hono';
import { html } from 'hono/html';
import { eq, sql, desc, count, sum } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  saasPartners,
  mcpIntegrators,
  intents,
  conversions,
  payouts,
} from '../db/schema.js';

export const dashboardRoutes = new Hono();

// ============================================
// API Endpoints for Dashboard Data
// ============================================

/**
 * GET /dashboard/stats - Overview statistics
 */
dashboardRoutes.get('/stats', async (c) => {
  // Total counts
  const [totalPartners] = await db
    .select({ count: count() })
    .from(saasPartners);
  const [totalIntegrators] = await db
    .select({ count: count() })
    .from(mcpIntegrators);
  const [totalIntents] = await db.select({ count: count() }).from(intents);
  const [totalConversions] = await db
    .select({ count: count() })
    .from(conversions)
    .where(eq(conversions.status, 'verified'));

  // Revenue totals
  const [revenueStats] = await db
    .select({
      totalRevenue: sum(conversions.revenue),
      avgRevenue: sql<number>`AVG(${conversions.revenue})`,
    })
    .from(conversions)
    .where(eq(conversions.status, 'verified'));

  // Payout totals by recipient type
  const payoutsByType = await db
    .select({
      recipientType: payouts.recipientType,
      totalAmount: sum(payouts.netAmount),
      count: count(),
    })
    .from(payouts)
    .groupBy(payouts.recipientType);

  // Conversion rate
  const conversionRate =
    totalIntents.count > 0
      ? ((totalConversions.count / totalIntents.count) * 100).toFixed(2)
      : '0.00';

  return c.json({
    success: true,
    data: {
      overview: {
        saasPartners: totalPartners.count,
        mcpIntegrators: totalIntegrators.count,
        totalIntents: totalIntents.count,
        verifiedConversions: totalConversions.count,
        conversionRate: `${conversionRate}%`,
      },
      revenue: {
        total: revenueStats.totalRevenue || 0,
        average: revenueStats.avgRevenue || 0,
      },
      payouts: payoutsByType.reduce(
        (acc, p) => {
          acc[p.recipientType] = {
            total: Number(p.totalAmount) || 0,
            count: p.count,
          };
          return acc;
        },
        {} as Record<string, { total: number; count: number }>
      ),
    },
  });
});

/**
 * GET /dashboard/conversions - Recent conversions feed
 */
dashboardRoutes.get('/conversions', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  const recentConversions = await db
    .select({
      id: conversions.id,
      orderId: conversions.orderId,
      revenue: conversions.revenue,
      status: conversions.status,
      createdAt: conversions.createdAt,
      verifiedAt: conversions.verifiedAt,
      intentId: conversions.intentId,
      saasPartnerId: intents.saasPartnerId,
      saasPartnerName: saasPartners.name,
      mcpIntegratorId: intents.mcpIntegratorId,
      mcpIntegratorName: mcpIntegrators.name,
    })
    .from(conversions)
    .leftJoin(intents, eq(conversions.intentId, intents.id))
    .leftJoin(saasPartners, eq(intents.saasPartnerId, saasPartners.id))
    .leftJoin(mcpIntegrators, eq(intents.mcpIntegratorId, mcpIntegrators.id))
    .orderBy(desc(conversions.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    success: true,
    data: recentConversions,
    pagination: {
      limit,
      offset,
      hasMore: recentConversions.length === limit,
    },
  });
});

/**
 * GET /dashboard/payouts - Payout ledger
 */
dashboardRoutes.get('/payouts', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const status = c.req.query('status') as 'pending' | 'completed' | undefined;

  let query = db
    .select({
      id: payouts.id,
      recipientType: payouts.recipientType,
      recipientId: payouts.recipientId,
      grossAmount: payouts.grossAmount,
      splitRate: payouts.splitRate,
      netAmount: payouts.netAmount,
      status: payouts.status,
      payoutMethod: payouts.payoutMethod,
      createdAt: payouts.createdAt,
      completedAt: payouts.completedAt,
      conversionId: payouts.conversionId,
      orderId: conversions.orderId,
    })
    .from(payouts)
    .leftJoin(conversions, eq(payouts.conversionId, conversions.id))
    .orderBy(desc(payouts.createdAt))
    .limit(limit);

  const payoutList = await query;

  // Calculate totals
  const pendingTotal = payoutList
    .filter((p) => p.status === 'pending')
    .reduce((sum, p) => sum + (p.netAmount || 0), 0);

  const completedTotal = payoutList
    .filter((p) => p.status === 'completed')
    .reduce((sum, p) => sum + (p.netAmount || 0), 0);

  return c.json({
    success: true,
    data: payoutList,
    summary: {
      pendingTotal,
      completedTotal,
      pendingCount: payoutList.filter((p) => p.status === 'pending').length,
    },
  });
});

/**
 * GET /dashboard/integrators - MCP Integrator leaderboard
 */
dashboardRoutes.get('/integrators', async (c) => {
  const integrators = await db
    .select({
      id: mcpIntegrators.id,
      name: mcpIntegrators.name,
      status: mcpIntegrators.status,
      decisionsCount: mcpIntegrators.decisionsCount,
      totalEarnings: mcpIntegrators.totalEarnings,
      revenueShareRate: mcpIntegrators.revenueShareRate,
      createdAt: mcpIntegrators.createdAt,
    })
    .from(mcpIntegrators)
    .orderBy(desc(mcpIntegrators.totalEarnings));

  return c.json({
    success: true,
    data: integrators,
  });
});

// ============================================
// HTML Admin Dashboard
// ============================================

/**
 * GET /dashboard - HTML Admin UI
 */
dashboardRoutes.get('/', async (c) => {
  // Fetch all stats for the dashboard
  const [totalPartners] = await db
    .select({ count: count() })
    .from(saasPartners);
  const [totalIntegrators] = await db
    .select({ count: count() })
    .from(mcpIntegrators);
  const [totalIntents] = await db.select({ count: count() }).from(intents);
  const [totalConversions] = await db
    .select({ count: count() })
    .from(conversions)
    .where(eq(conversions.status, 'verified'));

  const [revenueStats] = await db
    .select({
      totalRevenue: sum(conversions.revenue),
    })
    .from(conversions)
    .where(eq(conversions.status, 'verified'));

  const [pendingPayouts] = await db
    .select({
      total: sum(payouts.netAmount),
      count: count(),
    })
    .from(payouts)
    .where(eq(payouts.status, 'pending'));

  // Recent conversions
  const recentConversions = await db
    .select({
      id: conversions.id,
      orderId: conversions.orderId,
      revenue: conversions.revenue,
      status: conversions.status,
      createdAt: conversions.createdAt,
      saasPartnerName: saasPartners.name,
      mcpIntegratorName: mcpIntegrators.name,
    })
    .from(conversions)
    .leftJoin(intents, eq(conversions.intentId, intents.id))
    .leftJoin(saasPartners, eq(intents.saasPartnerId, saasPartners.id))
    .leftJoin(mcpIntegrators, eq(intents.mcpIntegratorId, mcpIntegrators.id))
    .orderBy(desc(conversions.createdAt))
    .limit(10);

  // Top integrators
  const topIntegrators = await db
    .select({
      name: mcpIntegrators.name,
      totalEarnings: mcpIntegrators.totalEarnings,
      decisionsCount: mcpIntegrators.decisionsCount,
    })
    .from(mcpIntegrators)
    .orderBy(desc(mcpIntegrators.totalEarnings))
    .limit(5);

  const conversionRate =
    totalIntents.count > 0
      ? ((totalConversions.count / totalIntents.count) * 100).toFixed(1)
      : '0.0';

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>MCP Earn - Dashboard</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
        <style>
          .gradient-bg {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .card {
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
          }
          .stat-card {
            transition: transform 0.2s;
          }
          .stat-card:hover {
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body class="bg-gray-100 min-h-screen">
        <!-- Header -->
        <header class="gradient-bg text-white py-6 px-8 shadow-lg">
          <div class="max-w-7xl mx-auto flex justify-between items-center">
            <div>
              <h1 class="text-2xl font-bold flex items-center gap-2">
                <i class="fas fa-chart-line"></i>
                MCP Earn
              </h1>
              <p class="text-purple-200 text-sm mt-1">
                Attribution Protocol Dashboard
              </p>
            </div>
            <div class="flex items-center gap-4">
              <span class="text-sm bg-white/20 px-3 py-1 rounded-full">
                <i class="fas fa-circle text-green-400 text-xs mr-1"></i> Live
              </span>
              <a
                href="/health"
                class="text-sm hover:text-purple-200 transition"
              >
                <i class="fas fa-heartbeat mr-1"></i> Health
              </a>
            </div>
          </div>
        </header>

        <main class="max-w-7xl mx-auto px-8 py-8">
          <!-- Stats Grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <!-- Revenue -->
            <div class="card stat-card p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-gray-500 text-sm font-medium">Total Revenue</p>
                  <p class="text-3xl font-bold text-gray-900 mt-1">
                    $${(revenueStats.totalRevenue || 0).toLocaleString()}
                  </p>
                </div>
                <div
                  class="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center"
                >
                  <i class="fas fa-dollar-sign text-green-600 text-xl"></i>
                </div>
              </div>
              <p class="text-xs text-gray-400 mt-3">
                <i class="fas fa-arrow-up text-green-500"></i> From verified
                conversions
              </p>
            </div>

            <!-- Conversions -->
            <div class="card stat-card p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-gray-500 text-sm font-medium">Conversions</p>
                  <p class="text-3xl font-bold text-gray-900 mt-1">
                    ${totalConversions.count}
                  </p>
                </div>
                <div
                  class="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center"
                >
                  <i class="fas fa-check-circle text-blue-600 text-xl"></i>
                </div>
              </div>
              <p class="text-xs text-gray-400 mt-3">
                <i class="fas fa-percentage text-blue-500"></i> ${conversionRate}%
                conversion rate
              </p>
            </div>

            <!-- Pending Payouts -->
            <div class="card stat-card p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-gray-500 text-sm font-medium">
                    Pending Payouts
                  </p>
                  <p class="text-3xl font-bold text-gray-900 mt-1">
                    $${Number(pendingPayouts.total || 0).toFixed(2)}
                  </p>
                </div>
                <div
                  class="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center"
                >
                  <i class="fas fa-clock text-yellow-600 text-xl"></i>
                </div>
              </div>
              <p class="text-xs text-gray-400 mt-3">
                <i class="fas fa-list text-yellow-500"></i>
                ${pendingPayouts.count || 0} payouts queued
              </p>
            </div>

            <!-- Partners -->
            <div class="card stat-card p-6">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-gray-500 text-sm font-medium">
                    Active Partners
                  </p>
                  <p class="text-3xl font-bold text-gray-900 mt-1">
                    ${totalPartners.count + totalIntegrators.count}
                  </p>
                </div>
                <div
                  class="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center"
                >
                  <i class="fas fa-handshake text-purple-600 text-xl"></i>
                </div>
              </div>
              <p class="text-xs text-gray-400 mt-3">
                ${totalPartners.count} SaaS + ${totalIntegrators.count} MCPs
              </p>
            </div>
          </div>

          <!-- Two Column Layout -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <!-- Recent Conversions -->
            <div class="lg:col-span-2">
              <div class="card">
                <div
                  class="px-6 py-4 border-b border-gray-100 flex justify-between items-center"
                >
                  <h2 class="text-lg font-semibold text-gray-900">
                    <i class="fas fa-stream mr-2 text-purple-500"></i>
                    Recent Conversions
                  </h2>
                  <a
                    href="/dashboard/conversions"
                    class="text-sm text-purple-600 hover:text-purple-800"
                  >
                    View All <i class="fas fa-arrow-right ml-1"></i>
                  </a>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full">
                    <thead class="bg-gray-50">
                      <tr>
                        <th
                          class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          Order
                        </th>
                        <th
                          class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          Partner
                        </th>
                        <th
                          class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          MCP
                        </th>
                        <th
                          class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          Revenue
                        </th>
                        <th
                          class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-100">
                      ${recentConversions.length === 0
                        ? html`
                            <tr>
                              <td
                                colspan="5"
                                class="px-6 py-8 text-center text-gray-400"
                              >
                                <i
                                  class="fas fa-inbox text-4xl mb-2 block"
                                ></i>
                                No conversions yet. Create intents to get
                                started!
                              </td>
                            </tr>
                          `
                        : recentConversions.map(
                            (conv) => html`
                              <tr class="hover:bg-gray-50 transition">
                                <td
                                  class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900"
                                >
                                  ${conv.orderId?.slice(0, 12)}...
                                </td>
                                <td
                                  class="px-6 py-4 whitespace-nowrap text-sm text-gray-600"
                                >
                                  ${conv.saasPartnerName || 'Unknown'}
                                </td>
                                <td
                                  class="px-6 py-4 whitespace-nowrap text-sm text-gray-600"
                                >
                                  ${conv.mcpIntegratorName || 'Direct'}
                                </td>
                                <td
                                  class="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600"
                                >
                                  $${(conv.revenue || 0).toFixed(2)}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap">
                                  <span
                                    class="px-2 py-1 text-xs font-medium rounded-full ${conv.status ===
                                    'verified'
                                      ? 'bg-green-100 text-green-800'
                                      : conv.status === 'pending'
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : 'bg-red-100 text-red-800'}"
                                  >
                                    ${conv.status}
                                  </span>
                                </td>
                              </tr>
                            `
                          )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- Top Integrators -->
            <div>
              <div class="card">
                <div class="px-6 py-4 border-b border-gray-100">
                  <h2 class="text-lg font-semibold text-gray-900">
                    <i class="fas fa-trophy mr-2 text-yellow-500"></i>
                    Top MCP Integrators
                  </h2>
                </div>
                <div class="p-6">
                  ${topIntegrators.length === 0
                    ? html`
                        <p class="text-center text-gray-400 py-4">
                          <i class="fas fa-users text-3xl mb-2 block"></i>
                          No integrators yet
                        </p>
                      `
                    : topIntegrators.map(
                        (int, i) => html`
                          <div
                            class="flex items-center justify-between py-3 ${i > 0 ? 'border-t border-gray-100' : ''}"
                          >
                            <div class="flex items-center gap-3">
                              <span
                                class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${i === 0 ? 'bg-yellow-100 text-yellow-600' : i === 1 ? 'bg-gray-200 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'}"
                              >
                                ${i + 1}
                              </span>
                              <div>
                                <p class="font-medium text-gray-900">
                                  ${int.name}
                                </p>
                                <p class="text-xs text-gray-400">
                                  ${int.decisionsCount || 0} decisions
                                </p>
                              </div>
                            </div>
                            <span class="font-semibold text-green-600">
                              $${(int.totalEarnings || 0).toFixed(2)}
                            </span>
                          </div>
                        `
                      )}
                </div>
              </div>

              <!-- Revenue Split -->
              <div class="card mt-6">
                <div class="px-6 py-4 border-b border-gray-100">
                  <h2 class="text-lg font-semibold text-gray-900">
                    <i class="fas fa-pie-chart mr-2 text-blue-500"></i>
                    Revenue Split
                  </h2>
                </div>
                <div class="p-6">
                  <div class="space-y-4">
                    <div>
                      <div class="flex justify-between text-sm mb-1">
                        <span class="text-gray-600">MCP Developer</span>
                        <span class="font-medium">70%</span>
                      </div>
                      <div class="w-full bg-gray-200 rounded-full h-2">
                        <div
                          class="bg-purple-600 h-2 rounded-full"
                          style="width: 70%"
                        ></div>
                      </div>
                    </div>
                    <div>
                      <div class="flex justify-between text-sm mb-1">
                        <span class="text-gray-600">Attribution</span>
                        <span class="font-medium">20%</span>
                      </div>
                      <div class="w-full bg-gray-200 rounded-full h-2">
                        <div
                          class="bg-blue-600 h-2 rounded-full"
                          style="width: 20%"
                        ></div>
                      </div>
                    </div>
                    <div>
                      <div class="flex justify-between text-sm mb-1">
                        <span class="text-gray-600">Platform Fee</span>
                        <span class="font-medium">10%</span>
                      </div>
                      <div class="w-full bg-gray-200 rounded-full h-2">
                        <div
                          class="bg-green-600 h-2 rounded-full"
                          style="width: 10%"
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- API Quick Reference -->
          <div class="card mt-8">
            <div class="px-6 py-4 border-b border-gray-100">
              <h2 class="text-lg font-semibold text-gray-900">
                <i class="fas fa-code mr-2 text-gray-500"></i>
                API Quick Reference
              </h2>
            </div>
            <div class="p-6">
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="bg-gray-50 rounded-lg p-4">
                  <code class="text-sm text-purple-600 font-mono"
                    >POST /intent</code
                  >
                  <p class="text-xs text-gray-500 mt-1">
                    Create signed intent token
                  </p>
                </div>
                <div class="bg-gray-50 rounded-lg p-4">
                  <code class="text-sm text-purple-600 font-mono"
                    >POST /conversion</code
                  >
                  <p class="text-xs text-gray-500 mt-1">
                    Report & verify conversion
                  </p>
                </div>
                <div class="bg-gray-50 rounded-lg p-4">
                  <code class="text-sm text-purple-600 font-mono"
                    >GET /dashboard/stats</code
                  >
                  <p class="text-xs text-gray-500 mt-1">Overview statistics</p>
                </div>
                <div class="bg-gray-50 rounded-lg p-4">
                  <code class="text-sm text-purple-600 font-mono"
                    >GET /partners/*</code
                  >
                  <p class="text-xs text-gray-500 mt-1">Manage partners</p>
                </div>
              </div>
            </div>
          </div>
        </main>

        <!-- Footer -->
        <footer class="text-center py-6 text-gray-400 text-sm">
          <p>
            MCP Earn Attribution Protocol v0.1.0 |
            <a
              href="https://docs.mcp-earn.ai"
              class="text-purple-500 hover:text-purple-600"
              >Documentation</a
            >
          </p>
        </footer>

        <script>
          // Auto-refresh stats every 30 seconds
          setInterval(() => {
            fetch('/dashboard/stats')
              .then((r) => r.json())
              .then((data) => {
                console.log('Stats refreshed:', data);
              });
          }, 30000);
        </script>
      </body>
    </html>
  `);
});
