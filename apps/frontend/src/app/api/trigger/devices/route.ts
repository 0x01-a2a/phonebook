import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {

    const response = await fetch(`${API_BASE_URL}/api/trigger/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to register' }, { status: response.status });
    }

    return NextResponse.json(await response.json(), { status: 201 });
  } catch (error) {
    // Mock response for demo
    return NextResponse.json({
      id: 'device-' + Date.now(),
      agentId: body.agentId,
      deviceType: body.deviceType,
      isActive: true,
      registeredAt: new Date().toISOString(),
    }, { status: 201 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json({ error: 'agentId required' }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/trigger/devices/stats/${agentId}`);
    return NextResponse.json(await response.json());
  } catch (error) {
    // Mock response
    return NextResponse.json({
      totalDevices: 2,
      activeDevices: 1,
      byType: { android: 1, ios: 1 },
      lastSeen: new Date().toISOString(),
    });
  }
}
