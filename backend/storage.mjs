import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export const freshState = products => ({ products: structuredClone(products), carts: {}, orders: {}, idempotency: {} });

// A single transaction covers each API request, including all stock and cart changes.
export function createFileStore(dataFile, seed) {
  let state = dataFile && existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : seed();
  let queue = Promise.resolve();
  return {
    kind: dataFile ? 'file' : 'memory',
    run(handler) {
      const result = queue.then(async () => {
        let working = structuredClone(state), dirty = false;
        const session = { get state() { return working; }, set state(value) { working = value; }, save() { dirty = true; } };
        const response = await handler(session);
        if (dirty) {
          if (dataFile) {
            mkdirSync(path.dirname(dataFile), { recursive: true });
            writeFileSync(`${dataFile}.tmp`, JSON.stringify(working, null, 2));
            renameSync(`${dataFile}.tmp`, dataFile);
          }
          state = working;
        }
        return response;
      });
      queue = result.catch(() => {});
      return result;
    },
    async close() { await queue; }
  };
}

export async function createPostgresStore(connectionString, seed) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('A database connection closed unexpectedly.'));
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS demo_store_state (id integer PRIMARY KEY CHECK (id = 1), state jsonb NOT NULL)');
    await pool.query('INSERT INTO demo_store_state (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(seed())]);
  } catch (error) { await pool.end(); throw error; }
  return {
    kind: 'postgres',
    async run(handler) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Row locking also prevents overselling during overlapping Render deployments.
        const result = await client.query('SELECT state FROM demo_store_state WHERE id = 1 FOR UPDATE');
        let working = result.rows[0].state, dirty = false;
        const session = { get state() { return working; }, set state(value) { working = value; }, save() { dirty = true; } };
        const response = await handler(session);
        if (dirty) await client.query('UPDATE demo_store_state SET state = $1::jsonb WHERE id = 1', [JSON.stringify(working)]);
        await client.query('COMMIT');
        return response;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end()
  };
}
