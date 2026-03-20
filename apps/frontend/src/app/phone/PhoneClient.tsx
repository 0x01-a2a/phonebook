'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/* ── Pixel art palette (matches logo) ── */
const PX = {
  bg: '#F5E6C8',
  green: '#00CC44',
  greenDark: '#009933',
  blue: '#0066FF',
  blueDark: '#0044AA',
  black: '#1A1A1A',
  gray: '#4A4A4A',
  grayLight: '#8B8B8B',
  white: '#F0F0E8',
  red: '#CC0000',
  redDark: '#990000',
  border: '#2C2C2C',
};

const TWILIO_NUMBER = process.env.NEXT_PUBLIC_TWILIO_PHONE_NUMBER || '+13854756347';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const pixelBorder = (color = PX.border, width = 3) => ({
  border: `${width}px solid ${color}`,
  boxShadow: `${width}px ${width}px 0px ${color}`,
});

type CallState = 'idle' | 'dialing' | 'connecting' | 'connected' | 'ended' | 'error';

interface AgentInfo {
  id: string;
  name: string;
  phoneNumber: string;
  category: string;
  status: string;
}

/* ── Dial tone sound via Web Audio ── */
function playDTMFTone(ctx: AudioContext, digit: string) {
  const freqMap: Record<string, [number, number]> = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
    '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
  };
  const [f1, f2] = freqMap[digit] || [440, 480];
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  osc1.frequency.value = f1;
  osc2.frequency.value = f2;
  gain.gain.value = 0.08;
  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);
  osc1.start();
  osc2.start();
  osc1.stop(ctx.currentTime + 0.12);
  osc2.stop(ctx.currentTime + 0.12);
}

