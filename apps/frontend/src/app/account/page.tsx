'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getListenerId } from '@/lib/listener-id';

const API = process.env.NEXT_PUBLIC_API_URL || '';

interface Status {
  plan: 'free' | 'pro' | 'studio';
  status: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string;
  musicQuotaUsed?: number;
  musicQuotaTotal?: number;
  broadcastQuotaUsed?: number;
  broadcastQuotaTotal?: number;
}

interface MusicTrack {
  id: string;
  title: string;
  genre: string | null;
  audioUrlMp3: string | null;
  durationSec: number | null;
  status: string;
  publishedAt: string | null;
  prompt: string;
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, fontFamily: 'monospace' }}>LOADING...</div>}>
      <AccountInner />
    </Suspense>
  );
}

function AccountInner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [generating, setGenerating] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [genre, setGenre] = useState('synthwave');
  const [lastTrack, setLastTrack] = useState<MusicTrack | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const params = useSearchParams();
  const success = params.get('success') === 'true';

  useEffect(() => {
    const fetchStatus = () =>
      fetch(`${API}/api/subscriptions/status`, {
        headers: { 'X-Listener-Id': getListenerId() },
      })
        .then((r) => r.json())
        .then(setStatus);

    fetchStatus();
    if (success) {
      // Webhook lag — poll a few times
      const t1 = setTimeout(fetchStatus, 2000);
      const t2 = setTimeout(fetchStatus, 5000);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [success]);

  async function generateTrack() {
    if (prompt.length < 5) {
      setGenError('Prompt too short (min 5 chars)');
      return;
    }
    setGenerating(true);
    setGenError(null);
    setLastTrack(null);
    try {
      const res = await fetch(`${API}/api/music/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Listener-Id': getListenerId(),
        },
        body: JSON.stringify({
          prompt,
          genre,
          durationMs: 45000,
          instrumental: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error || data.message || 'Generation failed');
      } else {
        // refetch full track
        const track = await fetch(`${API}/api/music/${data.trackId}`).then((r) => r.json());
        setLastTrack(track);
        // refresh quota
        fetch(`${API}/api/subscriptions/status`, {
          headers: { 'X-Listener-Id': getListenerId() },
        })
          .then((r) => r.json())
          .then(setStatus);
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  }

  async function openPortal() {
    if (!status?.stripeCustomerId) return;
    setPortalLoading(true);
    try {
      const res = await fetch(`${API}/api/subscriptions/portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripeCustomerId: status.stripeCustomerId }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#F5E6C8',
        padding: '40px 20px',
        fontFamily: '"Press Start 2P", monospace',
        color: '#2C1810',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.04) 0, rgba(0,0,0,0.04) 1px, transparent 2px, transparent 4px)',
          pointerEvents: 'none',
          zIndex: 200,
        }}
      />

      <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        <a
          href="/radio"
          style={{
            color: '#0066FF',
            fontFamily: 'monospace',
            fontSize: 12,
            textDecoration: 'none',
          }}
        >
          ← BACK TO RADIO
        </a>

        <h1 style={{ fontSize: 22, marginTop: 24, marginBottom: 24 }}>MY ACCOUNT</h1>

        {success && (
          <div
            style={{
              background: '#00CC44',
              color: '#fff',
              padding: 16,
              marginBottom: 24,
              border: '3px solid #2C2C2C',
              boxShadow: '4px 4px 0 #2C2C2C',
              fontSize: 13,
            }}
          >
            ✓ SUBSCRIPTION ACTIVE — WELCOME TO PRO
          </div>
        )}

        <div
          style={{
            border: '3px solid #2C2C2C',
            boxShadow: '6px 6px 0 #2C2C2C',
            background: '#FFFFFF',
            padding: 24,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 10, color: '#888' }}>CURRENT PLAN</div>
          <div style={{ fontSize: 28, marginTop: 6, marginBottom: 16 }}>
            {status?.plan === 'pro' ? 'PHONEBOOK RADIO PRO' : 'FREE LISTENER'}
          </div>

          {status?.plan === 'pro' ? (
            <>
              <div
                style={{
                  fontFamily: '"Courier Prime", monospace',
                  fontSize: 14,
                  lineHeight: 2,
                  marginBottom: 20,
                }}
              >
                <div>
                  STATUS:{' '}
                  <span style={{ color: status.status === 'active' ? '#009933' : '#CC0000' }}>
                    {status.status?.toUpperCase()}
                  </span>
                </div>
                <div>
                  RENEWS:{' '}
                  {status.currentPeriodEnd
                    ? new Date(status.currentPeriodEnd).toLocaleDateString()
                    : '—'}
                </div>
                <div>
                  ♪ MUSIC: {status.musicQuotaUsed}/{status.musicQuotaTotal} this week
                </div>
                <div>
                  📣 BROADCASTS: {status.broadcastQuotaUsed}/{status.broadcastQuotaTotal} this week
                </div>
              </div>

              <button
                onClick={openPortal}
                disabled={portalLoading || !status.stripeCustomerId}
                style={{
                  padding: 12,
                  background: '#0066FF',
                  color: '#fff',
                  border: '3px solid #2C2C2C',
                  boxShadow: '3px 3px 0 #2C2C2C',
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {portalLoading ? 'LOADING...' : 'MANAGE SUBSCRIPTION'}
              </button>
            </>
          ) : (
            <a
              href="/subscribe"
              style={{
                display: 'inline-block',
                padding: 14,
                background: '#00CC44',
                color: '#fff',
                border: '3px solid #2C2C2C',
                boxShadow: '4px 4px 0 #2C2C2C',
                textDecoration: 'none',
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 12,
                marginTop: 8,
              }}
            >
              UPGRADE TO PRO — $9/MO
            </a>
          )}
        </div>

        {status?.plan === 'pro' && (
          <div
            style={{
              border: '3px solid #2C2C2C',
              boxShadow: '6px 6px 0 #2C2C2C',
              background: '#FFFFFF',
              padding: 24,
              marginBottom: 24,
            }}
          >
            <h2 style={{ fontSize: 16, marginTop: 0, marginBottom: 16 }}>♪ GENERATE MUSIC</h2>

            <label
              style={{
                display: 'block',
                fontSize: 11,
                marginBottom: 6,
                color: '#666',
              }}
            >
              GENRE
            </label>
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              style={{
                width: '100%',
                padding: 10,
                border: '2px solid #2C2C2C',
                fontSize: 14,
                fontFamily: 'monospace',
                marginBottom: 14,
                background: '#fff',
              }}
            >
              <option value="synthwave">Synthwave</option>
              <option value="lo-fi hip hop">Lo-fi Hip Hop</option>
              <option value="ambient">Ambient</option>
              <option value="cinematic">Cinematic</option>
              <option value="chiptune">Chiptune</option>
              <option value="jazz">Jazz</option>
              <option value="orchestral">Orchestral</option>
              <option value="techno">Techno</option>
              <option value="indie rock">Indie Rock</option>
            </select>

            <label
              style={{
                display: 'block',
                fontSize: 11,
                marginBottom: 6,
                color: '#666',
              }}
            >
              PROMPT
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Retro synthwave with neon arcade vibes, 110 BPM, dramatic build-up..."
              rows={4}
              style={{
                width: '100%',
                padding: 12,
                border: '2px solid #2C2C2C',
                fontSize: 14,
                fontFamily: 'monospace',
                marginBottom: 14,
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />

            <button
              onClick={generateTrack}
              disabled={generating || (status.musicQuotaUsed ?? 0) >= (status.musicQuotaTotal ?? 0)}
              style={{
                width: '100%',
                padding: 16,
                background: generating ? '#888' : '#0066FF',
                color: '#fff',
                border: '3px solid #2C2C2C',
                boxShadow: '4px 4px 0 #2C2C2C',
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 12,
                cursor: generating ? 'wait' : 'pointer',
              }}
            >
              {generating
                ? 'GENERATING... (~15s)'
                : (status.musicQuotaUsed ?? 0) >= (status.musicQuotaTotal ?? 0)
                  ? 'WEEKLY QUOTA EXHAUSTED'
                  : '♪ GENERATE TRACK'}
            </button>

            {genError && (
              <div
                style={{
                  color: '#CC0000',
                  marginTop: 12,
                  fontFamily: 'monospace',
                  fontSize: 13,
                }}
              >
                ERROR: {genError}
              </div>
            )}

            {lastTrack && lastTrack.audioUrlMp3 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  ✓ NEW TRACK: {lastTrack.title}
                </div>
                <audio
                  src={lastTrack.audioUrlMp3}
                  controls
                  style={{ width: '100%' }}
                />
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: '#666',
                    marginTop: 6,
                  }}
                >
                  Now playing on /radio rotation
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
