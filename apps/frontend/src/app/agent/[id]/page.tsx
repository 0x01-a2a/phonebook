'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface Agent {
  id: string;
  name: string;
  description: string;
  categories: string[];
  whatsappNumber?: string;
  whatsappDisplay?: string;
  whatsappVcardUrl?: string;
  contactWebhook?: string;
  contactEmail?: string;
  agentEmail?: string;
  status: 'online' | 'offline' | 'busy' | 'maintenance';
  reputationScore: number;
  trustScore: number;
  verified: boolean;
  featured: boolean;
  verifiedMethods?: string[];
  pubkeyHex?: string;
  pixelBannerGif?: string;
  pixelBannerFrames?: any;
  voiceEnabled?: boolean;
  voiceConfig?: any;
  backupAgent?: {
    id: string;
    name: string;
    whatsappDisplay: string;
  };
  createdAt: string;
  ratings?: Rating[];
  proofOfWorkScores?: ProofOfWorkScore[];
}

const BADGE_COLORS: Record<number, string> = { 0: '#2C1810', 1: '#3B82F6', 2: '#22C55E', 3: '#D4A853' };
const BADGE_LABELS: Record<string, string> = { email: '📧 Email', tweet: '𝕏 Tweet', wallet: '👻 Wallet', ed25519: '⚡ Ed25519' };

interface Rating {
  id: string;
  raterId: string;
  dimension: string;
  value: number;
  comment?: string;
  weight: number;
  createdAt: string;
  raterName?: string;
}

interface ProofOfWorkScore {
  id: string;
  challengeId: string;
  challengeType: string;
  score: number;
  verified: boolean;
  submittedAt: string;
  challengeTitle?: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  response_speed: 'Response Speed',
  accuracy: 'Accuracy',
  communication: 'Communication',
  reliability: 'Reliability',
  helpfulness: 'Helpfulness',
};

const DIMENSION_WEIGHTS: Record<string, number> = {
  response_speed: 0.20,
  accuracy: 0.35,
  communication: 0.20,
  reliability: 0.15,
  helpfulness: 0.10,
};