export default function PhoneClient() {
  const [digits, setDigits] = useState('');
  const [callState, setCallState] = useState<CallState>('idle');
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState('');
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [recentAgents, setRecentAgents] = useState<AgentInfo[]>([]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }, []);

  // Load some agents for the directory sidebar
  useEffect(() => {
    fetch(`${API}/api/agents?limit=6&sortBy=reputationScore`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRecentAgents(data.slice(0, 6));
        else if (data.agents) setRecentAgents(data.agents.slice(0, 6));
      })
      .catch(() => {});
  }, []);

  const addDigit = useCallback((d: string) => {
    if (digits.length >= 8) return;
    playDTMFTone(getAudioCtx(), d);
    setPressedKey(d);
    setTimeout(() => setPressedKey(null), 120);
    setDigits((prev) => prev + d);
    setError('');
  }, [digits, getAudioCtx]);

  const backspace = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1));
    setError('');
  }, []);

  const clearAll = useCallback(() => {
    setDigits('');
    setAgent(null);
    setCallState('idle');
    setCallDuration(0);
    setError('');
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // Lookup agent when 8 digits entered
  useEffect(() => {
    if (digits.length !== 8) {
      setAgent(null);
      return;
    }
    const phoneNumber = `+1-0x01-${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
    fetch(`${API}/api/search?q=${encodeURIComponent(phoneNumber)}`)
      .then((r) => r.json())
      .then((data) => {
        const agents = Array.isArray(data) ? data : data.agents || [];
        const found = agents.find((a: AgentInfo) => a.phoneNumber === phoneNumber);
        if (found) setAgent(found);
      })
      .catch(() => {});
  }, [digits]);

  const dial = useCallback(() => {
    if (digits.length !== 8) {
      setError('ENTER 8 DIGIT EXTENSION');
      return;
    }

    setCallState('dialing');
    setError('');

    // Simulate dial → connect sequence
    // In production, this would use Twilio Client SDK for browser-based calls
    setTimeout(() => {
      setCallState('connecting');
      setTimeout(() => {
        setCallState('connected');
        setCallDuration(0);
        timerRef.current = setInterval(() => {
          setCallDuration((t) => t + 1);
        }, 1000);
      }, 2000);
    }, 1500);
  }, [digits]);

  const hangUp = useCallback(() => {
    setCallState('ended');
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const quickDial = useCallback((phone: string) => {
    // Extract digits from +1-0x01-XXXX-XXXX
    const match = phone.match(/\+1-0x01-(\d{4})-(\d{4})/);
    if (match) {
      setDigits(match[1] + match[2]);
      setCallState('idle');
      setCallDuration(0);
      setError('');
    }
  }, []);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (callState !== 'idle' && callState !== 'ended' && callState !== 'error') return;
      if (e.key >= '0' && e.key <= '9') addDigit(e.key);
      else if (e.key === '*') addDigit('*');
      else if (e.key === '#') addDigit('#');
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Enter' && digits.length === 8) dial();
      else if (e.key === 'Escape') clearAll();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [callState, addDigit, backspace, digits, dial, clearAll]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatExtension = (d: string) => {
    if (d.length <= 4) return d;
    return d.slice(0, 4) + '-' + d.slice(4);
  };

  const isActive = callState === 'dialing' || callState === 'connecting' || callState === 'connected';

  return (
    <div style={{
      minHeight: '100vh',
      background: PX.bg,
      display: 'flex',
      flexDirection: 'column',
      imageRendering: 'pixelated',
    }}>
      {/* ── HEADER ── */}
      <header style={{
        textAlign: 'center',
        padding: '1.5rem 1rem 1rem',
        borderBottom: `4px solid ${PX.black}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ height: 3, width: 80, background: PX.green }} />
          <div style={{ height: 3, width: 80, background: PX.blue }} />
        </div>
        <h1 style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: 'clamp(0.9rem, 2.5vw, 1.4rem)',
          color: PX.black,
          margin: 0,
          letterSpacing: '0.05em',
          lineHeight: 1.6,
        }}>
          <span style={{ color: PX.greenDark }}>Phone</span>
          <span style={{ color: PX.blueDark }}>Book</span>
          {' '}
          <span style={{ color: PX.gray }}>Call</span>
        </h1>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.5rem',
          color: PX.grayLight,
          marginTop: 6,
          letterSpacing: '0.1em',
        }}>
          DIAL AN AI AGENT EXTENSION
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
          <div style={{ height: 3, width: 80, background: PX.blue }} />
          <div style={{ height: 3, width: 80, background: PX.green }} />
        </div>
      </header>

      {/* ── NAV ── */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        padding: '0.5rem 1rem',
        fontFamily: 'var(--font-pixel)',
        fontSize: '0.45rem',
        borderBottom: `2px solid ${PX.border}`,
        background: 'rgba(0,0,0,0.03)',
        alignItems: 'center',
      }}>
        <a href="/" style={{ textDecoration: 'none', color: PX.greenDark }}>&lt; DIRECTORY</a>
        <span style={{ color: PX.grayLight }}>|</span>
        <a href="/radio" style={{ textDecoration: 'none', color: PX.blueDark }}>RADIO</a>
        <span style={{ color: PX.grayLight }}>|</span>
        <a href="/activity" style={{ textDecoration: 'none', color: PX.blueDark }}>ACTIVITY</a>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1.5rem 1rem',
        gap: '1rem',
        maxWidth: 480,
        margin: '0 auto',
        width: '100%',
      }}>
        {/* ── PHONE DISPLAY ── */}
        <div style={{
          width: '100%',
          background: PX.black,
          padding: '1rem',
          ...pixelBorder(isActive ? PX.green : PX.border, 3),
          transition: 'box-shadow 0.3s',
        }}>
          {/* Status bar */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
            fontFamily: 'var(--font-pixel)',
            fontSize: '0.35rem',
            letterSpacing: '0.1em',
          }}>
            <span style={{ color: PX.grayLight }}>EXTENSION</span>
            <span style={{
              color: callState === 'connected' ? PX.green
                : callState === 'dialing' || callState === 'connecting' ? PX.blue
                : callState === 'error' ? PX.red
                : PX.grayLight,
            }}>
              {callState === 'idle' ? 'READY' :
               callState === 'dialing' ? 'DIALING...' :
               callState === 'connecting' ? 'CONNECTING...' :
               callState === 'connected' ? `CONNECTED ${formatDuration(callDuration)}` :
               callState === 'ended' ? `CALL ENDED ${formatDuration(callDuration)}` :
               'ERROR'}
            </span>
          </div>

          {/* Number display */}
          <div style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: 'clamp(1rem, 5vw, 1.6rem)',
            color: digits.length === 8 ? PX.green : PX.white,
            textAlign: 'center',
            padding: '0.75rem 0',
            letterSpacing: '0.15em',
            minHeight: '3rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: `2px solid ${PX.gray}`,
            borderTop: `2px solid ${PX.gray}`,
          }}>
            {digits.length > 0 ? (
              <span>
                <span style={{ color: PX.grayLight, fontSize: '0.6em' }}>0x01-</span>
                {formatExtension(digits)}
                {digits.length < 8 && (
                  <span style={{
                    color: PX.grayLight,
                    animation: 'blink 1s step-end infinite',
                  }}>_</span>
                )}
              </span>
            ) : (
              <span style={{ color: PX.grayLight, fontSize: '0.5em' }}>
                ENTER EXTENSION...
              </span>
            )}
          </div>

          {/* Agent info preview */}
          {agent && (
            <div style={{
              marginTop: 8,
              padding: '6px 8px',
              background: 'rgba(0,204,68,0.1)',
              border: `1px solid ${PX.green}`,
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.35rem',
              color: PX.green,
              display: 'flex',
              justifyContent: 'space-between',
              letterSpacing: '0.05em',
              lineHeight: 1.8,
            }}>
              <span>&gt; {agent.name}</span>
              <span style={{ color: PX.blue }}>{agent.category || 'AGENT'}</span>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div style={{
              marginTop: 8,
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.35rem',
              color: PX.red,
              textAlign: 'center',
              letterSpacing: '0.05em',
            }}>
              ! {error}
            </div>
          )}
        </div>

        {/* ── DIAL PAD ── */}
        <div style={{
          width: '100%',
          background: PX.black,
          padding: '1rem',
          ...pixelBorder(PX.border, 3),
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
          }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((key) => (
              <button
                key={key}
                onClick={() => addDigit(key)}
                disabled={isActive || digits.length >= 8}
                style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: 'clamp(0.6rem, 3vw, 0.9rem)',
                  padding: 'clamp(8px, 2vw, 14px)',
                  background: pressedKey === key ? PX.green
                    : (isActive || digits.length >= 8) ? PX.gray
                    : PX.black,
                  color: pressedKey === key ? PX.black
                    : (isActive || digits.length >= 8) ? PX.grayLight
                    : PX.white,
                  cursor: (isActive || digits.length >= 8) ? 'not-allowed' : 'pointer',
                  ...pixelBorder(pressedKey === key ? PX.greenDark : PX.gray, 2),
                  transition: 'background 0.05s, color 0.05s',
                  lineHeight: 1.5,
                }}
              >
                {key}
                <div style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '0.25rem',
                  color: PX.grayLight,
                  marginTop: 2,
                  letterSpacing: '0.1em',
                }}>
                  {key === '1' ? '' :
                   key === '2' ? 'ABC' :
                   key === '3' ? 'DEF' :
                   key === '4' ? 'GHI' :
                   key === '5' ? 'JKL' :
                   key === '6' ? 'MNO' :
                   key === '7' ? 'PQRS' :
                   key === '8' ? 'TUV' :
                   key === '9' ? 'WXYZ' :
                   key === '0' ? '+' : ''}
                </div>
              </button>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 8,
            marginTop: 8,
          }}>
            {/* Backspace */}
            <button
              onClick={backspace}
              disabled={isActive || digits.length === 0}
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.4rem',
                padding: '10px',
                background: PX.black,
                color: digits.length > 0 && !isActive ? PX.white : PX.grayLight,
                cursor: (isActive || digits.length === 0) ? 'not-allowed' : 'pointer',
                ...pixelBorder(PX.gray, 2),
                lineHeight: 1.8,
              }}
            >
              &lt;DEL
            </button>

            {/* Call / Hang up */}
            {!isActive ? (
              <button
                onClick={dial}
                disabled={digits.length !== 8}
                style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '0.4rem',
                  padding: '10px',
                  background: digits.length === 8 ? PX.green : PX.gray,
                  color: digits.length === 8 ? PX.black : PX.grayLight,
                  cursor: digits.length === 8 ? 'pointer' : 'not-allowed',
                  ...pixelBorder(digits.length === 8 ? PX.greenDark : PX.grayLight, 2),
                  lineHeight: 1.8,
                }}
              >
                CALL
              </button>
            ) : (
              <button
                onClick={hangUp}
                style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '0.4rem',
                  padding: '10px',
                  background: PX.red,
                  color: PX.white,
                  cursor: 'pointer',
                  ...pixelBorder(PX.redDark, 2),
                  lineHeight: 1.8,
                }}
              >
                HANG UP
              </button>
            )}

            {/* Clear */}
            <button
              onClick={clearAll}
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.4rem',
                padding: '10px',
                background: PX.black,
                color: PX.white,
                cursor: 'pointer',
                ...pixelBorder(PX.gray, 2),
                lineHeight: 1.8,
              }}
            >
              CLEAR
            </button>
          </div>
        </div>

        {/* ── CALL INFO BOX ── */}
        <div style={{
          width: '100%',
          padding: '0.75rem',
          background: 'rgba(0,0,0,0.04)',
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.3rem',
          color: PX.gray,
          lineHeight: 2.2,
          ...pixelBorder(PX.grayLight, 2),
        }}>
          <div style={{ color: PX.grayLight, letterSpacing: '0.1em', marginBottom: 4 }}>HOW TO CALL</div>
          <div>1. FIND AGENT EXTENSION IN DIRECTORY</div>
          <div>2. ENTER 8 DIGITS ON THE DIAL PAD</div>
          <div>3. PRESS <span style={{ color: PX.green }}>CALL</span> TO CONNECT</div>
          <div style={{ marginTop: 8, color: PX.grayLight, letterSpacing: '0.1em' }}>
            OR CALL DIRECTLY: <span style={{ color: PX.blue }}>{TWILIO_NUMBER}</span>
          </div>
          <div style={{ color: PX.grayLight }}>
            ENTER EXTENSION VIA PHONE KEYPAD (DTMF)
          </div>
        </div>

        {/* ── QUICK DIAL / AGENT DIRECTORY ── */}
        {recentAgents.length > 0 && (
          <div style={{
            width: '100%',
            ...pixelBorder(PX.border, 2),
            background: PX.black,
            padding: '0.75rem',
          }}>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.35rem',
              color: PX.grayLight,
              letterSpacing: '0.1em',
              marginBottom: 8,
            }}>
              QUICK DIAL
            </div>
            {recentAgents.map((a) => {
              const ext = a.phoneNumber?.match(/\+1-0x01-(\d{4})-(\d{4})/);
              if (!ext) return null;
              const extStr = ext[1] + '-' + ext[2];
              const isSelected = digits === ext[1] + ext[2];
              return (
                <div
                  key={a.id}
                  onClick={() => !isActive && quickDial(a.phoneNumber)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 6px',
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '0.3rem',
                    cursor: isActive ? 'not-allowed' : 'pointer',
                    background: isSelected ? 'rgba(0,204,68,0.15)' : 'transparent',
                    borderBottom: `1px solid rgba(255,255,255,0.05)`,
                    lineHeight: 2.2,
                  }}
                >
                  <span style={{ color: isSelected ? PX.green : PX.white }}>
                    {a.name}
                  </span>
                  <span style={{ color: PX.blue, letterSpacing: '0.08em' }}>
                    {extStr}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── FOOTER ── */}
      <footer style={{
        padding: '0.5rem 1rem',
        borderTop: `3px solid ${PX.black}`,
        fontFamily: 'var(--font-pixel)',
        fontSize: '0.35rem',
        color: PX.grayLight,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        lineHeight: 2,
      }}>
        <span>
          <span style={{ color: PX.greenDark }}>PHONE</span>
          <span style={{ color: PX.blueDark }}>BOOK</span>
          {' CALL // '}
          <span style={{ color: PX.blue }}>CENTRAL: {TWILIO_NUMBER}</span>
        </span>
        <a href="/" style={{ color: PX.grayLight, textDecoration: 'none' }}>&lt; BACK</a>
      </footer>

      {/* Blink cursor animation */}
      <style>{`
        @keyframes blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
