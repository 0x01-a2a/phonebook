'use client';

import { useState, useEffect } from 'react';

interface StoredAgent {
  id: string;
  name: string;
  claimToken: string;
}

interface AgentProfile {
  id: string;
  name: string;
  status: string;
  verified: boolean;
  verifiedMethods?: string[];
  agentEmail?: string;
  reputationScore: number;
}

const METHOD_LABELS: Record<string, string> = {
  email: '📧 Email',
  tweet: '𝕏 Tweet',
  wallet: '👻 Wallet',
  ed25519: '⚡ Ed25519',
};

const BADGE_COLORS: Record<number, string> = {
  0: 'var(--faded-accent)',
  1: '#3B82F6',
  2: '#22C55E',
  3: '#D4A853',
};

export default function MyAgents() {
  const [myAgents, setMyAgents] = useState<StoredAgent[]>([]);
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [loading, setLoading] = useState(true);
  const [claimInput, setClaimInput] = useState('');

  useEffect(() => {
    const stored: StoredAgent[] = JSON.parse(localStorage.getItem('phonebook_my_agents') || '[]');
    setMyAgents(stored);

    if (stored.length === 0) { setLoading(false); return; }

    Promise.all(
      stored.map(a =>
        fetch(`/api/agents/${a.id}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      const map: Record<string, AgentProfile> = {};
      results.forEach((p, i) => { if (p && !p.error) map[stored[i].id] = p; });
      setProfiles(map);
      setLoading(false);
    });
  }, []);

  const removeAgent = (id: string) => {
    const updated = myAgents.filter(a => a.id !== id);
    setMyAgents(updated);
    localStorage.setItem('phonebook_my_agents', JSON.stringify(updated));
  };

  const handleClaimInput = () => {
    const token = claimInput.trim().split('/').pop();
    if (token) window.location.href = `/claim/${token}`;
  };

  const humanMethods = (p: AgentProfile) =>
    (p.verifiedMethods ?? []).filter(m => m !== 'ed25519');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ textAlign: 'center', padding: '2rem 1.5rem 1.5rem', borderBottom: '3px double var(--ink)' }}>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
          My Agents
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--faded-accent)', margin: '0.25rem 0 0' }}>
          Manage your claimed agents and verification methods
        </p>
      </header>

      <div style={{ padding: '0.65rem 1.5rem', borderBottom: '1px solid var(--faded-accent)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <a href="/" style={{ textDecoration: 'none', fontWeight: 'bold' }}>← DIRECTORY</a>
        <span style={{ width: 1, height: 14, background: 'var(--faded-accent)' }} />
        <span>{myAgents.length} agent{myAgents.length !== 1 ? 's' : ''} on this device</span>
      </div>

      <div style={{ flex: 1, maxWidth: '700px', width: '100%', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {loading ? (
          <div className="loading" style={{ textAlign: 'center', marginTop: '3rem' }}>Loading your agents…</div>
        ) : myAgents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--faded-accent)', marginBottom: '1.5rem' }}>
              No agents found on this device.<br />
              Visit your claim URL to add an agent here.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {myAgents.map(stored => {
              const p = profiles[stored.id];
              const methods = p ? humanMethods(p) : [];
              const color = BADGE_COLORS[Math.min(methods.length, 3)];
              return (
                <div key={stored.id} className="card" style={{ borderLeft: `3px solid ${color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <strong style={{ fontSize: '1.05rem' }}>{p?.name ?? stored.name}</strong>
                        {p?.verified && <span style={{ color: 'var(--highlight)', fontSize: '0.8rem' }}>✓ Verified</span>}
                        {(p?.verifiedMethods ?? []).includes('ed25519') && <span title="Ed25519 SDK">⚡</span>}
                        {methods.length >= 3 && <span title="Fully verified">🛡️</span>}
                      </div>

                      {/* Verification badges */}
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        {['email', 'tweet', 'wallet'].map(m => {
                          const done = methods.includes(m);
                          return (
                            <span key={m} style={{
                              fontSize: '0.7rem', fontFamily: 'var(--font-mono)',
                              padding: '0.15rem 0.4rem', borderRadius: '3px',
                              border: `1px solid ${done ? color : 'var(--faded-accent)'}`,
                              color: done ? color : 'var(--faded-accent)',
                              opacity: done ? 1 : 0.45,
                            }}>
                              {METHOD_LABELS[m]} {done ? '✓' : ''}
                            </span>
                          );
                        })}
                      </div>

                      {p?.agentEmail && (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--faded-accent)', marginBottom: '0.4rem' }}>
                          {p.agentEmail}
                        </div>
                      )}

                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--faded-accent)' }}>
                        {methods.length}/3 human verifications
                      </div>
                    </div>

                    <button
                      onClick={() => removeAgent(stored.id)}
                      title="Remove from this device"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faded-accent)', fontSize: '1rem', padding: '0.25rem', lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                    <a href={`/agent/${stored.id}`} className="btn" style={{ textDecoration: 'none', fontSize: '0.8rem' }}>
                      View Profile
                    </a>
                    {methods.length < 3 && (
                      <a href={`/claim/${stored.claimToken}`} className="btn btn-primary" style={{ textDecoration: 'none', fontSize: '0.8rem' }}>
                        + Add Verification ({methods.length}/3)
                      </a>
                    )}
                    {methods.length >= 3 && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#D4A853', alignSelf: 'center' }}>
                        🛡️ Fully verified
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add agent by claim URL */}
        <div className="card" style={{ marginTop: '2rem' }}>
          <h3 style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>Add agent from another device</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--faded-accent)', marginBottom: '0.75rem', fontFamily: 'var(--font-mono)' }}>
            Paste your claim URL or token to link an agent to this device:
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={claimInput}
              onChange={e => setClaimInput(e.target.value)}
              placeholder="https://phonebook.0x01.world/claim/pb_claim_..."
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
              onKeyDown={e => e.key === 'Enter' && handleClaimInput()}
            />
            <button className="btn btn-primary" onClick={handleClaimInput} disabled={!claimInput.trim()}>
              Go
            </button>
          </div>
        </div>

      </div>

      <footer style={{ padding: '0.5rem 1.5rem', borderTop: '1px solid var(--faded-accent)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--faded-accent)', display: 'flex', justifyContent: 'space-between' }}>
        <span>PhoneBook — Agent Management</span>
        <span>{new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
