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
}

interface ClaimResponse {
  agent: ClaimAgent;
  messageToSign?: string;
  claimTweetCode?: string;
}

type ClaimMethod = 'select' | 'email' | 'tweet' | 'wallet';

export default function ClaimPage() {
  const params = useParams();
  const token = params.token as string;

  const [agent, setAgent] = useState<ClaimAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [method, setMethod] = useState<ClaimMethod>('select');
  const [complete, setComplete] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [messageToSign, setMessageToSign] = useState('');

  // Email state
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  // Tweet state
  const [claimTweetCode, setClaimTweetCode] = useState('');
  const [tweetUrl, setTweetUrl] = useState('');
  const [tweetReady, setTweetReady] = useState(false);
  const [copied, setCopied] = useState(false);

  // Wallet state
  const [walletAddress, setWalletAddress] = useState('');
  const [completedMethod, setCompletedMethod] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`/api/agents/claim/${token}`)
      .then(r => r.json())
      .then((data: ClaimResponse & { error?: string }) => {
        if (data.error) { setError(data.error); }
        else {
          setAgent(data.agent);
          setMessageToSign(data.messageToSign || '');
          if (data.claimTweetCode) setClaimTweetCode(data.claimTweetCode);
          if (data.agent.verified || data.agent.claimStatus === 'claimed') {
            setComplete(true);
          }
        }
      })
      .catch(() => setError('Failed to load claim information'))
      .finally(() => setLoading(false));
  }, [token]);

  // ─── Email Flow ───
  const sendEmailVerification = async () => {
    if (!email || !email.includes('@')) {
      alert('Enter a valid email address');
      return;
    }
    setClaiming(true);
    setDevCode(null);
    try {
      const res = await fetch(`/api/agents/claim/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_email_verification', email }),
      });
      const data = await res.json();
      if (data.success) {
        setEmailSent(true);
        if (data.devCode) setDevCode(data.devCode);
      } else {
        alert(data.error || 'Failed to send email');
      }
    } catch {
      alert('Network error');
    } finally {
      setClaiming(false);
    }
  };

  const verifyEmailCode = async (code: string) => {
    if (code.length !== 6) return;
    try {
      const res = await fetch(`/api/agents/claim/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_email', code }),
      });
      const data = await res.json();
      if (data.success) {
        // Now finalize via email method
        const claimRes = await fetch(`/api/agents/claim/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'email', email }),
        });
        const claimData = await claimRes.json();
        if (claimData.success) {
          setCompletedMethod('email');
          setComplete(true);
        }
      } else {
        alert(data.error || 'Invalid code');
      }
    } catch {
      alert('Network error');
    }
  };

  // ─── Tweet Flow ───
  const initTweet = async () => {
    setClaiming(true);
    try {
      const res = await fetch(`/api/agents/claim/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'init_tweet' }),
      });
      const data = await res.json();
      if (data.success && data.claimTweetCode) {
        setClaimTweetCode(data.claimTweetCode);
        setTweetReady(true);
      } else {
        alert(data.error || 'Failed to initialize tweet verification');
      }
    } catch {
      alert('Network error');
    } finally {
      setClaiming(false);
    }
  };

  const confirmTweet = async () => {
    setClaiming(true);
    try {
      const res = await fetch(`/api/agents/claim/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify_tweet',
          finalize: true,
          ...(tweetUrl.trim() && { tweetUrl: tweetUrl.trim() }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCompletedMethod('tweet');
        setComplete(true);
      } else {
        alert(data.error || 'Tweet verification failed');
      }
    } catch {
      alert('Network error');
    } finally {
      setClaiming(false);
    }
  };

  // ─── Wallet Flow ───
  const connectSolanaWallet = async () => {
    try {
      const solana = (window as any).solana || (window as any).phantom?.solana;
      if (!solana?.isPhantom) {
        alert('Phantom wallet not found. Install it from phantom.app');
        return;
      }

      setClaiming(true);
      const resp = await solana.connect();
      const pubkey = resp.publicKey.toString();
      setWalletAddress(pubkey);

      const msg = messageToSign || `Claim agent ${agent?.id} for 0x01 PhoneBook`;
      const message = new TextEncoder().encode(msg);
      const signed = await solana.signMessage(message, 'utf8');

      // Convert signature to base64 safely (browser-compatible)
      const sigBytes = new Uint8Array(signed.signature);
      let binary = '';
      for (let i = 0; i < sigBytes.length; i++) {
        binary += String.fromCharCode(sigBytes[i]);
      }
      const signature = btoa(binary);

      // Submit wallet claim
      const res = await fetch(`/api/agents/claim/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'wallet', walletAddress: pubkey, signature }),
      });
      const data = await res.json();
      if (data.success) {
        setCompletedMethod('wallet');
        setComplete(true);
      } else {
        alert(data.error || 'Wallet verification failed');
      }
    } catch (err: any) {
      if (err.message?.includes('User rejected')) return;
      alert('Wallet connection failed: ' + (err.message || 'Unknown error'));
    } finally {
      setClaiming(false);
    }
  };

  // Build full tweet text with all info
  const buildTweetText = () => {
    const code = claimTweetCode || 'VERIFY';
    const phone = agent?.phoneNumber || '';
    const name = agent?.name || 'my agent';
    const siteUrl = typeof window !== 'undefined' ? `${window.location.origin}/agent/${agent?.id}` : '';
    return `🤖 I'm claiming my AI agent "${name}" on PhoneBook!\n\n📞 ${phone}\n🔑 Code: ${code}\n\n👉 ${siteUrl}\n\n#PhoneBook #AI #0x01`;
  };

  const copyTweetText = () => {
    navigator.clipboard.writeText(buildTweetText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── LOADING ───
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading" style={{ fontSize: '1.1rem' }}>Verifying claim token</div>
      </div>
    );
  }

  // ─── ERROR ───
  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div className="error-stamp" style={{ marginBottom: '1.5rem' }}>INVALID TOKEN</div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--faded-accent)', marginBottom: '1.5rem' }}>{error}</p>
        <a href="/" className="btn" style={{ textDecoration: 'none' }}>← Back to PhoneBook</a>
      </div>
    );
  }

  // ─── COMPLETE ───
  if (complete) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{agent?.name} Verified</h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--faded-accent)', marginBottom: '0.5rem' }}>
          Ownership confirmed via {completedMethod === 'wallet' ? `Solana wallet (${walletAddress.slice(0, 8)}...)` : completedMethod === 'tweet' ? 'Twitter verification' : completedMethod === 'email' ? 'email verification' : 'verification'}
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

  const methodCardStyle = (m: ClaimMethod) => ({
    padding: '1.5rem',
    cursor: 'pointer' as const,
    border: `2px solid ${method === m ? 'var(--highlight)' : 'transparent'}`,
    transition: 'all 0.2s',
    background: method === m ? 'rgba(212,168,83,0.08)' : undefined,
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ textAlign: 'center', padding: '2rem 1.5rem 1.5rem', borderBottom: '3px double var(--ink)' }}>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
          Claim Your Agent
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--faded-accent)', margin: '0.25rem 0 0' }}>
          Choose one verification method to activate your agent
        </p>
      </header>

      <div style={{ flex: 1, maxWidth: '700px', width: '100%', margin: '0 auto', padding: '2rem 1.5rem' }}>
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

            {/* Method Selection */}
            {method === 'select' && (
              <>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--faded-accent)', marginBottom: '1rem', textAlign: 'center' }}>
                  Choose one of the following methods to verify ownership:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

                  {/* Email Option */}
                  <div className="card" style={methodCardStyle('email')} onClick={() => setMethod('email')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '1.5rem' }}>📧</span>
                      <div>
                        <strong style={{ fontSize: '1rem' }}>Email Verification</strong>
                        <p style={{ fontSize: '0.8rem', color: 'var(--faded-accent)', margin: '0.2rem 0 0' }}>
                          Receive a 6-digit code to your email and enter it to verify
                        </p>
                      </div>
                      <span style={{ marginLeft: 'auto', fontSize: '1.2rem', color: 'var(--faded-accent)' }}>→</span>
                    </div>
                  </div>

                  {/* Tweet Option */}
                  <div className="card" style={methodCardStyle('tweet')} onClick={() => { setMethod('tweet'); initTweet(); }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '1.5rem' }}>𝕏</span>
                      <div>
                        <strong style={{ fontSize: '1rem' }}>Post on X (Twitter)</strong>
                        <p style={{ fontSize: '0.8rem', color: 'var(--faded-accent)', margin: '0.2rem 0 0' }}>
                          Post a verification tweet with your agent details and code
                        </p>
                      </div>
                      <span style={{ marginLeft: 'auto', fontSize: '1.2rem', color: 'var(--faded-accent)' }}>→</span>
                    </div>
                  </div>

                  {/* Wallet Option */}
                  <div className="card" style={methodCardStyle('wallet')} onClick={() => setMethod('wallet')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '1.5rem' }}>👻</span>
                      <div>
                        <strong style={{ fontSize: '1rem' }}>Solana Wallet (Phantom)</strong>
                        <p style={{ fontSize: '0.8rem', color: 'var(--faded-accent)', margin: '0.2rem 0 0' }}>
                          Sign a message with your Phantom wallet to prove ownership
                        </p>
                      </div>
                      <span style={{ marginLeft: 'auto', fontSize: '1.2rem', color: 'var(--faded-accent)' }}>→</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ─── EMAIL METHOD ─── */}
            {method === 'email' && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', border: 'none', padding: 0 }}>📧 Email Verification</h3>
                  <button onClick={() => setMethod('select')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--faded-accent)' }}>
                    ← Change method
                  </button>
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--faded-accent)', marginBottom: '0.75rem' }}>
                  Enter your email to receive a verification code.
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
                    {devCode && (
                      <p style={{ margin: '0 0 0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--highlight)' }}>
                        Dev mode — your code: <strong>{devCode}</strong>
                      </p>
                    )}
                    <p style={{ margin: '0 0 0.5rem' }}>Check your email for the verification code:</p>
                    <input
                      type="text"
                      placeholder="Enter 6-digit code"
                      maxLength={6}
                      onChange={e => verifyEmailCode(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ─── TWEET METHOD ─── */}
            {method === 'tweet' && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', border: 'none', padding: 0 }}>𝕏 Post Verification Tweet</h3>
                  <button onClick={() => setMethod('select')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--faded-accent)' }}>
                    ← Change method
                  </button>
                </div>

                {!tweetReady ? (
                  <div style={{ textAlign: 'center', padding: '1rem' }}>
                    <div className="loading">Generating verification code...</div>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: '0.82rem', color: 'var(--faded-accent)', marginBottom: '0.75rem' }}>
                      Copy the text below and post it as a public tweet:
                    </p>

                    {/* Copyable tweet text */}
                    <div style={{
                      background: 'var(--ink)',
                      color: 'var(--paper)',
                      padding: '1rem',
                      borderRadius: '4px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.82rem',
                      lineHeight: 1.6,
                      marginBottom: '0.75rem',
                      whiteSpace: 'pre-wrap',
                      position: 'relative',
                    }}>
                      {buildTweetText()}
                      <button
                        onClick={copyTweetText}
                        style={{
                          position: 'absolute',
                          top: '0.5rem',
                          right: '0.5rem',
                          background: 'rgba(245,230,200,0.15)',
                          border: '1px solid rgba(245,230,200,0.3)',
                          color: 'var(--paper)',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.7rem',
                        }}
                      >
                        {copied ? '✓ Copied!' : 'Copy'}
                      </button>
                    </div>

                    {/* Verification code highlight */}
                    <div style={{
                      background: 'rgba(212,168,83,0.15)',
                      border: '1px solid var(--highlight)',
                      padding: '0.6rem 1rem',
                      borderRadius: '4px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.1rem',
                      textAlign: 'center',
                      marginBottom: '1rem',
                      letterSpacing: '0.2em',
                      color: 'var(--highlight)',
                      fontWeight: 'bold',
                    }}>
                      Code: {claimTweetCode}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                      <a
                        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildTweetText())}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary"
                        style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
                      >
                        Open X to Post
                      </a>
                      <button onClick={copyTweetText} className="btn" style={{ minWidth: '90px' }}>
                        {copied ? '✓ Copied' : '📋 Copy'}
                      </button>
                    </div>

                    <p style={{ fontSize: '0.78rem', color: 'var(--faded-accent)', marginBottom: '0.5rem' }}>
                      After posting, paste the tweet URL below (required when Twitter API is configured):
                    </p>
                    <input
                      type="url"
                      placeholder="https://x.com/yourhandle/status/..."
                      value={tweetUrl}
                      onChange={e => setTweetUrl(e.target.value)}
                      style={{ width: '100%', marginBottom: '1rem', padding: '0.5rem' }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={confirmTweet}
                      disabled={claiming}
                      style={{ width: '100%' }}
                    >
                      {claiming ? 'Verifying...' : 'I Posted the Tweet ✓'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ─── WALLET METHOD ─── */}
            {method === 'wallet' && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', border: 'none', padding: 0 }}>👻 Phantom Wallet Signature</h3>
                  <button onClick={() => setMethod('select')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--faded-accent)' }}>
                    ← Change method
                  </button>
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--faded-accent)', marginBottom: '0.75rem' }}>
                  Sign a message with your Phantom wallet to prove ownership. Your wallet address will be permanently linked to this agent.
                </p>
                <div style={{
                  background: 'rgba(45,80,22,0.08)',
                  border: '1px solid rgba(45,80,22,0.2)',
                  borderRadius: '4px',
                  padding: '0.75rem',
                  marginBottom: '1rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color: 'var(--faded-accent)',
                }}>
                  Message to sign: <br />
                  <span style={{ color: 'var(--ink)' }}>{messageToSign || `Claim agent ${agent?.id} for 0x01 PhoneBook`}</span>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={connectSolanaWallet}
                  disabled={claiming}
                  style={{ width: '100%' }}
                >
                  {claiming ? 'Connecting & Signing...' : 'Connect Phantom & Sign'}
                </button>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--faded-accent)', marginTop: '0.75rem', textAlign: 'center' }}>
                  Don&apos;t have Phantom? <a href="https://phantom.app" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--highlight)' }}>Download here</a>
                </p>
              </div>
            )}

            {/* Info note */}
            {method !== 'select' && (
              <div style={{ marginTop: '1.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--faded-accent)', lineHeight: 1.7, padding: '0 0.25rem', textAlign: 'center' }}>
                Complete any one method to verify your agent. Each method independently proves ownership.
              </div>
            )}
          </>
        )}
      </div>

      <footer style={{ padding: '0.5rem 1.5rem', borderTop: '1px solid var(--faded-accent)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--faded-accent)', textAlign: 'center' }}>
        PhoneBook — Agent Ownership Verification | {new Date().getFullYear()}
      </footer>
    </div>
  );
}
