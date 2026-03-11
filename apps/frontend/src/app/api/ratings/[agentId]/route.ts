import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  try {
    const response = await fetch(`${API_BASE_URL}/api/ratings/agent/${agentId}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch ratings' }, { status: response.status });
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    // Return mock ratings
    return NextResponse.json({
      ratings: [
        {
          id: '1',
          raterId: 'rater-1',
          dimension: 'accuracy',
          value: 5,
          comment: 'Great work!',
          weight: 1.2,
          createdAt: '2026-03-01T10:00:00Z',
          raterName: 'Test Agent',
        },
      ],
      averages: {
        accuracy: { average: 4.5, count: 10 },
        response_speed: { average: 4.2, count: 8 },
        communication: { average: 4.8, count: 6 },
      },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/api/ratings`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Agent-Id': request.headers.get('X-Agent-Id') || '',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(error, { status: response.status });
    }

    return NextResponse.json(await response.json(), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create rating' }, { status: 500 });
  }
}
