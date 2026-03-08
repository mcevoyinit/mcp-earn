/**
 * Database connection and initialization
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const DATABASE_PATH = process.env.DATABASE_PATH || './data/earn-mcp.db';

// Create database directory if needed
import { mkdirSync } from 'fs';
import { dirname } from 'path';
try {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
} catch {
  // Directory exists
}

const sqlite = new Database(DATABASE_PATH);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });

// Initialize schema
export function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS saas_partners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      webhook_secret TEXT NOT NULL,
      default_commission_rate REAL DEFAULT 0.20,
      min_commission REAL DEFAULT 10.0,
      max_commission REAL DEFAULT 500.0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mcp_integrators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      api_key TEXT NOT NULL UNIQUE,
      revenue_share_rate REAL DEFAULT 0.70,
      payout_method TEXT DEFAULT 'usdc',
      payout_address TEXT,
      status TEXT DEFAULT 'pending',
      decisions_count INTEGER DEFAULT 0,
      total_earnings REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      mcp_integrator_id TEXT REFERENCES mcp_integrators(id),
      saas_partner_id TEXT NOT NULL REFERENCES saas_partners(id),
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      semantic_intent_hash TEXT NOT NULL,
      kl_divergence REAL,
      nonce TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      user_agent TEXT,
      ip_hash TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversions (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intents(id),
      order_id TEXT NOT NULL,
      revenue REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      signature_valid INTEGER NOT NULL,
      semantic_match INTEGER NOT NULL,
      time_window_valid INTEGER NOT NULL,
      nonce_valid INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      rejection_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      conversion_id TEXT NOT NULL REFERENCES conversions(id),
      recipient_type TEXT NOT NULL,
      recipient_id TEXT,
      gross_amount REAL NOT NULL,
      split_rate REAL NOT NULL,
      net_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      payout_method TEXT,
      transaction_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      tee_attestation TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_intents_token ON intents(token);
    CREATE INDEX IF NOT EXISTS idx_intents_nonce ON intents(nonce);
    CREATE INDEX IF NOT EXISTS idx_intents_user_id ON intents(user_id);
    CREATE INDEX IF NOT EXISTS idx_intents_saas_partner ON intents(saas_partner_id);
    CREATE INDEX IF NOT EXISTS idx_conversions_intent ON conversions(intent_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_conversion ON payouts(conversion_id);
  `);
}

export { schema };
