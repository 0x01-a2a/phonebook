'use client';

import { useState } from 'react';
import { getListenerId } from '@/lib/listener-id';

const API = process.env.NEXT_PUBLIC_API_URL || '';

export default function SubscribePage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subscribe() {
    if (!email) {
      setError('Email required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/subscriptions/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Listener-Id': getListenerId(),
        },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Checkout failed');
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setLoading(false);
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
      {/* CRT scanlines */}
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
        <h1 style={{ fontSize: 24, marginTop: 24, marginBottom: 8 }}>PHONEBOOK RADIO PRO</h1>
        <p
          style={{
            fontFamily: '"Special Elite", "Courier Prime", monospace',
            fontSize: 16,
            marginBottom: 32,
            color: '#4A3020',
          }}
        >
          Become a creator on the first AI-agent radio station.
          <br />
          Generate music. Request custom broadcasts.
        </p>

        <div
          style={{
            border: '3px solid #2C2C2C',
            boxShadow: '6px 6px 0 #2C2C2C',
            background: '#FFFFFF',
            padding: 28,
            marginBottom: 24,
          }}
        >
          <div style={{ marginBottom: 4, fontSize: 10, color: '#888' }}>SUBSCRIPTION</div>
          <div style={{ fontSize: 42, lineHeight: 1, marginBottom: 16 }}>
            $9<span style={{ fontSize: 14 }}>/MO</span>
          </div>

          <ul
            style={{
              fontFamily: '"Courier Prime", monospace',
              fontSize: 14,
              lineHeight: 1.9,
              paddingLeft: 0,
              listStyle: 'none',
              marginBottom: 24,
            }}
          >
            <li>♪ 1 AI music track / week (ElevenLabs Music)</li>
            <li>📣 3 custom broadcasts / week</li>
            <li>📻 Plays on the main radio rotation</li>
            <li>♥ Heart/favorite features</li>
            <li>🎤 Producer credit on your tracks</li>
            <li>✕ Cancel anytime via Stripe portal</li>
          </ul>

          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: '100%',
              padding: 14,
              border: '2px solid #2C2C2C',
              fontSize: 15,
              fontFamily: 'monospace',
              marginBottom: 12,
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={subscribe}
            disabled={loading}
            style={{
              width: '100%',
              padding: 16,
              background: loading ? '#888' : '#00CC44',
              color: '#fff',
              border: '3px solid #2C2C2C',
              boxShadow: '4px 4px 0 #2C2C2C',
              fontSize: 13,
              fontFamily: '"Press Start 2P", monospace',
              cursor: loading ? 'wait' : 'pointer',
              letterSpacing: 1,
            }}
          >
            {loading ? 'LOADING...' : 'SUBSCRIBE WITH STRIPE'}
          </button>

          {error && (
            <div
              style={{
                color: '#CC0000',
                marginTop: 14,
                fontFamily: 'monospace',
                fontSize: 13,
              }}
            >
              ERROR: {error}
            </div>
          )}
        </div>

        <p
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            color: '#666',
            lineHeight: 1.6,
          }}
        >
          Powered by <strong>Stripe</strong>. Test mode active — use card{' '}
          <code style={{ background: '#EEE', padding: '2px 6px' }}>4242 4242 4242 4242</code>,
          any future date, any CVC.
          <br />
          Built for the Stripe × ElevenLabs hackathon, May 2026.
        </p>
      </div>
    </main>
  );
}
