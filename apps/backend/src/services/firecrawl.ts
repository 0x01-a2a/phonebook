/**
 * Firecrawl Service — web search for broadcast content
 *
 * Uses Firecrawl search API to gather news and sources
 * that agents use to generate broadcast scripts.
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v2/search';

export interface FirecrawlSearchResult {
  url: string;
  title: string;
  description: string; // 'web' source
  snippet?: string;    // 'news' source uses snippet instead of description
  markdown?: string;
}

export interface SearchOptions {
  sources?: string[];
  tbs?: string; // time-based search (e.g. 'qdr:d' for past day)
  limit?: number;
}

let callsThisMinute = 0;
let minuteStart = Date.now();

function checkRateLimit() {
  const now = Date.now();
  if (now - minuteStart > 60_000) {
    callsThisMinute = 0;
    minuteStart = now;
  }
  if (callsThisMinute >= 10) {
    throw new Error('[Firecrawl] Rate limit: max 10 calls/min');
  }
  callsThisMinute++;
}

/**
 * Search the web for a single query.
 */
export async function search(
  query: string,
  options: SearchOptions = {},
): Promise<FirecrawlSearchResult[]> {
  if (!FIRECRAWL_API_KEY) {
    console.warn('[Firecrawl] API key not configured');
    return [];
  }

  checkRateLimit();

  const body: Record<string, unknown> = {
    query,
    limit: options.limit || 5,
    sources: ['web', 'news'],
  };

  if (options.tbs) body.tbs = options.tbs;
  if (options.sources) body.sources = options.sources;

  try {
    const res = await fetch(FIRECRAWL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[Firecrawl] Error:', res.status, text);
      return [];
    }

    const json = await res.json() as {
      success: boolean;
      data?: FirecrawlSearchResult[] | { web?: FirecrawlSearchResult[]; news?: FirecrawlSearchResult[] };
    };

    // v2 API returns { data: { web: [...], news: [...] } } or { data: [...] } with scrapeOptions
    if (json.data) {
      if (Array.isArray(json.data)) return json.data;
      const nested = json.data as { web?: FirecrawlSearchResult[]; news?: FirecrawlSearchResult[] };
      return [...(nested.web || []), ...(nested.news || [])];
    }
    return [];
  } catch (error) {
    console.error('[Firecrawl] Search error:', error);
    return [];
  }
}

/**
 * Scrape a single URL and return its full content as markdown.
 */
export async function scrape(
  url: string,
  options: { onlyMainContent?: boolean; maxLength?: number } = {},
): Promise<{ url: string; title: string; markdown: string } | null> {
  if (!FIRECRAWL_API_KEY) {
    console.warn('[Firecrawl] API key not configured');
    return null;
  }

  checkRateLimit();

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: options.onlyMainContent ?? true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[Firecrawl] Scrape error:', res.status, text);
      return null;
    }

    const json = await res.json() as {
      success: boolean;
      data?: { url?: string; title?: string; markdown?: string };
    };

    if (!json.success || !json.data?.markdown) return null;

    let markdown = json.data.markdown;
    const maxLen = options.maxLength || 4000;
    if (markdown.length > maxLen) {
      markdown = markdown.slice(0, maxLen) + '\n\n[...truncated]';
    }

    return {
      url: json.data.url || url,
      title: json.data.title || url,
      markdown,
    };
  } catch (error) {
    console.error('[Firecrawl] Scrape error:', error);
    return null;
  }
}

/**
 * Run multiple queries and deduplicate results by URL.
 */
export async function searchMultiple(
  queries: string[],
  options: SearchOptions = {},
): Promise<FirecrawlSearchResult[]> {
  const allResults: FirecrawlSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const query of queries) {
    const results = await search(query, options);
    for (const r of results) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        allResults.push(r);
      }
    }
  }

  return allResults;
}

const TOPIC_QUERIES: Record<string, (desc?: string) => string[]> = {
  sport: (desc) => [
    'breaking sports news today',
    'Champions League latest results',
    desc ? `${desc} sports update` : 'football transfer news today',
  ],
  geopolitics: (desc) => [
    'world politics breaking news today',
    'international relations latest developments',
    desc ? `${desc} geopolitics` : 'geopolitical tensions latest',
  ],
  tech: (desc) => [
    'technology news today startups',
    'latest tech product launches',
    desc ? `${desc} tech news` : 'Silicon Valley latest news',
  ],
  crypto: (desc) => [
    'cryptocurrency market news today',
    'Bitcoin Ethereum latest price analysis',
    desc ? `${desc} crypto update` : 'DeFi Web3 latest developments',
  ],
  ai: (desc) => [
    'artificial intelligence news today',
    'AI latest breakthroughs research',
    desc ? `${desc} AI update` : 'LLM machine learning latest',
  ],
};

/**
 * Build search queries for a topic, optionally personalized by agent description.
 */
export function buildQueriesForTopic(topicSlug: string, agentDescription?: string): string[] {
  const builder = TOPIC_QUERIES[topicSlug];
  if (builder) return builder(agentDescription);
  return [`${topicSlug} latest news today`, `${topicSlug} breaking developments`];
}
