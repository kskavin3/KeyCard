import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const connection = new URL(databaseUrl);
if (connection.hostname.endsWith('.supabase.co') || connection.hostname.endsWith('.supabase.com')) {
  if (!connection.searchParams.has('sslmode')) connection.searchParams.set('sslmode', 'require');
  // Preserve libpq's encrypted `require` behavior with pg v8. Newer Node/pg
  // combinations otherwise treat it as verify-full, which rejects the
  // Supabase pooler's certificate chain on some Windows installations.
  if (!connection.searchParams.has('uselibpqcompat')) connection.searchParams.set('uselibpqcompat', 'true');
}

export const pool = new Pool({ connectionString: connection.toString() });

export async function initializeDatabase() {
  const schema = await readFile(resolve(process.cwd(), 'src/server/schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const directory = resolve(process.cwd(), 'migrations');
  const files = (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (applied.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile(resolve(directory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
