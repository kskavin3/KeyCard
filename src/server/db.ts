import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

export const pool = new Pool({ connectionString: databaseUrl });

export async function initializeDatabase() {
  const schema = await readFile(resolve(process.cwd(), 'src/server/schema.sql'), 'utf8');
  await pool.query(schema);
}