export default function AgentProfile() {
  const params = useParams();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.id) {
      fetchAgent(params.id as string);
    }
  }, [params.id]);

  const fetchAgent = async (id: string) => {
    try {
      const response = await fetch(`/api/agents/${id}`);
      if (!response.ok) {
        throw new Error('Agent not found');
      }
      const data = await response.json();
      setAgent(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent');
    } finally {
      setLoading(false);
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'online': return 'status-online';
      case 'offline': return 'status-offline';
      case 'busy': return 'status-busy';
      default: return 'status-maintenance';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'online': return 'Online';
      case 'offline': return 'Offline';
      case 'busy': return 'Busy';
      case 'maintenance': return 'Maintenance';
      default: return status;
    }
  };

  const renderStars = (score: number) => {
    const fullStars = Math.floor(score / 2);
    const hasHalf = score % 2 >= 1;
    return '★'.repeat(fullStars) + (hasHalf ? '½' : '') + '☆'.repeat(5 - fullStars - (hasHalf ? 1 : 0));
  };

  const renderDimensionStars = (dimension: string, score: number) => {
    const weight = DIMENSION_WEIGHTS[dimension] || 0.2;
    const weightedScore = score * weight;
    return renderStars(weightedScore);
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Connecting...</div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="container">
        <div className="error-stamp">UNAVAILABLE</div>
        <p style={{ marginTop: '1rem' }}>{error || 'Agent not found'}</p>
        <a href="/" style={{ display: 'inline-block', marginTop: '1rem' }}>← Back to Directory</a>
      </div>
    );
  }

  return (
    <div className="container">
      <a href="/" style={{ display: 'inline-block', marginBottom: '1rem' }}>← Back to Directory</a>

      {/* Pixel Banner */}
      {agent.pixelBannerGif && (
        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <img 
            src={agent.pixelBannerGif} 
            alt={`${agent.name} banner`}
            className="pixel-banner"
            style={{ 
              width: '100%', 
              maxWidth: '640px', 
              height: '128px', 
              objectFit: 'contain', 
              background: '#2C1810',
              border: '2px solid #2C1810'
            }}
          />
        </div>
      )}

      {/* Header */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ marginBottom: '0.5rem' }}>
              {agent.name}
              {agent.verified && <span style={{ marginLeft: '0.5rem', color: '#D4A853' }}>✓ Verified</span>}
              {agent.featured && <span style={{ marginLeft: '0.5rem', color: '#D4A853' }}>⭐ Featured</span>}
              {agent.pubkeyHex && <span title="ZeroClaw / Ed25519 identity" style={{ marginLeft: '0.4rem', fontSize: '0.9rem' }}>⚡</span>}
              {(agent.verifiedMethods?.length ?? 0) >= 3 && (
                <span title="Fully verified — 3 methods" style={{ marginLeft: '0.4rem', fontSize: '0.9rem', color: '#D4A853' }}>🛡️</span>
              )}
            </h1>
            {/* Verification badges row */}
            {(agent.verifiedMethods?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                {(agent.verifiedMethods ?? []).map(m => (
                  <span key={m} style={{
                    fontSize: '0.68rem', fontFamily: 'var(--font-mono, monospace)',
                    padding: '0.15rem 0.45rem', borderRadius: '3px',
                    border: `1px solid ${BADGE_COLORS[agent.verifiedMethods!.length] || '#2C1810'}`,
                    color: BADGE_COLORS[agent.verifiedMethods!.length] || '#2C1810',
                    background: 'transparent',
                  }}>
                    {BADGE_LABELS[m] ?? m}
                  </span>
                ))}
              </div>
            )}
            <p style={{ color: '#8B7355' }}>
              <span className={`status-dot ${getStatusClass(agent.status)}`}></span>
              {getStatusLabel(agent.status)}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="rating" style={{ fontSize: '1.5rem' }}>
              {renderStars(agent.reputationScore)}
            </div>
            <p style={{ fontFamily: 'Courier Prime', fontSize: '0.85rem', color: '#8B7355' }}>
              Reputation: {agent.reputationScore.toFixed(1)}/10
            </p>
          </div>
        </div>
      </div>

      {/* Contact Section */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2>Contact</h2>
        
        {agent.whatsappNumber && (
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>WhatsApp</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <a 
                href={`https://wa.me/${agent.whatsappNumber.replace(/\D/g, '')}`}
                className="btn btn-primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                📱 Send Message
              </a>
              {agent.whatsappVcardUrl && (
                <a 
                  href={agent.whatsappVcardUrl}
                  className="btn"
                  download
                >
                  📇 Add to Contacts
                </a>
              )}
            </div>
            {agent.whatsappDisplay && (
              <p style={{ fontFamily: 'Courier Prime', marginTop: '0.5rem', color: '#8B7355' }}>
                {agent.whatsappDisplay}
              </p>
            )}
          </div>
        )}

        {agent.contactWebhook && (
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>Webhook</p>
            <code style={{ fontFamily: 'Courier Prime', fontSize: '0.85rem', wordBreak: 'break-all' }}>
              {agent.contactWebhook}
            </code>
          </div>
        )}

        {agent.agentEmail && (
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>Agent Email</p>
            <a href={`mailto:${agent.agentEmail}`} style={{ fontFamily: 'Courier Prime, monospace', fontSize: '0.9rem' }}>
              {agent.agentEmail}
            </a>
          </div>
        )}

        {agent.contactEmail && (
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>Owner Email</p>
            <a href={`mailto:${agent.contactEmail}`}>{agent.contactEmail}</a>
          </div>
        )}

        {agent.backupAgent && (
          <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#2C1810', color: '#F5E6C8', borderRadius: '4px' }}>
            <p style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>🔄 Backup Agent</p>
            <a href={`/agent/${agent.backupAgent.id}`} style={{ color: '#D4A853' }}>
              {agent.backupAgent.name}
            </a>
          </div>
        )}
      </div>

      {/* About */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2>About</h2>
        
        {agent.description && (
          <p>{agent.description}</p>
        )}

        {agent.categories && agent.categories.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Categories</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
              {agent.categories.map((cat) => (
                <span key={cat} className="category-tag">{cat}</span>
              ))}
            </div>
          </div>
        )}

        {agent.voiceEnabled && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontWeight: 'bold' }}>🎙️ Voice Enabled</p>
            {agent.voiceConfig?.voiceId && (
              <p style={{ fontFamily: 'Courier Prime', fontSize: '0.85rem', color: '#8B7355' }}>
                Voice ID: {agent.voiceConfig.voiceId}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Proof of Work */}
      {agent.proofOfWorkScores && agent.proofOfWorkScores.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2>🏆 Proof of Work</h2>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {agent.proofOfWorkScores.map((pow) => (
              <div 
                key={pow.id} 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  padding: '0.5rem',
                  background: pow.verified ? '#2D5016' : '#8B7355',
                  color: pow.verified ? '#F5E6C8' : '#2C1810',
                  borderRadius: '4px'
                }}
              >
                <span>
                  {pow.challengeTitle || pow.challengeType}
                  {pow.verified && <span style={{ marginLeft: '0.5rem' }}>✓</span>}
                </span>
                <span style={{ fontFamily: 'Courier Prime' }}>{pow.score.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ratings */}
      {agent.ratings && agent.ratings.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2>⭐ Ratings</h2>
          
          {/* Dimension averages */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>By Category</p>
            {Object.entries(DIMENSION_LABELS).map(([dim, label]) => {
              const dimRatings = agent.ratings?.filter(r => r.dimension === dim) || [];
              const avg = dimRatings.length > 0 
                ? dimRatings.reduce((sum, r) => sum + r.value, 0) / dimRatings.length 
                : 0;
              return (
                <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ flex: 1, fontSize: '0.9rem' }}>{label}</span>
                  <span className="rating">{renderDimensionStars(dim, avg)}</span>
                  <span style={{ fontFamily: 'Courier Prime', fontSize: '0.8rem', color: '#8B7355', width: '40px', textAlign: 'right' }}>
                    {avg.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Recent ratings */}
          <div style={{ borderTop: '1px solid #8B7355', paddingTop: '1rem' }}>
            <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Recent Ratings</p>
            {agent.ratings.slice(0, 5).map((rating) => (
              <div key={rating.id} style={{ marginBottom: '0.75rem', padding: '0.5rem', background: 'rgba(139, 115, 85, 0.1)', borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 'bold' }}>{DIMENSION_LABELS[rating.dimension] || rating.dimension}</span>
                  <span className="rating">{renderStars(rating.value)}</span>
                </div>
                {rating.comment && (
                  <p style={{ fontSize: '0.85rem', color: '#8B7355', fontStyle: 'italic' }}>"{rating.comment}"</p>
                )}
                <p style={{ fontSize: '0.75rem', color: '#8B7355', marginTop: '0.25rem' }}>
                  {rating.raterName || 'Anonymous'} • {new Date(rating.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trust Score */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2>🔗 Trust Graph</h2>
        <p>Trust Score: <strong>{agent.trustScore.toFixed(3)}</strong></p>
        <p style={{ fontSize: '0.85rem', color: '#8B7355' }}>
          PageRank-style algorithm calculating trust in the agent network.
        </p>
        <a href={`/api/agents/${agent.id}/trust-graph`} style={{ fontSize: '0.85rem' }}>
          View full trust graph →
        </a>
      </div>

      <footer style={{ marginTop: '3rem', padding: '1rem', textAlign: 'center', borderTop: '1px solid #8B7355', fontFamily: 'Courier Prime', fontSize: '0.85rem', color: '#8B7355' }}>
        <p>© 2026 AgentBook | Registered: {new Date(agent.createdAt).toLocaleDateString()}</p>
      </footer>
    </div>
  );
}
