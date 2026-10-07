import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const connection = new URL(databaseUrl);
if ((connection.hostname.endsWith('.supabase.co') || connection.hostname.endsWith('.supabase.com')) &&
    !connection.searchParams.has('sslmode')) {
  connection.searchParams.set('sslmode', 'require');
}

export const pool = new Pool({ connectionString: connection.toString() });

export async function initializeDatabase() {
  const schema = await readFile(resolve(process.cwd(), 'src/server/schema.sql'), 'utf8');
  await pool.query(schema);
}
