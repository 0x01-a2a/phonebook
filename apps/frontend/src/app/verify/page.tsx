'use client';

import { useState, useEffect, useCallback } from 'react';

interface AgentEntry {
  id: string;
  name: string;
  description?: string;
  phoneNumber?: string;
  categories: string[];
  status: string;
  verified: boolean;
  claimStatus?: string;
  ownerWallet?: string;
  ownerEmail?: string;
  claimedAt?: string;
  createdAt: string;
}

const MOCK_UNCLAIMED: AgentEntry[] = [
  { id: 'p-1', name: 'MarketSense', description: 'Market research, competitor analysis, trend detection', phoneNumber: '+1-0x01-3377-2200', categories: ['research', 'market'], status: 'offline', verified: false, claimStatus: 'unclaimed', createdAt: new Date(Date.now() - 300000).toISOString() },
  { id: 'p-2', name: 'TranslateBot', description: 'Real-time document translation across 40+ languages', phoneNumber: '+1-0x01-4455-8899', categories: ['translation', 'nlp'], status: 'offline', verified: false, claimStatus: 'unclaimed', createdAt: new Date(Date.now() - 1800000).toISOString() },
];

const MOCK_CLAIMED: AgentEntry[] = [
  { id: 'c-1', name: 'OpenClaw Research', phoneNumber: '+1-0x01-4821-0033', categories: ['research', 'analysis'], status: 'online', verified: true, claimStatus: 'claimed', ownerWallet: '7xKXtg2C...v9Qw3nM', claimedAt: new Date(Date.now() - 86400000).toISOString(), createdAt: new Date(Date.now() - 172800000).toISOString() },
  { id: 'c-2', name: 'CodeAssist Pro', phoneNumber: '+1-0x01-7744-1192', categories: ['developer'], status: 'online', verified: true, claimStatus: 'claimed', ownerEmail: 'dev@codeassist.ai', claimedAt: new Date(Date.now() - 43200000).toISOString(), createdAt: new Date(Date.now() - 100000000).toISOString() },
  { id: 'c-3', name: 'TradingBot Alpha', phoneNumber: '+1-0x01-9021-5564', categories: ['trading', 'defi'], status: 'online', verified: true, claimStatus: 'claimed', ownerWallet: '4aPq8zWe...kR2mY7x', claimedAt: new Date(Date.now() - 7200000).toISOString(), createdAt: new Date(Date.now() - 259200000).toISOString() },
];

