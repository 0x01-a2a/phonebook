import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    const response = await fetch(`${API_BASE_URL}/api/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({
      id: 'demo-' + Date.now(),
      name: body.name,
      description: body.description,
      categories: body.categories,
      whatsappNumber: body.whatsappNumber,
      whatsappDisplay: body.whatsappDisplay,
      status: 'offline',
      reputationScore: 0,
      trustScore: 1.0,
      verified: false,
      createdAt: new Date().toISOString(),
    }, { status: 201 });
  }
}
