'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConversation } from '@elevenlabs/react';

/* ── Pixel art palette ── */
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

/* ── Nokia LCD palette ── */
const LCD = {
  bg: '#9BBC0F',
  dark: '#0F380F',
  mid: '#306230',
  light: '#8BAC0F',
};

const TWILIO_NUMBER = process.env.NEXT_PUBLIC_TWILIO_PHONE_NUMBER || '+13854756347';
const TWILIO_DISPLAY = '+1 (385) 475-6347';
const API = '';

const pixelBorder = (color = PX.border, width = 3) => ({
  border: `${width}px solid ${color}`,
  boxShadow: `${width}px ${width}px 0px ${color}`,
});

type CallMode = 'dial' | 'browser';
type BrowserCallState = 'idle' | 'requesting_mic' | 'connecting' | 'ringing' | 'connected' | 'ended' | 'error';
const MAX_CALL_SECONDS = 60;
type MobileTab = 'agents' | 'phone' | 'guide';

interface AgentInfo {
  id: string;
  name: string;
  phoneNumber: string;
  categories: string[];
  status: string;
  voiceEnabled?: boolean;
  description?: string;
  pixelBannerFrames?: number[][][] | { pixels: number[][]; duration: number }[];
}

const CGA_PALETTE = [
  '#000000', '#0000AA', '#00AA00', '#00AAAA',
  '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
  '#555555', '#5555FF', '#55FF55', '#55FFFF',
  '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF',
];

function PixelBanner({ frames }: { frames: number[][][] | { pixels: number[][]; duration: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frames?.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const normalized = (frames as unknown[]).map((raw) => {
      if (Array.isArray(raw) && Array.isArray((raw as number[][])[0]))
        return { pixels: raw as number[][], duration: 500 };
      return { pixels: (raw as { pixels: number[][] }).pixels, duration: (raw as { duration: number }).duration || 500 };
    }).filter(f => f.pixels?.length);
    if (!normalized.length) return;
    const pw = canvas.width / 40;
    const ph = canvas.height / 8;
    const drawFrame = (pixels: number[][]) => {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 40; x++) {
          const idx = pixels[y]?.[x] ?? 0;
          if (idx > 0) {
            ctx.fillStyle = CGA_PALETTE[idx] || '#000';
            ctx.fillRect(x * pw, y * ph, pw, ph);
          }
        }
      }
    };
    if (normalized.length === 1) { drawFrame(normalized[0].pixels); return; }
    let frameIdx = 0;
    drawFrame(normalized[0].pixels);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      frameIdx = (frameIdx + 1) % normalized.length;
      drawFrame(normalized[frameIdx].pixels);
      timer = setTimeout(tick, normalized[frameIdx].duration);
    };
    timer = setTimeout(tick, normalized[0].duration);
    return () => clearTimeout(timer);
  }, [frames]);
  return (
    <canvas ref={canvasRef} width={400} height={80}
      style={{ width: '100%', height: 'auto', imageRendering: 'pixelated', display: 'block', background: '#0a0a0a' }}
    />
  );
}

/* ── DTMF tone ── */
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

/* ── Phone ring tone (US standard: 440+480 Hz, 2s on / 4s off) ── */
function createRingTone(ctx: AudioContext): { stop: () => void } {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  osc1.frequency.value = 440;
  osc2.frequency.value = 480;
  gain.gain.value = 0;
  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);
  osc1.start();
  osc2.start();

  let t = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.setValueAtTime(0, t + 2);
    t += 3;
  }

  return {
    stop: () => {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.05);
      osc2.stop(ctx.currentTime + 0.05);
    },
  };
}