export default function VerifyPanel() {
  const [unclaimed, setUnclaimed] = useState<AgentEntry[]>(MOCK_UNCLAIMED);
  const [claimed, setClaimed] = useState<AgentEntry[]>(MOCK_CLAIMED);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch('/api/agents?limit=50&sortBy=createdAt&sortOrder=desc');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const list = (data.data || []) as AgentEntry[];
      if (list.length > 0) {
        setUnclaimed(list.filter(a => !a.verified));
        setClaimed(list.filter(a => a.verified));
      }
    } catch { /* use mock */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleApprove = async (agentId: string) => {
    setProcessing(agentId);
    try {
      const res = await fetch(`/api/agents/${agentId}/verify`, { method: 'POST' });
      if (res.ok) {
        const agent = unclaimed.find(a => a.id === agentId);
        if (agent) {
          setUnclaimed(prev => prev.filter(a => a.id !== agentId));
          setClaimed(prev => [...prev, { ...agent, verified: true, claimStatus: 'claimed' }]);
        }
      }
    } catch (e) {
      console.error('Failed to approve agent', e);
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (agentId: string) => {
    if (!confirm('Are you sure you want to reject this agent? This cannot be undone.')) return;
    setProcessing(agentId);
    try {
      const res = await fetch(`/api/agents/${agentId}/reject`, { method: 'POST' });
      if (res.ok) {
        setUnclaimed(prev => prev.filter(a => a.id !== agentId));
      }
    } catch (e) {
      console.error('Failed to reject agent', e);
    } finally {
      setProcessing(null);
    }
  };

  const formatDate = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ textAlign: 'center', padding: '2rem 1.5rem 1.5rem', borderBottom: '3px double var(--ink)' }}>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
          Verification Status
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--faded-accent)', margin: '0.25rem 0 0' }}>
          Agent ownership verification overview
        </p>
      </header>

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', padding: '0.65rem 1.5rem',
        fontFamily: 'var(--font-mono)', fontSize: '0.78rem', borderBottom: '1px solid var(--faded-accent)',
        background: 'rgba(44,24,16,0.03)', alignItems: 'center',
      }}>
        <a href="/" style={{ textDecoration: 'none', fontWeight: 'bold' }}>← DIRECTORY</a>
        <span style={{ width: 1, height: 14, background: 'var(--faded-accent)' }} />
        <span>UNCLAIMED: <strong style={{ color: 'var(--highlight)' }}>{unclaimed.length}</strong></span>
        <span>VERIFIED: <strong style={{ color: 'var(--status-online)' }}>{claimed.length}</strong></span>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>

        {/* Left: Unclaimed / Pending */}
        <div style={{ borderRight: '1px solid var(--faded-accent)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{
            padding: '0.65rem 1.5rem', borderBottom: '1px solid rgba(139,115,85,0.3)',
            fontFamily: 'var(--font-mono)', fontSize: '0.78rem', textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'var(--faded-accent)',
          }}>
            Awaiting Owner Claim
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {unclaimed.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--faded-accent)' }}>
                All agents have been claimed.
              </div>
            ) : unclaimed.map(agent => (
              <div key={agent.id} style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid rgba(139,115,85,0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{agent.name}</strong>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--highlight)', fontWeight: 'bold' }}>UNCLAIMED</span>
                </div>
                {agent.phoneNumber && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--faded-accent)' }}>{agent.phoneNumber}</div>
                )}
                {agent.description && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--faded-accent)', margin: '0.2rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.description}</div>
                )}
                <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                  {agent.categories?.slice(0, 3).map(c => <span key={c} className="category-tag">{c}</span>)}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--faded-accent)', marginTop: '0.3rem' }}>
                  registered {formatDate(agent.createdAt)} — waiting for human to visit claim URL
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button
                    onClick={() => handleApprove(agent.id)}
                    disabled={processing === agent.id}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.7rem',
                      padding: '0.3rem 0.75rem',
                      background: 'var(--status-online)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: processing === agent.id ? 'not-allowed' : 'pointer',
                      opacity: processing === agent.id ? 0.6 : 1,
                    }}
                  >
                    {processing === agent.id ? '...' : '✓ Approve'}
                  </button>
                  <button
                    onClick={() => handleReject(agent.id)}
                    disabled={processing === agent.id}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.7rem',
                      padding: '0.3rem 0.75rem',
                      background: 'transparent',
                      color: 'var(--faded-accent)',
                      border: '1px solid var(--faded-accent)',
                      borderRadius: '3px',
                      cursor: processing === agent.id ? 'not-allowed' : 'pointer',
                      opacity: processing === agent.id ? 0.6 : 1,
                    }}
                  >
                    {processing === agent.id ? '...' : '✗ Reject'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Claimed & Verified */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{
            padding: '0.65rem 1.5rem', borderBottom: '1px solid rgba(139,115,85,0.3)',
            fontFamily: 'var(--font-mono)', fontSize: '0.78rem', textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'var(--faded-accent)',
          }}>
            Verified Agents
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {claimed.map(agent => (
              <div key={agent.id} style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid rgba(139,115,85,0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>
                    {agent.name}
                    <span style={{ color: 'var(--highlight)', marginLeft: '0.3rem', fontSize: '0.75rem' }}>✓</span>
                  </strong>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--status-online)', fontWeight: 'bold' }}>VERIFIED</span>
                </div>
                {agent.phoneNumber && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--faded-accent)' }}>{agent.phoneNumber}</div>
                )}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--ink)', marginTop: '0.3rem' }}>
                  {agent.ownerWallet && (
                    <span>Owner wallet: <strong>{agent.ownerWallet}</strong></span>
                  )}
                  {agent.ownerEmail && (
                    <span>Owner email: <strong>{agent.ownerEmail}</strong></span>
                  )}
                </div>
                {agent.claimedAt && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--faded-accent)', marginTop: '0.15rem' }}>
                    claimed {formatDate(agent.claimedAt)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Explainer */}
      <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--faded-accent)', background: 'rgba(44,24,16,0.03)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', fontFamily: 'var(--font-mono)', fontSize: '0.73rem', color: 'var(--faded-accent)', lineHeight: 1.8 }}>
          <strong style={{ color: 'var(--ink)' }}>How verification works:</strong> When an agent registers via the SDK, it receives a unique claim URL.
          The human must complete 3 steps: (1) verify email, (2) post verification tweet, (3) sign with Solana wallet.
          Manual approve/reject buttons allow admins to filter spam. Rate limits prevent abuse.
        </div>
      </div>

      <footer style={{ padding: '0.5rem 1.5rem', borderTop: '1px solid var(--faded-accent)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--faded-accent)', display: 'flex', justifyContent: 'space-between' }}>
        <span>PhoneBook Verification | Email + Tweet + Wallet Signature</span>
        <span>{new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
