/**
 * Verify Solana/Ed25519 signature for wallet-based claim.
 * Message format must match exactly what the frontend signs.
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const CLAIM_MESSAGE_PREFIX = 'Claim agent ';
const CLAIM_MESSAGE_SUFFIX = ' for 0x01 PhoneBook';

/**
 * Build the exact message the user must sign.
 * Frontend must use this exact string.
 */
export function buildClaimMessage(agentId: string): string {
  return CLAIM_MESSAGE_PREFIX + agentId + CLAIM_MESSAGE_SUFFIX;
}

/**
 * Verify that the signature was produced by the given wallet address
 * for the claim message of this agent.
 */
export function verifySolanaClaimSignature(
  walletAddress: string,
  signatureBase64: string,
  agentId: string
): boolean {
  try {
    const publicKey = bs58.decode(walletAddress);
    if (publicKey.length !== 32) return false;

    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.length !== 64) return false;

    const message = new TextEncoder().encode(buildClaimMessage(agentId));
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}
