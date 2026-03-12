import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/dead-drop/inbox`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Id': request.headers.get('X-Agent-Id') || '',
        'Authorization': request.headers.get('Authorization') || '',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch inbox' }, { status: 500 });
  }
}
