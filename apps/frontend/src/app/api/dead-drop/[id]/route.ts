import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

function authHeaders(request: NextRequest) {
  return {
    'Content-Type': 'application/json',
    'X-Agent-Id': request.headers.get('X-Agent-Id') || '',
    'Authorization': request.headers.get('Authorization') || '',
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const response = await fetch(`${API_BASE_URL}/api/dead-drop/${id}/read`, {
      method: 'PATCH',
      headers: authHeaders(request),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Failed to mark as read' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const response = await fetch(`${API_BASE_URL}/api/dead-drop/${id}`, {
      method: 'DELETE',
      headers: authHeaders(request),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }
}
