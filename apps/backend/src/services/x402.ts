/**
 * X402 Micropayments Service
 * 
 * X402 is HTTP 402 Payment Required protocol for micropayments
 * https://docs.x402.org/
 */

import { randomBytes } from 'crypto';

interface PaymentRequest {
  amount: string;
  token: string;
  recipient: string;
  chain: 'base' | 'ethereum' | 'polygon' | 'solana';
  metadata?: Record<string, any>;
}

interface PaymentResponse {
  paymentId: string;
  status: 'pending' | 'completed' | 'failed';
  transactionHash?: string;
  confirmedAt?: Date;
}

// Platform wallet (configurable via env)
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';
const PLATFORM_FEE_PERCENT = 5;

/**
 * Create a payment request for X402 protocol
 */
export function createPaymentRequest(
  amount: string,
  recipient: string,
  chain: 'base' | 'ethereum' | 'polygon' | 'solana' = 'base',
  metadata?: Record<string, any>
): PaymentRequest {
  return {
    amount,
    token: 'USDC',
    recipient,
    chain,
    metadata,
  };
}

/**
 * Generate X402 headers for payment
 */
export function getX402Headers(paymentRequest: PaymentRequest): Record<string, string> {
  return {
    'X-Payment-Required': '402',
    'X-Payment-Amount': paymentRequest.amount,
    'X-Payment-Token': paymentRequest.token,
    'X-Payment-Recipient': paymentRequest.recipient,
    'X-Payment-Chain': paymentRequest.chain,
    'X-Payment-Id': randomBytes(16).toString('hex'),
  };
}

/**
 * Calculate platform fee
 */
export function calculatePlatformFee(amount: string): string {
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount)) return '0';
  return (numAmount * (PLATFORM_FEE_PERCENT / 100)).toFixed(6);
}

/**
 * Verify payment status (would integrate with actual blockchain)
 */
export async function verifyPayment(paymentId: string): Promise<PaymentResponse> {
  // In production, this would query the blockchain/Coinbase CDP
  // For now, return mock response
  return {
    paymentId,
    status: 'completed',
    transactionHash: '0x' + randomBytes(32).toString('hex'),
    confirmedAt: new Date(),
  };
}

/**
 * Parse X402 response headers
 */
export function parseX402Response(headers: Record<string, string>): {
  required: boolean;
  amount?: string;
  token?: string;
  recipient?: string;
  paymentId?: string;
} {
  const required = headers['x-payment-required'] === '402' || 
                   headers['payment'] === 'required' ||
                   parseInt(headers['x-payment-required'] || '0') === 402;

  return {
    required,
    amount: headers['x-payment-amount'],
    token: headers['x-payment-token'],
    recipient: headers['x-payment-recipient'],
    paymentId: headers['x-payment-id'],
  };
}

/**
 * Middleware for X402 payment verification
 */
export async function verifyX402Payment(
  paymentId: string,
  expectedAmount: string
): Promise<boolean> {
  const payment = await verifyPayment(paymentId);
  
  if (payment.status !== 'completed') {
    return false;
  }

  // In production, verify amount matches
  return true;
}
