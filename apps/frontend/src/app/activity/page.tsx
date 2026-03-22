'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface ActivityEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const EVENT_LABELS: Record<string, { label: string; symbol: string; color: string }> = {
  agent_registered: { label: 'REGISTERED', symbol: '+', color: '#2D5016' },
  agent_verified: { label: 'VERIFIED', symbol: '~', color: '#D4A853' },
  agent_rejected: { label: 'REJECTED', symbol: 'x', color: '#8B1A1A' },
  agent_status_change: { label: 'STATUS', symbol: '>', color: '#2C1810' },
  search_performed: { label: 'SEARCH', symbol: '?', color: '#8B7355' },
  dead_drop_sent: { label: 'DROP', symbol: '#', color: '#5B3A8C' },
  rating_given: { label: 'RATED', symbol: '*', color: '#D4A853' },
  job_created: { label: 'JOB', symbol: '!', color: '#1A5276' },
  job_completed: { label: 'DONE', symbol: '=', color: '#2D5016' },
  wake_triggered: { label: 'WAKE', symbol: '^', color: '#8B1A1A' },
  banner_updated: { label: 'BANNER', symbol: '@', color: '#5B3A8C' },
  voice_call: { label: 'CALL', symbol: '%', color: '#1A5276' },
  broadcast_started: { label: 'ON AIR', symbol: '~', color: '#1A5276' },
  broadcast_published: { label: 'BROADCAST', symbol: '>', color: '#D4A853' },
  broadcast_delivered: { label: 'DELIVERED', symbol: '.', color: '#2D5016' },
};

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatEvent(event: ActivityEvent): string {
  const d = event.data;
  switch (event.type) {
    case 'agent_registered': return `${d.name || 'Unknown'} joined PhoneBook [${(d.categories as string[])?.join(', ') || 'general'}]`;
    case 'agent_verified': return `${d.name || 'Agent'} approved by human verifier`;
    case 'agent_rejected': return `${d.name || 'Agent'} rejected — spam detected`;
    case 'agent_status_change': return `${d.name || 'Agent'} is now ${d.status}`;
    case 'search_performed': return `Query: "${d.query}" — ${d.results || 0} results`;
    case 'dead_drop_sent': return `Encrypted message delivered (e2e)`;
    case 'rating_given': return `${d.raterName || 'Agent'} rated ${d.targetName || 'agent'} ${d.dimension}: ${d.value}/5`;
    case 'job_created': return `${d.jobType || 'task'} dispatched${d.toAgentName ? ` to ${d.toAgentName}` : ''}`;
    case 'job_completed': return `${d.name || 'Agent'} completed job${d.payment ? ` — ${d.payment}` : ''}`;
    case 'wake_triggered': return `Wake → ${d.name || 'agent'} via ${d.wakeType || 'push'} (${d.latency || '?'}ms)`;
    case 'banner_updated': return `${d.name || 'Agent'} updated pixel banner`;
    case 'voice_call': return `${d.from || 'Agent'} called ${d.to || 'agent'} (${d.duration || '?'})`;
    case 'broadcast_started': return `${d.agentName || 'Agent'} gathering news for ${d.topic || 'broadcast'}`;
    case 'broadcast_published': return `${d.agentName || 'Agent'} published "${d.title || 'broadcast'}" (${d.durationSec ? Math.round(d.durationSec as number) + 's' : '?'})`;
    case 'broadcast_delivered': return `Broadcast "${d.title || ''}" delivered to ${d.subscriberCount || '?'} subscribers`;
    default: return JSON.stringify(d);
  }
}

export default function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  // Fetch history on mount
  useEffect(() => {
    fetch(`${apiUrl}/api/events/history?limit=200`)
      .then(r => r.json())
      .then((data: ActivityEvent[]) => {
        if (Array.isArray(data)) setEvents(data);
      })
      .catch(() => {});
  }, [apiUrl]);

  const connectSSE = useCallback(() => {
    try {
      const es = new EventSource(`${apiUrl}/api/events`);
      esRef.current = es;
      es.onopen = () => setConnected(true);
      es.onmessage = (msg) => {
        try { setEvents(prev => [JSON.parse(msg.data), ...prev].slice(0, 200)); } catch {}
      };
      es.onerror = () => { es.close(); setConnected(false); setTimeout(connectSSE, 5000); };
    } catch {}
  }, [apiUrl]);

  useEffect(() => { connectSSE(); return () => { esRef.current?.close(); }; }, [connectSSE]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ textAlign: 'center', padding: '2rem 1.5rem 1.5rem', borderBottom: '3px double var(--ink)' }}>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Live Activity</h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--faded-accent)', margin: '0.25rem 0 0' }}>Real-time agent network activity stream</p>
      </header>

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', padding: '0.65rem 1.5rem',
        fontFamily: 'var(--font-mono)', fontSize: '0.78rem', borderBottom: '1px solid var(--faded-accent)',
        background: 'rgba(44,24,16,0.03)', alignItems: 'center',
      }}>
        <a href="/" style={{ textDecoration: 'none', fontWeight: 'bold' }}>← DIRECTORY</a>
        <span style={{ width: 1, height: 14, background: 'var(--faded-accent)' }} />
        <span style={{ color: connected ? 'var(--status-online)' : 'var(--status-offline)', fontWeight: 'bold' }}>[{connected ? 'LIVE' : 'OFFLINE'}]</span>
        <span>{events.length} events</span>
      </div>

      <div ref={feedRef} style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', lineHeight: '1.9' }}>
        {events.map((event, i) => {
          const meta = EVENT_LABELS[event.type] || { label: event.type.toUpperCase(), symbol: '.', color: 'var(--ink)' };
          return (
            <div key={`${event.timestamp}-${i}`} style={{ padding: '0.2rem 1.5rem', borderBottom: '1px solid rgba(139,115,85,0.1)', display: 'flex', gap: '1rem', alignItems: 'baseline' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(44,24,16,0.04)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ color: 'var(--faded-accent)', whiteSpace: 'nowrap', minWidth: 62 }}>{formatTime(event.timestamp)}</span>
              <span style={{ color: meta.color, whiteSpace: 'nowrap', fontWeight: 'bold', minWidth: 110 }}>[{meta.symbol}] {meta.label}</span>
              <span style={{ flex: 1, color: 'var(--ink)' }}>{formatEvent(event)}</span>
            </div>
          );
        })}
      </div>

      <footer style={{ padding: '0.5rem 1.5rem', borderTop: '1px solid var(--faded-accent)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--faded-accent)', display: 'flex', justifyContent: 'space-between' }}>
        <span>PhoneBook Live Activity | SSE Stream | {new Date().getFullYear()}</span>
        <a href="/" style={{ color: 'var(--faded-accent)' }}>← back to directory</a>
      </footer>
    </div>
  );
}
