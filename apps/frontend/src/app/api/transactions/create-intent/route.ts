import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {

    const response = await fetch(`${API_BASE_URL}/api/transactions/create-intent`, {
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
    // Return mock payment intent
    return NextResponse.json({
      transactionId: 'tx-' + Date.now(),
      amount: body.amount || '0.001',
      currency: 'USDC',
      platformFee: String(parseFloat(body.amount || '0.001') * 0.05),
      paymentAddress: '0x0000000000000000000000000000000000000000',
      chain: 'base',
      x402: {
        protocol: '402',
        amount: body.amount || '0.001',
        token: 'USDC',
        recipient: '0x0000000000000000000000000000000000000000',
      },
    }, { status: 201 });
  }
}
