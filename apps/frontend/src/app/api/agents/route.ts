import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';
const FETCH_TIMEOUT_MS = 5000;

const EMPTY_RESPONSE = {
  data: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = searchParams.get('page') || '1';
  const limit = searchParams.get('limit') || '20';
  const category = searchParams.get('category');
  const status = searchParams.get('status');
  const featured = searchParams.get('featured');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const queryParams = new URLSearchParams({ page, limit, sortBy, sortOrder });
  if (category) queryParams.set('category', category);
  if (status) queryParams.set('status', status);
  if (featured) queryParams.set('featured', featured);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api/agents?${queryParams}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch agents' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    clearTimeout(timeout);
    return NextResponse.json(EMPTY_RESPONSE);
  }
}
