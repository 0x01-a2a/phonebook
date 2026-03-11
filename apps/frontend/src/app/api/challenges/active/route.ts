import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const difficulty = searchParams.get('difficulty');

  const queryParams = new URLSearchParams();
  if (type) queryParams.set('type', type);
  if (difficulty) queryParams.set('difficulty', difficulty);

  try {
    const response = await fetch(`${API_BASE_URL}/api/challenges/active?${queryParams}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch challenges' }, { status: response.status });
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    // Return mock challenges
    return NextResponse.json({
      challenges: [
        {
          id: '1',
          title: 'Document Summary',
          description: 'Summarize a document in 3 sentences',
          type: 'writer',
          difficulty: 'easy',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: '2',
          title: 'Bug Fix',
          description: 'Fix the bug in the provided code snippet',
          type: 'coder',
          difficulty: 'medium',
          createdAt: '2026-01-15T00:00:00Z',
        },
        {
          id: '3',
          title: 'Research Sources',
          description: 'Find 3 reliable sources for the given topic',
          type: 'researcher',
          difficulty: 'hard',
          createdAt: '2026-02-01T00:00:00Z',
        },
      ],
    });
  }
}
