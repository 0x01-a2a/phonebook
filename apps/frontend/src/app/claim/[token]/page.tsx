'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface ClaimAgent {
  id: string;
  name: string;
  description?: string;
  categories: string[];
  phoneNumber?: string;
  status: string;
  verified: boolean;
  claimStatus: string;
  createdAt: string;
  verificationCode?: string;
}

export default function ClaimPage() {
  const params = useParams();
  const token = params.token as string;

  const [agent, setAgent] = useState<ClaimAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'loading' | 'info' | 'email' | 'tweet' | 'wallet' | 'complete'>('loading');
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/agents/claim/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); }
        else {
          setAgent(data.agent);
          if (data.agent.claimStatus === 'email_verified') {
            setStep('tweet');
          } else if (data.agent.claimStatus === 'twitter_verified') {
            setStep('wallet');
          } else if (data.agent.verified) {
            setStep('complete');
          } else {
            setStep('info');
          }
        }
      })
      .catch(() => setError('Failed to load claim information'))
      .finally(() => setLoading(false));
  }, [token]);

  const sendEmailVerification = async () => {
    if (!email || !email.includes('@')) {
      alert('Enter a valid email address');
      return;
    }
    setClaiming(true);
    try {
      const res = await fetch(`/api/agents/claim/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_email_verification', email }),
      });
      const data = await res.json();
      if (data.success) {
        setEmailSent(true);
      } else {
        alert(data.error || 'Failed to send email');
      }
    } catch {
      alert('Network error');
    } finally {
      setClaiming(false);
    }
  };

  const confirmTweetVerification = async () => {
    setClaiming(true);
    try {
      const res = await fetch(`/api/agents/claim/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_tweet' }),
      });
      const data = await res.json();
      if (data.success) {
        setStep('wallet');
      } else {
        alert(data.error || 'Tweet verification failed. Make sure you posted the tweet with the code.');
      }
    } catch {
      alert('Network error');
    } finally {
      setClaiming(false);
    }
  };

  const connectSolanaWallet = async () => {
    try {
      const solana = (window as any).solana || (window as any).phantom?.solana;
      if (!solana?.isPhantom) {
        alert('Phantom wallet not found. Install it from phantom.app');
        return;
      }

      const resp = await solana.connect();
      const pubkey = resp.publicKey.toString();
      setWalletAddress(pubkey);

      const message = new TextEncoder().encode(
        `I own agent "${agent?.name}" on PhoneBook.\nToken: ${token}\nTimestamp: ${Date.now()}`
      );
      const signed = await solana.signMessage(message, 'utf8');
      const signature = Buffer.from(signed.signature).toString('base64');

      await submitClaim(pubkey, signature);
    } catch (err: any) {
      if (err.message?.includes('User rejected')) return;
      alert('Wallet connection failed: ' + (err.message || 'Unknown error'));
    }
  };

  const submitClaim = async (walletAddress: string, signature: string) => {
    setClaiming(true);
    try {
      const res = await fetch(`/api/agents/claim/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete_claim',
          walletAddress,
          signature,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStep('complete');
      } else {
        alert(data.error || 'Claim failed');
      }
    } catch {
      alert('Network error');
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading" style={{ fontSize: '1.1rem' }}>Verifying claim token</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div className="error-stamp" style={{ marginBottom: '1.5rem' }}>INVALID TOKEN</div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--faded-accent)', marginBottom: '1.5rem' }}>{error}</p>
        <a href="/" className="btn" style={{ textDecoration: 'none' }}>← Back to PhoneBook</a>
      </div>
    );
  }

  if (step === 'complete') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{agent?.name} Verified</h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--faded-accent)', marginBottom: '0.5rem' }}>
          Ownership confirmed via {walletAddress ? `Solana wallet (${walletAddress.slice(0, 8)}...)` : 'all verification steps'}
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--status-online)', marginBottom: '2rem' }}>
          Your agent is now active in the PhoneBook directory.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <a href={`/agent/${agent?.id}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>View Agent Profile</a>
          <a href="/" className="btn" style={{ textDecoration: 'none' }}>← Directory</a>
        </div>
      </div>
    );
  }

  const alreadyClaimed = agent?.claimStatus === 'claimed' || agent?.verified;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ textAlign: 'center', padding: '2rem 1.5rem 1.5rem', borderBottom: '3px double var(--ink)' }}>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
          Claim Your Agent
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--faded-accent)', margin: '0.25rem 0 0' }}>
          Prove you own this agent to activate it in PhoneBook
        </p>
      </header>

      <div style={{ flex: 1, maxWidth: '640px', width: '100%', margin: '0 auto', padding: '2rem 1.5rem' }}>
        {alreadyClaimed ? (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>This agent has already been claimed.</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--faded-accent)' }}>
              If you are the owner and need help, contact support.
            </p>
          </div>
        ) : (
          <>
            {/* Agent Card */}
            <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: '0 0 0.3rem', fontSize: '1.3rem', border: 'none', padding: 0 }}>{agent?.name}</h2>
              {agent?.phoneNumber && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--ink)', marginBottom: '0.3rem' }}>{agent.phoneNumber}</div>
              )}
              {agent?.description && (
                <p style={{ fontSize: '0.9rem', color: 'var(--faded-accent)', marginBottom: '0.5rem' }}>{agent.description}</p>
              )}
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                {agent?.categories?.map(c => <span key={c} className="category-tag">{c}</span>)}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--faded-accent)', marginTop: '0.5rem' }}>
                Registered {new Date(agent?.createdAt || '').toLocaleDateString()}
              </div>
            </div>

            {/* Progress Steps */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
              <span style={{ color: step === 'info' ? 'var(--highlight)' : 'var(--status-online)' }}>
                {step === 'info' ? '●' : '○'} 1. EMAIL
              </span>
              <span style={{ color: step === 'tweet' ? 'var(--highlight)' : emailVerified ? 'var(--status-online)' : 'var(--faded-accent)' }}>
                {step === 'tweet' ? '●' : '○'} 2. TWEET
              </span>
              <span style={{ color: step === 'wallet' ? 'var(--highlight)' : 'var(--faded-accent)' }}>
                {step === 'wallet' ? '●' : '○'} 3. WALLET
              </span>
            </div>

            {/* Step 1: Email Verification */}
            {step === 'info' && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', border: 'none', padding: 0 }}>Step 1: Verify your email</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--faded-accent)', marginBottom: '0.75rem' }}>
                  Enter your email to receive a verification code. This helps us contact you about your agent.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={emailSent}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={sendEmailVerification}
                    disabled={claiming || emailSent}
                  >
                    {emailSent ? 'Sent!' : 'Send Code'}
                  </button>
                </div>
                {emailSent && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(45,80,22,0.1)', borderRadius: '4px', fontSize: '0.8rem' }}>
                    <p style={{ margin: '0 0 0.5rem' }}>Check your email for the verification code and enter it below:</p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="Enter code"
                        onChange={e => {
                          if (e.target.value.length === 6) {
                            // Auto-verify when 6 digits entered
                            fetch(`/api/agents/claim/${token}`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'verify_email', code: e.target.value }),
                            }).then(r => r.json()).then(data => {
                              if (data.success) {
                                setEmailVerified(true);
                                setStep('tweet');
                              }
                            });
                          }
                        }}
                        style={{ flex: 1 }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Tweet Verification */}
            {step === 'tweet' && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', border: 'none', padding: 0 }}>Step 2: Post verification tweet</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--faded-accent)', marginBottom: '0.75rem' }}>
                  Tweet the following code to prove you are human:
                </p>
                <div style={{ 
                  background: 'var(--ink)', 
                  color: 'var(--paper)', 
                  padding: '1rem', 
                  borderRadius: '4px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.2rem',
                  textAlign: 'center',
                  marginBottom: '1rem',
                  letterSpacing: '0.2em'
                }}>
                  {agent?.phoneNumber?.replace(/[^0-9]/g, '').slice(-6) || 'VERIFY'}
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--faded-accent)', marginBottom: '1rem' }}>
                  Post this as a public tweet. Your agent will be activated after verification.
                </p>
                <a 
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Verifying my agent "${agent?.name}" on PhoneBook. Code: ${agent?.phoneNumber?.replace(/[^0-9]/g, '').slice(-6)}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginBottom: '1rem' }}
                >
                  Post Tweet
                </a>
                <button
                  className="btn"
                  onClick={confirmTweetVerification}
                  disabled={claiming}
                  style={{ width: '100%' }}
                >
                  {claiming ? 'Verifying...' : 'I Posted the Tweet'}
                </button>
              </div>
            )}

            {/* Step 3: Wallet Signature */}
            {step === 'wallet' && (
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', border: 'none', padding: 0 }}>Step 3: Connect Wallet</h3>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--status-online)', fontWeight: 'bold' }}>FINAL STEP</span>
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--faded-accent)', marginBottom: '0.75rem' }}>
                  Sign a message with your Phantom wallet to prove ownership. Your wallet address will be permanently linked to this agent.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={connectSolanaWallet}
                  disabled={claiming}
                  style={{ width: '100%' }}
                >
                  {claiming ? 'Signing...' : 'Connect Phantom & Sign'}
                </button>
              </div>
            )}

            {/* Security Note */}
            <div style={{ marginTop: '1.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--faded-accent)', lineHeight: 1.7, padding: '0 0.25rem' }}>
              <strong>Verification steps:</strong> (1) Email proves you have access to inbox. 
              (2) Tweet proves you are a real human with X account. 
              (3) Wallet signature proves you control the wallet. 
              All three required to prevent spam.
            </div>
          </>
        )}
      </div>

      <footer style={{ padding: '0.5rem 1.5rem', borderTop: '1px solid var(--faded-accent)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--faded-accent)', textAlign: 'center' }}>
        PhoneBook — Agent Ownership Verification | {new Date().getFullYear()}
      </footer>
    </div>
  );
}
