/**
 * API Client for MCP Earn
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

// Types
export interface SaasPartner {
  id: string;
  name: string;
  status: string;
  defaultCommissionRate: number;
  createdAt: string;
}

export interface McpIntegrator {
  id: string;
  name: string;
  email: string;
  status: string;
  decisionsCount: number;
  totalEarnings: number;
  createdAt: string;
}

export interface Conversion {
  id: string;
  intentId: string;
  orderId: string;
  revenue: number;
  status: string;
  createdAt: string;
  verifiedAt: string;
}

// API Functions
export async function getHealth() {
  return fetchApi<{ status: string; timestamp: string }>('/health');
}

export async function getSaasPartners() {
  const res = await fetchApi<{ success: boolean; data: SaasPartner[] }>('/partners/saas');
  return res.data;
}

export async function getMcpIntegrators() {
  const res = await fetchApi<{ success: boolean; data: McpIntegrator[] }>('/partners/mcp');
  return res.data;
}

export async function createSaasPartner(data: { name: string; defaultCommissionRate: number }) {
  return fetchApi<{ success: boolean; data: SaasPartner }>('/partners/saas', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function createMcpIntegrator(data: { name: string; email: string }) {
  return fetchApi<{ success: boolean; data: McpIntegrator }>('/partners/mcp', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function activateMcpIntegrator(id: string) {
  return fetchApi<{ success: boolean }>(`/partners/mcp/${id}/activate`, {
    method: 'PATCH',
  });
}
