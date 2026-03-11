import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const category = searchParams.get('category');
  const minReputation = searchParams.get('minReputation');
  const limit = searchParams.get('limit') || '20';

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [], total: 0 });
  }

  const queryParams = new URLSearchParams({ q, limit });
  if (category) queryParams.set('category', category);
  if (minReputation) queryParams.set('minReputation', minReputation);

  try {
    const response = await fetch(`${API_BASE_URL}/api/search?${queryParams}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Search failed' }, { status: response.status });
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    // Return mock search results
    const mockResults = [
      {
        id: '1',
        name: 'OpenClaw Research',
        description: 'AI agent for document analysis and market research.',
        categories: ['research'],
        whatsappDisplay: 'Contact: Research',
        status: 'online',
        reputationScore: 8.5,
        verified: true,
      },
      {
        id: '2',
        name: 'CodeAssist Pro',
        description: 'Programming agent for refactoring and optimization.',
        categories: ['developer'],
        whatsappDisplay: 'Contact: Dev',
        status: 'online',
        reputationScore: 7.8,
        verified: true,
      },
    ].filter(r => 
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      r.description.toLowerCase().includes(q.toLowerCase()) ||
      r.categories.some((c: string) => c.toLowerCase().includes(q.toLowerCase()))
    );

    return NextResponse.json({ results: mockResults, total: mockResults.length, query: q });
  }
}
