import { db, schema } from '@phonebook/database';
import { v4 as uuid } from 'uuid';

const seedData = async () => {
  console.log('Seeding database...');

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

  // Create sample agents
  const agents = [
    {
      id: uuid(),
      name: 'OpenClaw Research',
      description: 'Agent AI do analizy dokumentów i badań rynkowych. Specjalizuje się w przetwarzaniu PDF i ekstrakcji insightów.',
      categories: ['research', 'developer'],
      whatsappNumber: '+48123456789',
      whatsappDisplay: 'Kontakt: Research Team',
      status: 'online',
      reputationScore: 8.5,
      trustScore: 1.2,
      verified: true,
      featured: true,
    },
    {
      id: uuid(),
      name: 'CodeAssist Pro',
      description: 'Agent programistyczny specjalizujący się w refaktoryzacji i optymalizacji kodu. Wspiera Python, TypeScript i Rust.',
      categories: ['developer'],
      whatsappNumber: '+48123456790',
      whatsappDisplay: 'Kontakt: Dev Team',
      status: 'online',
      reputationScore: 7.8,
      trustScore: 1.1,
      verified: true,
      featured: false,
    },
    {
      id: uuid(),
      name: 'ContentWriter AI',
      description: 'Agent do tworzenia treści marketingowych i blogowych. Natural language generation w 32 językach.',
      categories: ['creative'],
      whatsappNumber: '+48123456791',
      whatsappDisplay: 'Kontakt: Content',
      status: 'offline',
      reputationScore: 7.2,
      trustScore: 0.9,
      verified: false,
      featured: false,
    },
    {
      id: uuid(),
      name: 'FinanceBot',
      description: 'Agent analizujący dane finansowe i generujący raporty inwestycyjne. Integracja z Bloomberg API.',
      categories: ['finance'],
      whatsappNumber: '+48123456792',
      whatsappDisplay: 'Kontakt: Finance',
      status: 'busy',
      reputationScore: 9.1,
      trustScore: 1.5,
      verified: true,
      featured: true,
    },
    {
      id: uuid(),
      name: 'AutomationHub',
      description: 'Agent do automatyzacji workflow i integracji API. Tworzy pipeline CI/CD i skrypty DevOps.',
      categories: ['ops', 'developer'],
      whatsappNumber: '+48123456793',
      whatsappDisplay: 'Kontakt: Ops Team',
      status: 'online',
      reputationScore: 6.9,
      trustScore: 0.8,
      verified: true,
      featured: false,
    },
  ];

  for (const agent of agents) {
    await db.insert(schema.agents).values(agent).onConflictDoNothing();
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
