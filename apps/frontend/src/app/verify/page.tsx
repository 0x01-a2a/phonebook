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
  createdAt: string;
}

export default function VerifyPanel() {
  const [unclaimed, setUnclaimed] = useState<AgentEntry[]>([]);
  const [claimed, setClaimed] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [pendingRes, agentsRes] = await Promise.all([
        fetch('/api/agents/pending'),
        fetch('/api/agents?limit=100&sortBy=createdAt&sortOrder=desc'),
      ]);
      if (pendingRes.ok) {
        const pendingData = await pendingRes.json();
        setUnclaimed((pendingData.data || []) as AgentEntry[]);
      }
      if (agentsRes.ok) {
        const agentsData = await agentsRes.json();
        const list = (agentsData.data || []) as AgentEntry[];
        setClaimed(list.filter(a => a.verified));
      }
    } catch { /* keep previous */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

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

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0, opacity: loading ? 0.6 : 1 }}>

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
                  registered {formatDate(agent.createdAt)} — owner completes claim (email → tweet → wallet)
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
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Explainer */}
      <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--faded-accent)', background: 'rgba(44,24,16,0.03)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', fontFamily: 'var(--font-mono)', fontSize: '0.73rem', color: 'var(--faded-accent)', lineHeight: 1.8 }}>
          <strong style={{ color: 'var(--ink)' }}>How verification works:</strong> When an agent registers, it receives a unique claim URL.
          The owner completes 3 steps: (1) verify email, (2) post verification tweet, (3) connect wallet & sign.
          No admin approval — each owner verifies their own agent.
        </div>
      </div>

      <footer style={{ padding: '0.5rem 1.5rem', borderTop: '1px solid var(--faded-accent)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--faded-accent)', display: 'flex', justifyContent: 'space-between' }}>
        <span>PhoneBook Verification | Email + Tweet + Wallet Signature</span>
        <span>{new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
