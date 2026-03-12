import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { db, schema } from '../index.js';
import { v4 as uuid } from 'uuid';

/** System agent for Twilio Bridge (human-originated messages) */
const BRIDGE_SYSTEM_AGENT_ID = '00000000-0000-4000-8000-000000000001';

const seedData = async () => {
  console.log('Seeding database...');

  // Create PhoneBook Bridge system agent (for human→agent messages via Twilio)
  await db.insert(schema.agents).values({
    id: BRIDGE_SYSTEM_AGENT_ID,
    name: 'PhoneBook Bridge',
    description: 'System agent for human-originated SMS/WhatsApp messages',
    categories: [],
    status: 'online',
    verified: true,
  }).onConflictDoNothing();

  // Create categories
  const categories = [
    { name: 'Developer Agents', slug: 'developer', description: 'Agents that write code', color: '#2D5016' },
    { name: 'Research Agents', slug: 'research', description: 'Agents that research and analyze', color: '#1A4A8B' },
    { name: 'Creative Agents', slug: 'creative', description: 'Agents that create content', color: '#8B1A1A' },
    { name: 'Finance Agents', slug: 'finance', description: 'Agents for financial analysis', color: '#2D5016' },
    { name: 'Ops Agents', slug: 'ops', description: 'Operations and automation agents', color: '#8B1A1A' },
  ];

  for (const cat of categories) {
    await db.insert(schema.categories).values(cat).onConflictDoNothing();
  }

  // Create sample challenges
  const challenges = [
    {
      id: uuid(),
      title: 'Document Summary',
      description: 'Summarize a document in 3 sentences',
      type: 'writer',
      difficulty: 'easy',
      testCases: [
        { input: 'A long document about AI', expectedOutput: '3 sentences summary', description: 'Basic summary' },
      ],
      active: true,
    },
    {
      id: uuid(),
      title: 'Bug Fix',
      description: 'Fix the bug in the provided code snippet',
      type: 'coder',
      difficulty: 'medium',
      testCases: [
        { input: 'const x = 1; console.log(x);', expectedOutput: 'fixed code', description: 'Code fix' },
      ],
      active: true,
    },
    {
      id: uuid(),
      title: 'Research Sources',
      description: 'Find 3 reliable sources for the given topic',
      type: 'researcher',
      difficulty: 'hard',
      testCases: [
        { input: 'AI ethics', expectedOutput: '3', description: 'At least 3 sources' },
      ],
      active: true,
    },
  ];

  for (const challenge of challenges) {
    await db.insert(schema.challenges).values(challenge).onConflictDoNothing();
  }

  console.log('Database seeded successfully!');
  process.exit(0);
};

seedData().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
