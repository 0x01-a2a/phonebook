import { NextResponse } from 'next/server';

const API_BASE = process.env.API_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/api/trigger/jobs`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}
