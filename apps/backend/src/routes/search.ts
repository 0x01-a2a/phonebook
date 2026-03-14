import type { FastifyInstance } from 'fastify';
import { agents } from '@phonebook/database';
import { db } from '@phonebook/database';
import { like, or, desc, sql } from '@phonebook/database';

export async function searchRouter(fastify: FastifyInstance) {
  // Full-text search using PostgreSQL
  fastify.get('/', async (request) => {
    const { q, category, minReputation, limit = '20', offset = '0' } = request.query as Record<string, string>;

    if (!q || q.length < 2) {
      return { results: [], total: 0 };
    }

    // Build search query using PostgreSQL full-text search
    const searchTerms = q.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    
    let query = db.select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      categories: agents.categories,
      whatsappDisplay: agents.whatsappDisplay,
      status: agents.status,
      reputationScore: agents.reputationScore,
      pixelBannerGif: agents.pixelBannerGif,
      verified: agents.verified,
      featured: agents.featured,
    })
      .from(agents)
      .$dynamic();

    // Escape LIKE wildcards (% and _) to prevent unintended matching
    const escapeLike = (s: string) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const safeQ = escapeLike(q);
    const nameMatch = like(agents.name, `%${safeQ}%`);
    const descMatch = like(agents.description, `%${safeQ}%`);
    
    // For categories, we need to use a different approach
    const conditions = [or(nameMatch, descMatch)];

    if (category) {
      conditions.push(sql`${agents.categories} @> ${JSON.stringify([category])}`);
    }

    if (minReputation) {
      conditions.push(sql`${agents.reputationScore} >= ${parseFloat(minReputation)}`);
    }

    const results = await query
      .where(or(...conditions))
      .orderBy(desc(agents.reputationScore), desc(agents.featured))
      .limit(parseInt(limit, 10))
      .offset(parseInt(offset, 10));

    // Get total count for pagination
    const countResult = await db.select({ count: sql<number>`count(*)::int` })
      .from(agents)
      .where(or(...conditions));

    return {
      results,
      total: countResult[0].count,
      query: q,
    };
  });

  // Natural language search
  fastify.get('/natural', async (request) => {
    const { q } = request.query as { q: string };

    if (!q) {
      return { results: [], message: 'Please provide a search query' };
    }

    // Parse natural language query
    // Examples: "find agent who can analyze PDF and has 4.5+ reputation"
    const minReputationMatch = q.match(/(\d+\.?\d*)\+?\s*reputation/i);
    const minReputation = minReputationMatch ? parseFloat(minReputationMatch[1]) : null;

    // Extract potential category keywords
    const categoryKeywords: Record<string, string[]> = {
      developer: ['developer', 'code', 'coding', 'programming', 'developer'],
      research: ['research', 'researcher', 'analyze', 'analysis', 'analyzing'],
      creative: ['creative', 'design', 'designing', 'creative'],
      finance: ['finance', 'financial', 'trading', 'invest'],
      ops: ['ops', 'operations', 'automation', 'workflow'],
    };

    let matchedCategory: string | null = null;
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => q.toLowerCase().includes(keyword))) {
        matchedCategory = category;
        break;
      }
    }

    // Build query
    const conditions: any[] = [];
    
    // Remove keywords from query for text search
    let searchText = q.toLowerCase();
    for (const keywords of Object.values(categoryKeywords)) {
      for (const keyword of keywords) {
        searchText = searchText.replace(new RegExp(keyword, 'gi'), '');
      }
    }
    searchText = searchText.replace(/\d+\.?\d*\+?\s*reputation/gi, '').trim();

    if (searchText.length >= 2) {
      const escapeLike = (s: string) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const safeSearch = escapeLike(searchText);
      const nameMatch = like(agents.name, `%${safeSearch}%`);
      const descMatch = like(agents.description, `%${safeSearch}%`);
      conditions.push(or(nameMatch, descMatch));
    }

    if (matchedCategory) {
      conditions.push(sql`${agents.categories} @> ${JSON.stringify([matchedCategory])}`);
    }

    if (minReputation) {
      conditions.push(sql`${agents.reputationScore} >= ${minReputation}`);
    }

    const results = conditions.length > 0
      ? await db.select({
          id: agents.id,
          name: agents.name,
          description: agents.description,
          categories: agents.categories,
          whatsappDisplay: agents.whatsappDisplay,
          status: agents.status,
          reputationScore: agents.reputationScore,
          pixelBannerGif: agents.pixelBannerGif,
          verified: agents.verified,
        })
          .from(agents)
          .where(or(...conditions))
          .orderBy(desc(agents.reputationScore))
          .limit(20)
      : await db.select({
          id: agents.id,
          name: agents.name,
          description: agents.description,
          categories: agents.categories,
          whatsappDisplay: agents.whatsappDisplay,
          status: agents.status,
          reputationScore: agents.reputationScore,
          pixelBannerGif: agents.pixelBannerGif,
          verified: agents.verified,
        })
          .from(agents)
          .orderBy(desc(agents.reputationScore))
          .limit(20);

    return {
      results,
      parsedQuery: {
        searchText: searchText || null,
        category: matchedCategory,
        minReputation,
      },
    };
  });

  // Category suggestions
  fastify.get('/categories', async () => {
    // Get unique categories from all agents
    const result = await db.select({ categories: agents.categories })
      .from(agents);

    const categoryCount: Record<string, number> = {};
    for (const row of result) {
      if (row.categories && Array.isArray(row.categories)) {
        for (const cat of row.categories) {
          categoryCount[cat] = (categoryCount[cat] || 0) + 1;
        }
      }
    }

    // Return sorted by count
    const sorted = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    return { categories: sorted };
  });
}
