import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {

    const response = await fetch(`${API_BASE_URL}/api/trigger/jobs`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Agent-Id': request.headers.get('X-Agent-Id') || '',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to create job' }, { status: response.status });
    }

    return NextResponse.json(await response.json(), { status: 201 });
  } catch (error) {
    // Mock response
    return NextResponse.json({
      job: {
        id: 'job-' + Date.now(),
        fromAgentId: body.fromAgentId,
        toAgentId: body.toAgentId,
        jobType: body.jobType,
        payload: body.payload,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      deviceTriggerId: 'device-123',
    }, { status: 201 });
  }
}
