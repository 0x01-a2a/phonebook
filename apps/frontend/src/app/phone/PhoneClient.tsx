'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConversation } from '@elevenlabs/react';

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

type CallMode = 'dial' | 'browser';
type BrowserCallState = 'idle' | 'requesting_mic' | 'connecting' | 'connected' | 'ended' | 'error';

interface AgentInfo {
  id: string;
  name: string;
  phoneNumber: string;
  categories: string[];
  status: string;
  voiceEnabled?: boolean;
  description?: string;
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
  const [mode, setMode] = useState<CallMode>('browser');
  const [digits, setDigits] = useState('');
  const [browserState, setBrowserState] = useState<BrowserCallState>('idle');
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState('');
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [voiceAgents, setVoiceAgents] = useState<AgentInfo[]>([]);
  const [lookupAgent, setLookupAgent] = useState<AgentInfo | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      setBrowserState('connected');
      setCallDuration(0);
      timerRef.current = setInterval(() => setCallDuration((t) => t + 1), 1000);
    },
    onDisconnect: () => {
      setBrowserState('ended');
      if (timerRef.current) clearInterval(timerRef.current);
    },
    onError: (err) => {
      console.error('[Voice] Error:', err);
      setBrowserState('error');
      setError('VOICE CONNECTION FAILED');
      if (timerRef.current) clearInterval(timerRef.current);
    },
  });

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }, []);

  // Load voice-enabled agents for quick dial
  useEffect(() => {
    fetch(`${API}/api/agents?limit=20&sortBy=reputationScore`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.data || data.agents || [];
        setVoiceAgents(list.filter((a: AgentInfo) => a.voiceEnabled));
      })
      .catch(() => {});
  }, []);

  // ── DIAL PAD LOGIC ──

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
    setSelectedAgent(null);
    setLookupAgent(null);
    setBrowserState('idle');
    setCallDuration(0);
    setError('');
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // Lookup agent when 8 digits entered
  useEffect(() => {
    if (digits.length !== 8) {
      setLookupAgent(null);
      return;
    }
    const phoneNumber = `+1-0x01-${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
    fetch(`${API}/api/voice/lookup?number=${encodeURIComponent(phoneNumber)}`)
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then((data) => {
        if (data && data.id) setLookupAgent(data);
      })
      .catch(() => setLookupAgent(null));
  }, [digits]);

  // ── BROWSER CALL (ElevenLabs) ──

  const startBrowserCall = useCallback(async (agent: AgentInfo) => {
    setSelectedAgent(agent);
    setBrowserState('requesting_mic');
    setError('');
    setCallDuration(0);

    try {
      // Request mic permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      setBrowserState('connecting');

      // Get ElevenLabs agent ID from our backend
      const res = await fetch(`${API}/api/voice/connect/${agent.id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Agent voice not available');
      }
      const { elevenlabsAgentId } = await res.json();

      // Start ElevenLabs conversation
      await conversation.startSession({ agentId: elevenlabsAgentId, connectionType: 'websocket' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      console.error('[Voice] Call failed:', msg);
      setBrowserState('error');
      setError(msg.toUpperCase());
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [conversation]);

  const endBrowserCall = useCallback(async () => {
    try {
      await conversation.endSession();
    } catch {
      // already disconnected
    }
    setBrowserState('ended');
    if (timerRef.current) clearInterval(timerRef.current);
  }, [conversation]);

  const dialFromPad = useCallback(() => {
    if (digits.length !== 8) {
      setError('ENTER 8 DIGIT EXTENSION');
      return;
    }
    if (mode === 'browser' && lookupAgent) {
      startBrowserCall(lookupAgent);
    } else if (mode === 'dial') {
      // Redirect to tel: for traditional phone call
      window.location.href = `tel:${TWILIO_NUMBER}`;
    }
  }, [digits, mode, lookupAgent, startBrowserCall]);

  const quickDial = useCallback((agent: AgentInfo) => {
    const ext = agent.phoneNumber?.match(/\+1-0x01-(\d{4})-(\d{4})/);
    if (ext) setDigits(ext[1] + ext[2]);

    if (mode === 'browser') {
      startBrowserCall(agent);
    }
  }, [mode, startBrowserCall]);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (browserState === 'connecting' || browserState === 'connected' || browserState === 'requesting_mic') return;
      if (e.key >= '0' && e.key <= '9') addDigit(e.key);
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Enter' && digits.length === 8) dialFromPad();
      else if (e.key === 'Escape') clearAll();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [browserState, addDigit, backspace, digits, dialFromPad, clearAll]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatExtension = (d: string) => {
    if (d.length <= 4) return d;
    return d.slice(0, 4) + '-' + d.slice(4);
  };

  const isActive = browserState === 'requesting_mic' || browserState === 'connecting' || browserState === 'connected';

  const statusColor = browserState === 'connected' ? PX.green
    : browserState === 'connecting' || browserState === 'requesting_mic' ? PX.blue
    : browserState === 'error' ? PX.red
    : PX.grayLight;

  const statusText = browserState === 'idle' ? 'READY'
    : browserState === 'requesting_mic' ? 'MIC ACCESS...'
    : browserState === 'connecting' ? 'CONNECTING...'
    : browserState === 'connected' ? `LIVE ${formatDuration(callDuration)}`
    : browserState === 'ended' ? `CALL ENDED ${formatDuration(callDuration)}`
    : 'ERROR';

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
          TALK TO AI AGENTS — LIVE VOICE
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
        <span style={{ flex: 1 }} />
        {/* Mode toggle */}
        <button
          onClick={() => setMode(mode === 'browser' ? 'dial' : 'browser')}
          disabled={isActive}
          style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '0.35rem',
            padding: '3px 8px',
            background: mode === 'browser' ? PX.green : PX.blue,
            color: PX.black,
            cursor: isActive ? 'not-allowed' : 'pointer',
            border: 'none',
            letterSpacing: '0.05em',
            lineHeight: 1.8,
          }}
        >
          {mode === 'browser' ? 'WEB CALL' : 'PHONE CALL'}
        </button>
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

        {/* ── ACTIVE CALL DISPLAY ── */}
        {isActive && selectedAgent && (
          <div style={{
            width: '100%',
            background: PX.black,
            padding: '1.5rem 1rem',
            ...pixelBorder(PX.green, 3),
            textAlign: 'center',
          }}>
            {/* Pulsing orb */}
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: browserState === 'connected'
                ? `radial-gradient(circle, ${PX.green}, ${PX.greenDark})`
                : `radial-gradient(circle, ${PX.blue}, ${PX.blueDark})`,
              margin: '0 auto 16px',
              animation: browserState === 'connected' ? 'pulse 2s ease-in-out infinite' : 'pulse 1s ease-in-out infinite',
              boxShadow: browserState === 'connected'
                ? `0 0 20px ${PX.green}40`
                : `0 0 20px ${PX.blue}40`,
            }} />

            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.6rem',
              color: PX.green,
              marginBottom: 4,
            }}>
              {selectedAgent.name}
            </div>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.35rem',
              color: statusColor,
              letterSpacing: '0.1em',
              marginBottom: 16,
            }}>
              {statusText}
            </div>

            {conversation.isSpeaking && (
              <div style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.3rem',
                color: PX.blue,
                letterSpacing: '0.1em',
                marginBottom: 12,
              }}>
                AGENT IS SPEAKING...
              </div>
            )}

            <button
              onClick={endBrowserCall}
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.5rem',
                padding: '10px 32px',
                background: PX.red,
                color: PX.white,
                cursor: 'pointer',
                ...pixelBorder(PX.redDark, 2),
                lineHeight: 1.8,
              }}
            >
              HANG UP
            </button>
          </div>
        )}

        {/* ── PHONE DISPLAY (when not in active call) ── */}
        {!isActive && (
          <>
            <div style={{
              width: '100%',
              background: PX.black,
              padding: '1rem',
              ...pixelBorder(PX.border, 3),
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
                <span style={{ color: statusColor }}>{statusText}</span>
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
                      <span style={{ color: PX.grayLight, animation: 'blink 1s step-end infinite' }}>_</span>
                    )}
                  </span>
                ) : (
                  <span style={{ color: PX.grayLight, fontSize: '0.5em' }}>
                    ENTER EXTENSION...
                  </span>
                )}
              </div>

              {/* Agent info preview */}
              {lookupAgent && (
                <div style={{
                  marginTop: 8,
                  padding: '6px 8px',
                  background: lookupAgent.voiceEnabled ? 'rgba(0,204,68,0.1)' : 'rgba(204,0,0,0.1)',
                  border: `1px solid ${lookupAgent.voiceEnabled ? PX.green : PX.red}`,
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '0.35rem',
                  color: lookupAgent.voiceEnabled ? PX.green : PX.red,
                  display: 'flex',
                  justifyContent: 'space-between',
                  letterSpacing: '0.05em',
                  lineHeight: 1.8,
                }}>
                  <span>&gt; {lookupAgent.name}</span>
                  <span>{lookupAgent.voiceEnabled ? 'VOICE ON' : 'NO VOICE'}</span>
                </div>
              )}

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
                    disabled={digits.length >= 8}
                    style={{
                      fontFamily: 'var(--font-pixel)',
                      fontSize: 'clamp(0.6rem, 3vw, 0.9rem)',
                      padding: 'clamp(8px, 2vw, 14px)',
                      background: pressedKey === key ? PX.green
                        : digits.length >= 8 ? PX.gray
                        : PX.black,
                      color: pressedKey === key ? PX.black
                        : digits.length >= 8 ? PX.grayLight
                        : PX.white,
                      cursor: digits.length >= 8 ? 'not-allowed' : 'pointer',
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
                      {key === '1' ? '' : key === '2' ? 'ABC' : key === '3' ? 'DEF' :
                       key === '4' ? 'GHI' : key === '5' ? 'JKL' : key === '6' ? 'MNO' :
                       key === '7' ? 'PQRS' : key === '8' ? 'TUV' : key === '9' ? 'WXYZ' :
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
                <button
                  onClick={backspace}
                  disabled={digits.length === 0}
                  style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '0.4rem',
                    padding: '10px',
                    background: PX.black,
                    color: digits.length > 0 ? PX.white : PX.grayLight,
                    cursor: digits.length === 0 ? 'not-allowed' : 'pointer',
                    ...pixelBorder(PX.gray, 2),
                    lineHeight: 1.8,
                  }}
                >
                  &lt;DEL
                </button>

                <button
                  onClick={dialFromPad}
                  disabled={digits.length !== 8 || (mode === 'browser' && !lookupAgent?.voiceEnabled)}
                  style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '0.4rem',
                    padding: '10px',
                    background: digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? PX.green : PX.gray,
                    color: digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? PX.black : PX.grayLight,
                    cursor: digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? 'pointer' : 'not-allowed',
                    ...pixelBorder(
                      digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? PX.greenDark : PX.grayLight,
                      2,
                    ),
                    lineHeight: 1.8,
                  }}
                >
                  {mode === 'browser' ? 'CALL' : 'DIAL'}
                </button>

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
          </>
        )}

        {/* ── VOICE AGENTS LIST ── */}
        {!isActive && voiceAgents.length > 0 && (
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
              {mode === 'browser' ? 'CLICK TO CALL' : 'QUICK DIAL'}
            </div>
            {voiceAgents.map((a) => {
              const ext = a.phoneNumber?.match(/\+1-0x01-(\d{4})-(\d{4})/);
              if (!ext) return null;
              const extStr = ext[1] + '-' + ext[2];
              const extDigits = ext[1] + ext[2];
              const isSelected = digits === extDigits;
              return (
                <div
                  key={a.id}
                  onClick={() => quickDial(a)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '5px 6px',
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '0.32rem',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(0,204,68,0.15)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    lineHeight: 2.2,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: a.status === 'online' ? PX.green : PX.red,
                      display: 'inline-block',
                      flexShrink: 0,
                    }} />
                    <span style={{ color: isSelected ? PX.green : PX.white }}>
                      {a.name}
                    </span>
                  </span>
                  <span style={{ color: PX.blue, letterSpacing: '0.08em' }}>
                    {extStr}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── INFO BOX ── */}
        {!isActive && (
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
            {mode === 'browser' ? (
              <>
                <div style={{ color: PX.green, letterSpacing: '0.1em', marginBottom: 4 }}>WEB CALL MODE</div>
                <div>1. SELECT AGENT OR ENTER EXTENSION</div>
                <div>2. PRESS <span style={{ color: PX.green }}>CALL</span> — ALLOW MIC</div>
                <div>3. TALK LIVE — AGENT HEARS YOU</div>
                <div style={{ marginTop: 8, color: PX.grayLight, fontSize: '0.25rem' }}>
                  FREE — VOICE VIA BROWSER. NO PHONE NEEDED.
                </div>
              </>
            ) : (
              <>
                <div style={{ color: PX.blue, letterSpacing: '0.1em', marginBottom: 4 }}>PHONE CALL MODE</div>
                <div>1. ENTER 8 DIGIT EXTENSION</div>
                <div>2. PRESS <span style={{ color: PX.green }}>DIAL</span> TO CALL {TWILIO_NUMBER}</div>
                <div>3. ENTER EXTENSION ON YOUR PHONE KEYPAD</div>
                <div style={{ marginTop: 8, color: PX.grayLight, fontSize: '0.25rem' }}>
                  STANDARD PHONE RATES APPLY.
                </div>
              </>
            )}
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

      <style>{`
        @keyframes blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
