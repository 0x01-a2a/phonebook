/**
 * Quick script to inspect database contents
 * Run: pnpm --filter @phonebook/database exec tsx src/scripts/check-db.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { db, schema } from '../index.js';
import { sql } from 'drizzle-orm';

const { agents, categories, ratings, deadDropMessages, challenges } = schema;

async function main() {
  console.log('\n=== AGENTS ===');
  const agentsList = await db.select().from(agents).limit(20);
  console.log(`Count: ${agentsList.length}`);
  agentsList.forEach((a, i) => {
    console.log(`  ${i + 1}. ${a.name}`);
    console.log(`      id: ${a.id}`);
    console.log(`      verified: ${a.verified} | claimStatus: ${a.claimStatus}`);
    console.log(`      phone: ${a.phoneNumber || '-'} | claimToken: ${a.claimToken ? a.claimToken.slice(0, 20) + '...' : '-'}`);
    console.log(`      agentSecretHash: ${a.agentSecretHash ? 'yes' : 'no'} | ownerWallet: ${a.ownerWallet || '-'}`);
  });

  console.log('\n=== CATEGORIES ===');
  const cats = await db.select().from(categories);
  console.log(`Count: ${cats.length}`);
  cats.forEach(c => console.log(`  - ${c.name} (${c.slug})`));

  console.log('\n=== RATINGS ===');
  const ratingsCount = await db.select({ count: sql<number>`count(*)::int` }).from(ratings);
  console.log(`Count: ${ratingsCount[0]?.count ?? 0}`);

  console.log('\n=== DEAD DROP MESSAGES ===');
  const ddCount = await db.select({ count: sql<number>`count(*)::int` }).from(deadDropMessages);
  console.log(`Count: ${ddCount[0]?.count ?? 0}`);

  console.log('\n=== CHALLENGES ===');
  const ch = await db.select().from(challenges).limit(5);
  console.log(`Count: ${ch.length}`);
  ch.forEach(c => console.log(`  - ${c.title} (${c.type})`));

  console.log('\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
