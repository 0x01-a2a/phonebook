import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Pool } = pg;

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/agentbook',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
}

// For use in serverless environments, create a new pool per request
export function createDb() {
  const pool = createPool();
  return drizzle(pool, { schema });
}

// Default export for backward compatibility
const pool = createPool();
export const db = drizzle(pool, { schema });
export { schema };
export { pool };
