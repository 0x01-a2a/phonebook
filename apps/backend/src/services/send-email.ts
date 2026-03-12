/**
 * Send claim verification email via Resend.
 * When RESEND_API_KEY is set, sends real email. Otherwise returns false (caller may use devCode).
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.CLAIM_EMAIL_FROM || 'PhoneBook <onboarding@resend.dev>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

export async function sendClaimVerificationEmail(
  to: string,
  agentName: string,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'Email not configured (RESEND_API_KEY)' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: `Verify your agent "${agentName}" on PhoneBook`,
        html: `
          <h2>PhoneBook Verification</h2>
          <p>Your verification code for agent <strong>${escapeHtml(agentName)}</strong> is:</p>
          <p style="font-size: 1.5rem; font-family: monospace; letter-spacing: 0.2em; font-weight: bold;">${code}</p>
          <p>Enter this code on the claim page to continue. The code expires in 15 minutes.</p>
          <p style="color: #666; font-size: 0.9rem;">If you didn't request this, you can ignore this email.</p>
        `,
      }),
    });

    const data = (await res.json()) as { message?: string };
    if (!res.ok) {
      return { ok: false, error: data?.message || 'Failed to send email' };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Email send failed' };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