/* ── Nokia LCD Equalizer ── */
function NokiaEqualizer({ isSpeaking }: { isSpeaking: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const barsRef = useRef<number[]>(new Array(16).fill(1));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const BAR_COUNT = 16;
    const BAR_W = Math.floor(W / BAR_COUNT);
    const GAP = 1;
    const PXS = 2;

    const draw = () => {
      // LCD background
      ctx.fillStyle = LCD.bg;
      ctx.fillRect(0, 0, W, H);

      // Update bar heights
      for (let i = 0; i < BAR_COUNT; i++) {
        const target = isSpeaking
          ? 2 + Math.floor(Math.sin(Date.now() * 0.005 + i * 0.7) * 3 + Math.random() * 4)
          : Math.random() < 0.15 ? 2 : 1;
        barsRef.current[i] += (target - barsRef.current[i]) * 0.3;
      }

      // Draw bars
      ctx.fillStyle = LCD.dark;
      for (let i = 0; i < BAR_COUNT; i++) {
        const barH = Math.max(1, Math.round(barsRef.current[i]));
        const maxBlocks = Math.floor(H / (PXS + GAP));
        const blocks = Math.min(barH, maxBlocks);
        const x = i * BAR_W + GAP;
        for (let b = 0; b < blocks; b++) {
          const y = H - (b + 1) * (PXS + GAP);
          ctx.fillRect(x, y, BAR_W - GAP * 2, PXS);
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [isSpeaking]);

  return (
    <canvas
      ref={canvasRef}
      width={192}
      height={24}
      style={{ width: '100%', height: 'auto', imageRendering: 'pixelated', display: 'block' }}
    />
  );
}

/* ═══════════════════════════════════════════════ */
/* ═══════════  NOKIA STYLE HELPERS  ═══════════ */
/* ═══════════════════════════════════════════════ */

const NOKIA_BODY = '#2D3436';
const NOKIA_BODY_LIGHT = '#3D4446';
const NOKIA_BODY_EDGE = '#1A1D1E';
const NOKIA_KEY_BG = '#3D4446';
const NOKIA_KEY_PRESSED = '#555';

const lcdFont: React.CSSProperties = {
  fontFamily: 'var(--font-pixel)',
  color: LCD.dark,
};

/* ════════════════════════════════════════════ */
export default function PhoneClient() {
  const [mode, setMode] = useState<CallMode>('browser');
  const [digits, setDigits] = useState('');
  const [browserState, setBrowserState] = useState<BrowserCallState>('idle');
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [maxCallSeconds, setMaxCallSeconds] = useState(MAX_CALL_SECONDS);
  const [error, setError] = useState('');
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [voiceAgents, setVoiceAgents] = useState<AgentInfo[]>([]);
  const [allAgents, setAllAgents] = useState<AgentInfo[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [lookupAgent, setLookupAgent] = useState<AgentInfo | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('phone');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const ringRef = useRef<{ stop: () => void } | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      if (ringRef.current) { ringRef.current.stop(); ringRef.current = null; }
      setBrowserState('connected');
      setCallDuration(0);
      timerRef.current = setInterval(() => setCallDuration((t) => t + 1), 1000);
    },
    onDisconnect: () => {
      if (ringRef.current) { ringRef.current.stop(); ringRef.current = null; }
      setBrowserState('ended');
      if (timerRef.current) clearInterval(timerRef.current);
    },
    onError: (err) => {
      console.error('[Voice] Error:', err);
      if (ringRef.current) { ringRef.current.stop(); ringRef.current = null; }
      setBrowserState('error');
      setError('VOICE CONNECTION FAILED');
      if (timerRef.current) clearInterval(timerRef.current);
    },
  });

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }, []);

  useEffect(() => {
    fetch(`${API}/api/agents?limit=50&sortBy=reputationScore`)
      .then((r) => r.json())
      .then((data) => {
        const list: AgentInfo[] = Array.isArray(data) ? data : data.data || data.agents || [];
        setAllAgents(list.filter((a) => a.phoneNumber));
        setVoiceAgents(list.filter((a) => a.voiceEnabled));
      })
      .catch(() => {});
  }, []);

  /* ── DIAL PAD LOGIC ── */
  const addDigit = useCallback((d: string) => {
    if (digits.length >= 8) return;
    playDTMFTone(getAudioCtx(), d);
    setPressedKey(d);
    setTimeout(() => setPressedKey(null), 120);
    setDigits((prev) => prev + d);
    setError('');
  }, [digits, getAudioCtx]);

  const backspace = useCallback(() => { setDigits((prev) => prev.slice(0, -1)); setError(''); }, []);

  const clearAll = useCallback(() => {
    setDigits(''); setSelectedAgent(null); setLookupAgent(null);
    setBrowserState('idle'); setCallDuration(0); setError('');
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (digits.length !== 8) { setLookupAgent(null); return; }
    const phoneNumber = `+1-0x01-${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
    fetch(`${API}/api/voice/lookup?number=${encodeURIComponent(phoneNumber)}`)
      .then((r) => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then((data) => { if (data && data.id) setLookupAgent(data); })
      .catch(() => setLookupAgent(null));
  }, [digits]);

  /* ── Persistent caller ID for rate limiting ── */
  const getCallerId = useCallback((): string => {
    try {
      let id = localStorage.getItem('phonebook_caller_id');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('phonebook_caller_id', id);
      }
      return id;
    } catch { return 'unknown'; }
  }, []);

  /* ── Check ownership from localStorage ── */
  const getClaimToken = useCallback((agentId: string): string | null => {
    try {
      const stored = JSON.parse(localStorage.getItem('phonebook_my_agents') || '[]');
      const found = stored.find((a: { id: string; claimToken?: string }) => a.id === agentId);
      return found?.claimToken || null;
    } catch { return null; }
  }, []);

  /* ── BROWSER CALL ── */
  const startBrowserCall = useCallback(async (agent: AgentInfo) => {
    setSelectedAgent(agent); setBrowserState('requesting_mic'); setError(''); setCallDuration(0);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setBrowserState('connecting');

      // Build connect URL with callerId + optional claimToken for ownership
      const claimToken = getClaimToken(agent.id);
      const callerId = getCallerId();
      const params = new URLSearchParams({ callerId });
      if (claimToken) params.set('claimToken', claimToken);
      const connectUrl = `${API}/api/voice/connect/${agent.id}?${params.toString()}`;

      const res = await fetch(connectUrl);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.error === 'RATE_LIMITED') {
          const waitMin = Math.ceil((d.nextAvailableAt - Date.now()) / 60000);
          throw new Error(`LIMIT REACHED. NEXT CALL IN ${waitMin} MIN`);
        }
        throw new Error(d.error || 'Agent voice not available');
      }
      const data = await res.json();
      const { elevenlabsAgentId } = data;

      // Set max call seconds from backend (0 = unlimited for owners)
      const serverMax = data.maxSeconds ?? MAX_CALL_SECONDS;
      setMaxCallSeconds(serverMax === 0 ? 9999 : serverMax);

      // Play ringing tone while connecting
      setBrowserState('ringing');
      const ctx = getAudioCtx();
      ringRef.current = createRingTone(ctx);

      // Wait for 2 rings (~3s) then connect
      await new Promise((r) => setTimeout(r, 3000));

      await conversation.startSession({ agentId: elevenlabsAgentId, connectionType: 'websocket' });
    } catch (err) {
      if (ringRef.current) { ringRef.current.stop(); ringRef.current = null; }
      const msg = err instanceof Error ? err.message : 'Connection failed';
      console.error('[Voice] Call failed:', msg);
      setBrowserState('error'); setError(msg.toUpperCase());
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [conversation, getAudioCtx, getClaimToken, getCallerId]);

  const endBrowserCall = useCallback(async () => {
    if (ringRef.current) { ringRef.current.stop(); ringRef.current = null; }
    try { await conversation.endSession(); } catch {}
    setBrowserState('ended');
    if (timerRef.current) clearInterval(timerRef.current);
  }, [conversation]);

  // Auto-disconnect after maxCallSeconds
  useEffect(() => {
    if (browserState === 'connected' && maxCallSeconds < 9999 && callDuration >= maxCallSeconds) {
      endBrowserCall();
      setError(`CALL LIMIT ${maxCallSeconds}S REACHED`);
    }
  }, [browserState, callDuration, maxCallSeconds, endBrowserCall]);

  const dialFromPad = useCallback(() => {
    if (digits.length !== 8) { setError('ENTER 8 DIGIT EXTENSION'); return; }
    if (mode === 'browser' && lookupAgent) startBrowserCall(lookupAgent);
    else if (mode === 'dial') window.location.href = `tel:${TWILIO_NUMBER}`;
  }, [digits, mode, lookupAgent, startBrowserCall]);

  const selectAgent = useCallback((agent: AgentInfo) => {
    const ext = agent.phoneNumber?.match(/\+1-0x01-(\d{4})-(\d{4})/);
    if (ext) setDigits(ext[1] + ext[2]);
    setSelectedAgent(agent);
    setMobileTab('phone');
  }, []);

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

  const formatDuration = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  const formatExtension = (d: string) => d.length <= 4 ? d : d.slice(0, 4) + '-' + d.slice(4);

  const remaining = maxCallSeconds < 9999 ? maxCallSeconds - callDuration : 9999;
  const isActive = browserState === 'requesting_mic' || browserState === 'connecting' || browserState === 'ringing' || browserState === 'connected';
  const isUnlimited = maxCallSeconds >= 9999;

  // Selected agent extension for guide panel
  const selExt = selectedAgent?.phoneNumber?.match(/\+1-0x01-(\d{4})-(\d{4})/);
  const selExtStr = selExt ? `${selExt[1]}-${selExt[2]}` : digits.length === 8 ? formatExtension(digits) : null;

  /* ═══════ RENDER ═══════ */

  // ── PANEL: AGENTS (left / mobile tab 1) ──
  const agentsPanel = (showBanners: boolean) => (
    <div style={{ flex: showBanners ? '0 0 320px' : 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: showBanners ? 8 : 0 }}>
      <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.32rem', color: PX.grayLight, letterSpacing: '0.1em', textAlign: 'center', padding: '6px 0' }}>
        {mode === 'browser' ? 'CLICK TO CALL' : 'SELECT AGENT'} ({allAgents.length})
      </div>
      {allAgents.map((a) => {
        const ext = a.phoneNumber?.match(/\+1-0x01-(\d{4})-(\d{4})/);
        if (!ext) return null;
        const extStr = ext[1] + '-' + ext[2];
        const extDigits = ext[1] + ext[2];
        const isSel = digits === extDigits;
        const hasVoice = a.voiceEnabled;
        const isCopied = copied === a.id;

        if (!showBanners) {
          return (
            <div key={a.id} onClick={() => selectAgent(a)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', cursor: 'pointer',
              background: isSel ? 'rgba(0,204,68,0.12)' : 'transparent',
              borderBottom: `1px solid rgba(0,0,0,0.08)`,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: a.status === 'online' ? PX.green : a.status === 'busy' ? '#D4A853' : PX.red, flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.3rem', color: isSel ? PX.green : PX.black, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
              {hasVoice && <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.2rem', color: PX.green, flexShrink: 0 }}>VOICE</span>}
              <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.25rem', color: PX.blue, flexShrink: 0, letterSpacing: '0.03em' }}>
                {extStr}
              </span>
              {isCopied && <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.2rem', color: PX.blue }}>OK</span>}
            </div>
          );
        }

        return (
          <div key={a.id} onClick={() => selectAgent(a)} style={{
            background: PX.black, cursor: 'pointer', overflow: 'hidden',
            ...pixelBorder(isSel ? PX.green : isCopied ? PX.blue : PX.gray, 2),
          }}>
            {a.pixelBannerFrames?.length ? (
              <PixelBanner frames={a.pixelBannerFrames} />
            ) : (
              <div style={{ width: '100%', aspectRatio: '5/1', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-pixel)', fontSize: '0.25rem', color: '#333' }}>
                NO BANNER
              </div>
            )}
            <div style={{ padding: '6px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.status === 'online' ? PX.green : a.status === 'busy' ? '#D4A853' : PX.red, flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.3rem', color: isSel ? PX.green : PX.white, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                {hasVoice && <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.22rem', color: PX.green, flexShrink: 0 }}>VOICE</span>}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.28rem', color: PX.blue }}>+1-0x01-{extStr}</span>
                {isCopied && <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.22rem', color: PX.blue }}>COPIED!</span>}
              </div>
              {a.description && (
                <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.22rem', color: PX.grayLight, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.8 }}>
                  {a.description}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  /* ═══════════════════════════════════════════
     PANEL: NOKIA 3310 PHONE (center)
     ═══════════════════════════════════════════ */

  // ── LCD STATUS BAR ──
  const lcdStatusBar = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 6px', borderBottom: `1px solid ${LCD.mid}` }}>
      {/* Signal bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 10 }}>
        {[3, 5, 7, 9].map((h, i) => (
          <div key={i} style={{ width: 3, height: h, background: LCD.dark }} />
        ))}
      </div>
      {/* Title */}
      <span style={{ ...lcdFont, fontSize: '0.22rem', letterSpacing: '0.08em' }}>PhoneBook</span>
      {/* Battery */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <div style={{
          width: 14, height: 8,
          border: `1px solid ${LCD.dark}`,
          display: 'flex', alignItems: 'center', padding: 1, gap: 1,
        }}>
          <div style={{ width: 3, height: 4, background: LCD.dark }} />
          <div style={{ width: 3, height: 4, background: LCD.dark }} />
          <div style={{ width: 3, height: 4, background: LCD.dark }} />
        </div>
        <div style={{ width: 2, height: 4, background: LCD.dark }} />
      </div>
    </div>
  );

  // ── LCD CONTENT: IDLE ──
  const lcdIdle = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '6px 8px', gap: 6 }}>
      {/* Extension label */}
      <div style={{ ...lcdFont, fontSize: '0.2rem', letterSpacing: '0.1em', textAlign: 'center' }}>
        ENTER EXTENSION
      </div>
      {/* Digits display */}
      <div style={{
        ...lcdFont,
        fontSize: 'clamp(0.7rem, 4vw, 1.1rem)',
        textAlign: 'center',
        padding: '4px 0',
        minHeight: '1.6rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        letterSpacing: '0.12em',
      }}>
        {digits.length > 0 ? (
          <span>
            <span style={{ color: LCD.mid, fontSize: '0.6em' }}>0x01-</span>
            {formatExtension(digits)}
            {digits.length < 8 && <span className="lcd-blink">_</span>}
          </span>
        ) : (
          <span style={{ color: LCD.mid, fontSize: '0.45em' }}>________</span>
        )}
      </div>
      {/* Lookup result */}
      {lookupAgent && (
        <div style={{
          ...lcdFont, fontSize: '0.25rem', textAlign: 'center',
          padding: '3px 6px',
          border: `1px solid ${LCD.mid}`,
          letterSpacing: '0.05em', lineHeight: 1.8,
        }}>
          <div>&gt; {lookupAgent.name}</div>
          <div style={{ color: lookupAgent.voiceEnabled ? LCD.dark : LCD.mid }}>
            {lookupAgent.voiceEnabled ? 'VOICE READY' : 'NO VOICE'}
          </div>
        </div>
      )}
      {/* Error */}
      {error && (
        <div style={{ ...lcdFont, fontSize: '0.22rem', textAlign: 'center', letterSpacing: '0.05em' }} className="lcd-blink">
          ! {error}
        </div>
      )}
      {/* Status */}
      {browserState === 'ended' && (
        <div style={{ ...lcdFont, fontSize: '0.22rem', textAlign: 'center', color: LCD.mid }}>
          CALL ENDED {formatDuration(callDuration)}
        </div>
      )}
    </div>
  );

  // ── LCD CONTENT: ACTIVE CALL ──
  const lcdActiveCall = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4px 8px', gap: 4 }}>
      {/* Agent name */}
      <div style={{ ...lcdFont, fontSize: '0.35rem', textAlign: 'center', letterSpacing: '0.08em', lineHeight: 1.8 }}>
        {selectedAgent?.name || 'UNKNOWN'}
      </div>

      {/* Status line */}
      <div style={{ ...lcdFont, fontSize: '0.22rem', textAlign: 'center', letterSpacing: '0.1em' }}
        className={browserState === 'ringing' ? 'lcd-blink' : undefined}>
        {browserState === 'requesting_mic' ? 'MIC ACCESS...'
          : browserState === 'connecting' ? 'CONNECTING...'
          : browserState === 'ringing' ? 'RINGING...'
          : browserState === 'connected' ? 'CONNECTED' : ''}
      </div>

      {/* Timer (big) */}
      {browserState === 'connected' && (
        <div style={{
          ...lcdFont,
          fontSize: 'clamp(0.6rem, 3.5vw, 0.9rem)',
          textAlign: 'center',
          letterSpacing: '0.15em',
          padding: '2px 0',
        }}>
          {formatDuration(callDuration)}
          {!isUnlimited && (
            <span style={{ fontSize: '0.5em', color: LCD.mid }}> / {formatDuration(maxCallSeconds)}</span>
          )}
        </div>
      )}

      {/* Equalizer */}
      {browserState === 'connected' && (
        <div style={{ padding: '2px 12px' }}>
          <NokiaEqualizer isSpeaking={conversation.isSpeaking} />
        </div>
      )}

      {/* Speaking indicator */}
      {browserState === 'connected' && conversation.isSpeaking && (
        <div style={{ ...lcdFont, fontSize: '0.2rem', textAlign: 'center', letterSpacing: '0.08em' }}>
          AGENT SPEAKING...
        </div>
      )}

      {/* Remaining time warning */}
      {browserState === 'connected' && !isUnlimited && remaining <= 15 && (
        <div style={{ ...lcdFont, fontSize: '0.2rem', textAlign: 'center', letterSpacing: '0.05em' }}
          className={remaining <= 10 ? 'lcd-blink' : undefined}>
          {remaining <= 10 ? `! ENDING IN ${remaining}S` : `${remaining}S LEFT`}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ ...lcdFont, fontSize: '0.2rem', textAlign: 'center' }} className="lcd-blink">
          ! {error}
        </div>
      )}
    </div>
  );

  // ── LCD SOFTKEYS ──
  const lcdSoftkeys = (
    <div style={{
      display: 'flex', justifyContent: 'space-between', padding: '2px 8px',
      borderTop: `1px solid ${LCD.mid}`,
      ...lcdFont, fontSize: '0.2rem', letterSpacing: '0.05em',
      color: LCD.mid,
    }}>
      {isActive ? (
        <>
          <span>MUTE</span>
          <span>END</span>
        </>
      ) : (
        <>
          <span>{mode === 'browser' ? 'WEB' : 'PHONE'}</span>
          <span>MENU</span>
        </>
      )}
    </div>
  );

  // ── NOKIA KEYPAD BUTTON ──
  const nokiaKey = (key: string, label: string, onClick: () => void, disabled = false) => (
    <button
      key={key}
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: 'var(--font-pixel)',
        fontSize: 'clamp(0.5rem, 2.5vw, 0.75rem)',
        padding: 'clamp(6px, 1.5vw, 10px) 0',
        background: pressedKey === key ? NOKIA_KEY_PRESSED : NOKIA_KEY_BG,
        color: disabled ? '#555' : '#DDD',
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: `1px solid ${NOKIA_BODY_EDGE}`,
        borderRadius: 4,
        boxShadow: pressedKey === key ? 'inset 0 1px 3px rgba(0,0,0,0.4)' : '0 2px 0 #1A1D1E, inset 0 1px 0 rgba(255,255,255,0.06)',
        transition: 'background 0.05s',
        lineHeight: 1.3,
        textAlign: 'center',
      }}
    >
      {key}
      {label && <div style={{ fontSize: '0.2rem', color: '#888', marginTop: 1, letterSpacing: '0.08em' }}>{label}</div>}
    </button>
  );

  // ── FULL NOKIA PHONE ──
  const phonePanel = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 380, margin: '0 auto', width: '100%' }}>
      {/* Nokia body */}
      <div style={{
        width: '100%',
        background: `linear-gradient(180deg, ${NOKIA_BODY_LIGHT} 0%, ${NOKIA_BODY} 15%, ${NOKIA_BODY} 85%, ${NOKIA_BODY_EDGE} 100%)`,
        borderRadius: 20,
        padding: 'clamp(10px, 2vw, 16px)',
        boxShadow: `0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
        border: `2px solid ${NOKIA_BODY_EDGE}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 'clamp(6px, 1.5vw, 10px)',
      }}>
        {/* Brand */}
        <div style={{
          textAlign: 'center',
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.25rem',
          color: '#666',
          letterSpacing: '0.2em',
          padding: '2px 0',
        }}>
          PHONEBOOK
        </div>

        {/* LCD Screen */}
        <div style={{
          background: LCD.bg,
          borderRadius: 6,
          border: `3px solid ${NOKIA_BODY_EDGE}`,
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.2)',
          overflow: 'hidden',
          minHeight: 'clamp(120px, 25vw, 180px)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {lcdStatusBar}
          {isActive && selectedAgent ? lcdActiveCall : lcdIdle}
          {lcdSoftkeys}
        </div>

        {/* Navigation button (circular) */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '2px 0' }}>
          {/* Left softkey */}
          <button onClick={() => {
            if (isActive) { /* mute - future */ }
            else setMode(mode === 'browser' ? 'dial' : 'browser');
          }} style={{
            fontFamily: 'var(--font-pixel)', fontSize: '0.25rem', padding: '4px 12px',
            background: NOKIA_KEY_BG, color: '#AAA', border: `1px solid ${NOKIA_BODY_EDGE}`,
            borderRadius: 4, cursor: 'pointer',
            boxShadow: '0 2px 0 #1A1D1E',
          }}>
            {isActive ? 'MUTE' : mode === 'browser' ? 'WEB' : 'PHONE'}
          </button>

          {/* D-pad / center */}
          <div style={{
            width: 44, height: 44,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${NOKIA_KEY_PRESSED} 30%, ${NOKIA_KEY_BG} 70%)`,
            border: `2px solid ${NOKIA_BODY_EDGE}`,
            boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
          }} />

          {/* Right softkey */}
          <button onClick={() => {
            if (isActive) endBrowserCall();
            else clearAll();
          }} style={{
            fontFamily: 'var(--font-pixel)', fontSize: '0.25rem', padding: '4px 12px',
            background: NOKIA_KEY_BG, color: '#AAA', border: `1px solid ${NOKIA_BODY_EDGE}`,
            borderRadius: 4, cursor: 'pointer',
            boxShadow: '0 2px 0 #1A1D1E',
          }}>
            {isActive ? 'END' : 'CLEAR'}
          </button>
        </div>

        {/* Action buttons: CALL / HANGUP */}
        <div style={{ display: 'flex', gap: 8, padding: '0 8px' }}>
          <button
            onClick={() => {
              if (isActive) return;
              if (digits.length === 8 && lookupAgent) dialFromPad();
            }}
            disabled={isActive || digits.length !== 8 || (mode === 'browser' && !lookupAgent?.voiceEnabled)}
            style={{
              flex: 1, fontFamily: 'var(--font-pixel)', fontSize: '0.35rem', padding: '8px',
              background: !isActive && digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? '#2D8B46' : '#2A3A2A',
              color: !isActive && digits.length === 8 ? '#DDD' : '#555',
              cursor: !isActive && digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? 'pointer' : 'not-allowed',
              border: `1px solid ${NOKIA_BODY_EDGE}`, borderRadius: 6,
              boxShadow: '0 2px 0 #1A1D1E',
              lineHeight: 1.8,
            }}
          >
            CALL
          </button>
          <button
            onClick={() => { if (isActive) endBrowserCall(); else clearAll(); }}
            style={{
              flex: 1, fontFamily: 'var(--font-pixel)', fontSize: '0.35rem', padding: '8px',
              background: isActive ? '#8B2D2D' : '#3A2A2A',
              color: isActive ? '#FFF' : '#888',
              cursor: 'pointer',
              border: `1px solid ${NOKIA_BODY_EDGE}`, borderRadius: 6,
              boxShadow: '0 2px 0 #1A1D1E',
              lineHeight: 1.8,
            }}
          >
            {isActive ? 'HANG UP' : 'CLEAR'}
          </button>
        </div>

        {/* Keypad */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'clamp(3px, 0.8vw, 6px)', padding: '0 8px',
        }}>
          {[
            { k: '1', l: '' }, { k: '2', l: 'ABC' }, { k: '3', l: 'DEF' },
            { k: '4', l: 'GHI' }, { k: '5', l: 'JKL' }, { k: '6', l: 'MNO' },
            { k: '7', l: 'PQRS' }, { k: '8', l: 'TUV' }, { k: '9', l: 'WXYZ' },
            { k: '*', l: '' }, { k: '0', l: '+' }, { k: '#', l: '' },
          ].map(({ k, l }) => nokiaKey(k, l, () => addDigit(k), isActive || digits.length >= 8))}
        </div>

        {/* Bottom action row */}
        <div style={{ display: 'flex', gap: 6, padding: '0 8px 4px' }}>
          <button onClick={backspace} disabled={digits.length === 0 || isActive} style={{
            flex: 1, fontFamily: 'var(--font-pixel)', fontSize: '0.28rem', padding: '6px',
            background: NOKIA_KEY_BG, color: digits.length > 0 && !isActive ? '#DDD' : '#555',
            cursor: digits.length > 0 && !isActive ? 'pointer' : 'not-allowed',
            border: `1px solid ${NOKIA_BODY_EDGE}`, borderRadius: 4,
            boxShadow: '0 2px 0 #1A1D1E', lineHeight: 1.8,
          }}>&lt;DEL</button>
        </div>

        {/* Nokia bottom logo area */}
        <div style={{
          textAlign: 'center',
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.18rem',
          color: '#444',
          letterSpacing: '0.15em',
          padding: '4px 0 2px',
        }}>
          0x01 WORLD
        </div>
      </div>
    </div>
  );

  // ── PANEL: GUIDE (right / mobile tab 3) ──
  const guidePanel = (
    <div style={{ flex: '0 0 280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '0.5rem 0' }}>
      <div style={{ background: PX.black, padding: '1rem', ...pixelBorder(PX.green, 2) }}>
        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.35rem', color: PX.green, letterSpacing: '0.1em', marginBottom: 10 }}>
          HOW TO CALL
        </div>
        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.28rem', color: PX.white, lineHeight: 2.4 }}>
          <div><span style={{ color: PX.blue }}>1.</span> CALL THE CENTRAL NUMBER:</div>
          <div style={{ textAlign: 'center', margin: '6px 0', fontSize: '0.35rem' }}>
            <a href={`tel:${TWILIO_NUMBER}`} style={{ color: PX.green, textDecoration: 'none' }}>{TWILIO_DISPLAY}</a>
          </div>
          <div><span style={{ color: PX.blue }}>2.</span> WAIT FOR IVR GREETING</div>
          <div><span style={{ color: PX.blue }}>3.</span> ENTER 8-DIGIT EXTENSION:</div>
          {selExtStr ? (
            <div style={{ textAlign: 'center', margin: '8px 0', padding: '8px', background: 'rgba(0,204,68,0.15)', border: `1px solid ${PX.green}` }}>
              <div style={{ fontSize: '0.22rem', color: PX.grayLight, marginBottom: 4 }}>
                {selectedAgent?.name || lookupAgent?.name || 'AGENT'}
              </div>
              <div style={{ fontSize: '0.5rem', color: PX.green, letterSpacing: '0.15em' }}>
                {selExtStr}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', margin: '6px 0', color: PX.grayLight, fontSize: '0.25rem' }}>
              SELECT AN AGENT FIRST
            </div>
          )}
          <div><span style={{ color: PX.blue }}>4.</span> CONNECTED — TALK LIVE!</div>
        </div>
      </div>

      <div style={{ background: 'rgba(0,0,0,0.04)', padding: '0.75rem', ...pixelBorder(PX.grayLight, 2), fontFamily: 'var(--font-pixel)', fontSize: '0.25rem', color: PX.gray, lineHeight: 2.2 }}>
        {mode === 'browser' ? (
          <>
            <div style={{ color: PX.green, fontSize: '0.3rem', marginBottom: 4 }}>WEB CALL MODE</div>
            <div>CLICK AN AGENT TO CALL</div>
            <div>VOICE VIA BROWSER — FREE</div>
            <div>REQUIRES MICROPHONE ACCESS</div>
          </>
        ) : (
          <>
            <div style={{ color: PX.blue, fontSize: '0.3rem', marginBottom: 4 }}>PHONE CALL MODE</div>
            <div>SELECT AGENT, THEN DIAL</div>
            <div>CALLS VIA YOUR PHONE</div>
            <div>STANDARD RATES APPLY</div>
          </>
        )}
      </div>

      <button onClick={() => { navigator.clipboard?.writeText(TWILIO_NUMBER).catch(() => {}); }} style={{
        fontFamily: 'var(--font-pixel)', fontSize: '0.28rem', padding: '8px',
        background: PX.black, color: PX.blue, cursor: 'pointer',
        ...pixelBorder(PX.blue, 2), lineHeight: 1.8, textAlign: 'center',
      }}>
        COPY CENTRAL: {TWILIO_DISPLAY}
      </button>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: PX.bg, display: 'flex', flexDirection: 'column', imageRendering: 'pixelated' }}>
      {/* ── HEADER ── */}
      <header style={{ textAlign: 'center', padding: '1rem 1rem 0.75rem', borderBottom: `4px solid ${PX.black}` }}>
        <h1 style={{ fontFamily: 'var(--font-pixel)', fontSize: 'clamp(0.8rem, 2.5vw, 1.4rem)', color: PX.black, margin: 0, letterSpacing: '0.05em', lineHeight: 1.6 }}>
          <span style={{ color: PX.greenDark }}>Phone</span>
          <span style={{ color: PX.blueDark }}>Book</span>
          {' '}<span style={{ color: PX.gray }}>Call</span>
        </h1>
        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.4rem', color: PX.grayLight, marginTop: 4, letterSpacing: '0.1em' }}>TALK TO AI AGENTS</div>
      </header>

      {/* ── NAV ── */}
      <div style={{ display: 'flex', gap: '1rem', padding: '0.4rem 1rem', fontFamily: 'var(--font-pixel)', fontSize: '0.4rem', borderBottom: `2px solid ${PX.border}`, background: 'rgba(0,0,0,0.03)', alignItems: 'center' }}>
        <a href="/" style={{ textDecoration: 'none', color: PX.greenDark }}>&lt; DIRECTORY</a>
        <span style={{ color: PX.grayLight }}>|</span>
        <a href="/radio" style={{ textDecoration: 'none', color: PX.blueDark }}>RADIO</a>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setMode(mode === 'browser' ? 'dial' : 'browser')}
          disabled={isActive}
          style={{
            fontFamily: 'var(--font-pixel)', fontSize: '0.32rem', padding: '3px 8px',
            background: mode === 'browser' ? PX.green : PX.blue,
            color: PX.black, cursor: isActive ? 'not-allowed' : 'pointer',
            border: 'none', letterSpacing: '0.05em', lineHeight: 1.8,
          }}
        >
          {mode === 'browser' ? 'WEB CALL' : 'PHONE CALL'}
        </button>
      </div>

      {/* ── DESKTOP LAYOUT (3 columns) ── */}
      <div className="phone-desktop" style={{ flex: 1, display: 'flex', gap: '1rem', padding: '1rem', overflow: 'hidden' }}>
        {agentsPanel(true)}
        {phonePanel}
        {guidePanel}
      </div>

      {/* ── MOBILE LAYOUT (tab-based) ── */}
      <div className="phone-mobile" style={{ flex: 1, display: 'none', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
          {mobileTab === 'agents' && agentsPanel(false)}
          {mobileTab === 'phone' && phonePanel}
          {mobileTab === 'guide' && guidePanel}
        </div>
      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <div className="phone-mobile-nav" style={{
        display: 'none',
        borderTop: `3px solid ${PX.black}`,
        background: PX.black,
      }}>
        {([
          { tab: 'agents' as MobileTab, label: 'AGENTS', icon: '[]' },
          { tab: 'phone' as MobileTab, label: 'PHONE', icon: '#' },
          { tab: 'guide' as MobileTab, label: 'GUIDE', icon: '?' },
        ]).map(({ tab, label, icon }) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            style={{
              flex: 1,
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.3rem',
              padding: '10px 4px 8px',
              background: mobileTab === tab ? 'rgba(0,204,68,0.15)' : 'transparent',
              color: mobileTab === tab ? PX.green : PX.grayLight,
              cursor: 'pointer',
              border: 'none',
              borderTop: mobileTab === tab ? `2px solid ${PX.green}` : '2px solid transparent',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              lineHeight: 1.6,
            }}
          >
            <span style={{ fontSize: '0.4rem' }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ── DESKTOP FOOTER ── */}
      <footer className="phone-desktop-footer" style={{
        padding: '0.5rem 1rem', borderTop: `3px solid ${PX.black}`,
        fontFamily: 'var(--font-pixel)', fontSize: '0.35rem', color: PX.grayLight,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', lineHeight: 2,
      }}>
        <span>
          <span style={{ color: PX.greenDark }}>PHONE</span>
          <span style={{ color: PX.blueDark }}>BOOK</span>
          {' CALL // '}<span style={{ color: PX.blue }}>CENTRAL: {TWILIO_DISPLAY}</span>
        </span>
        <a href="/" style={{ color: PX.grayLight, textDecoration: 'none' }}>&lt; BACK</a>
      </footer>

      <style>{`
        @keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.1); opacity: 1; } }
        @keyframes ring-shake { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-12deg); } 75% { transform: rotate(12deg); } }
        .lcd-blink { animation: blink 1s step-end infinite; }

        .phone-desktop { display: flex !important; }
        .phone-mobile { display: none !important; }
        .phone-mobile-nav { display: none !important; }
        .phone-desktop-footer { display: flex !important; }

        @media (max-width: 900px) {
          .phone-desktop { display: none !important; }
          .phone-mobile { display: flex !important; }
          .phone-mobile-nav { display: flex !important; }
          .phone-desktop-footer { display: none !important; }
        }
      `}</style>
    </div>
  );
}
