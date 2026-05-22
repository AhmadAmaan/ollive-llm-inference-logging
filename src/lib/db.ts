import { Pool, type PoolClient, type QueryResultRow } from "pg";

const schemaSql = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    active_request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    last_message_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (conversation_id, sequence_number)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages (conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS inference_logs (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    operation TEXT,
    source_type TEXT,
    session_id TEXT,
    status TEXT NOT NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    request_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    response_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    request_preview TEXT,
    response_preview TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    latency_ms INTEGER,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    raw_metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_inference_logs_conversation_created
    ON inference_logs (conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_inference_logs_provider_model
    ON inference_logs (provider, model);
  CREATE INDEX IF NOT EXISTS idx_inference_logs_status
    ON inference_logs (status);
  CREATE INDEX IF NOT EXISTS idx_inference_logs_session_created
    ON inference_logs (session_id, created_at);

  CREATE TABLE IF NOT EXISTS inference_events (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_inference_events_status_created
    ON inference_events (status, created_at);

  ALTER TABLE inference_logs
    ADD COLUMN IF NOT EXISTS operation TEXT;
  ALTER TABLE inference_logs
    ADD COLUMN IF NOT EXISTS source_type TEXT;
  ALTER TABLE inference_logs
    ADD COLUMN IF NOT EXISTS session_id TEXT;
  ALTER TABLE inference_logs
    ALTER COLUMN conversation_id DROP NOT NULL;
`;

const globalForDb = globalThis as typeof globalThis & {
  __ollivePool?: Pool;
  __olliveSchemaReady?: Promise<void>;
};

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5432/ollive_inference"
  );
}

function createPool() {
  return new Pool({
    connectionString: getDatabaseUrl(),
  });
}

export const pool = globalForDb.__ollivePool ?? createPool();

if (!globalForDb.__ollivePool) {
  globalForDb.__ollivePool = pool;
}

async function ensureSchema() {
  if (!globalForDb.__olliveSchemaReady) {
    globalForDb.__olliveSchemaReady = pool.query(schemaSql).then(() => undefined);
  }

  await globalForDb.__olliveSchemaReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
) {
  await ensureSchema();
  return pool.query<T>(sql, params);
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
) {
  const result = await query<T>(sql, params);
  return result.rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []) {
  await query(sql, params);
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
) {
  await ensureSchema();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
