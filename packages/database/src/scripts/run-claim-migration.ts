/**
 * Run manual migration for claim email columns.
 * Usage: pnpm --filter @phonebook/database exec tsx src/scripts/run-claim-migration.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const sql = `
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_email_code VARCHAR(10);
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_email_code_expires TIMESTAMP;
`;

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(sql);
    console.log('Migration complete: claim_email_code, claim_email_code_expires');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
