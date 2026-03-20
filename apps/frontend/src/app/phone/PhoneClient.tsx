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

  // Ring pattern: 0.06 vol for 2s, silence for 1s, repeat
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

/* ════════════════════════════════════════════ */
export default function PhoneClient() {
  const [mode, setMode] = useState<CallMode>('browser');
  const [digits, setDigits] = useState('');
  const [browserState, setBrowserState] = useState<BrowserCallState>('idle');
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [callDuration, setCallDuration] = useState(0);
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

  /* ── BROWSER CALL ── */
  const startBrowserCall = useCallback(async (agent: AgentInfo) => {
    setSelectedAgent(agent); setBrowserState('requesting_mic'); setError(''); setCallDuration(0);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setBrowserState('connecting');
      const res = await fetch(`${API}/api/voice/connect/${agent.id}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Agent voice not available'); }
      const { elevenlabsAgentId } = await res.json();

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
  }, [conversation, getAudioCtx]);

  const endBrowserCall = useCallback(async () => {
    if (ringRef.current) { ringRef.current.stop(); ringRef.current = null; }
    try { await conversation.endSession(); } catch {}
    setBrowserState('ended');
    if (timerRef.current) clearInterval(timerRef.current);
  }, [conversation]);

  // Auto-disconnect after MAX_CALL_SECONDS
  useEffect(() => {
    if (browserState === 'connected' && callDuration >= MAX_CALL_SECONDS) {
      endBrowserCall();
      setError(`CALL LIMIT ${MAX_CALL_SECONDS}S REACHED`);
    }
  }, [browserState, callDuration, endBrowserCall]);

  const dialFromPad = useCallback(() => {
    if (digits.length !== 8) { setError('ENTER 8 DIGIT EXTENSION'); return; }
    if (mode === 'browser' && lookupAgent) startBrowserCall(lookupAgent);
    else if (mode === 'dial') window.location.href = `tel:${TWILIO_NUMBER}`;
  }, [digits, mode, lookupAgent, startBrowserCall]);

  const selectAgent = useCallback((agent: AgentInfo) => {
    const ext = agent.phoneNumber?.match(/\+1-0x01-(\d{4})-(\d{4})/);
    if (ext) setDigits(ext[1] + ext[2]);
    setSelectedAgent(agent);
    if (mode === 'browser' && agent.voiceEnabled) {
      startBrowserCall(agent);
      setMobileTab('phone');
    } else {
      setMobileTab(mode === 'dial' ? 'guide' : 'phone');
    }
  }, [mode, startBrowserCall]);

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

  const remaining = MAX_CALL_SECONDS - callDuration;
  const isActive = browserState === 'requesting_mic' || browserState === 'connecting' || browserState === 'ringing' || browserState === 'connected';
  const statusColor = browserState === 'connected' ? (remaining <= 10 ? PX.red : PX.green) : browserState === 'ringing' ? PX.green : browserState === 'connecting' || browserState === 'requesting_mic' ? PX.blue : browserState === 'error' ? PX.red : PX.grayLight;
  const statusText = browserState === 'idle' ? 'READY' : browserState === 'requesting_mic' ? 'MIC ACCESS...' : browserState === 'connecting' ? 'CONNECTING...' : browserState === 'ringing' ? 'RINGING...' : browserState === 'connected' ? `LIVE ${formatDuration(callDuration)} / ${formatDuration(MAX_CALL_SECONDS)}` : browserState === 'ended' ? `ENDED ${formatDuration(callDuration)}` : 'ERROR';

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
          // Compact list — mobile
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

        // Full card with banner — desktop
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

  // ── PANEL: PHONE (center) ──
  const phonePanel = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', maxWidth: 400, margin: '0 auto', width: '100%' }}>

      {/* Active call */}
      {isActive && selectedAgent && (
        <div style={{ width: '100%', background: PX.black, padding: '1.5rem 1rem', ...pixelBorder(remaining <= 10 && browserState === 'connected' ? PX.red : PX.green, 3), textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: browserState === 'connected' ? `radial-gradient(circle, ${remaining <= 10 ? PX.red : PX.green}, ${remaining <= 10 ? PX.redDark : PX.greenDark})` : browserState === 'ringing' ? `radial-gradient(circle, ${PX.green}, ${PX.greenDark})` : `radial-gradient(circle, ${PX.blue}, ${PX.blueDark})`,
            margin: '0 auto 16px',
            animation: browserState === 'ringing' ? 'ring-shake 0.3s ease-in-out infinite' : browserState === 'connected' ? 'pulse 2s ease-in-out infinite' : 'pulse 1s ease-in-out infinite',
            boxShadow: browserState === 'connected' ? `0 0 20px ${remaining <= 10 ? PX.red : PX.green}40` : `0 0 20px ${browserState === 'ringing' ? PX.green : PX.blue}40`,
          }} />
          <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.6rem', color: PX.green, marginBottom: 4 }}>{selectedAgent.name}</div>
          <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.35rem', color: statusColor, letterSpacing: '0.1em', marginBottom: 4 }}>{statusText}</div>
          {browserState === 'connected' && (
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.28rem', color: remaining <= 10 ? PX.red : PX.grayLight, letterSpacing: '0.1em', marginBottom: 12, animation: remaining <= 10 ? 'blink 0.5s step-end infinite' : 'none' }}>
              {remaining <= 10 ? `! DISCONNECTING IN ${remaining}S` : `${remaining}S REMAINING`}
            </div>
          )}
          {conversation.isSpeaking && <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.3rem', color: PX.blue, letterSpacing: '0.1em', marginBottom: 12 }}>AGENT IS SPEAKING...</div>}
          <button onClick={endBrowserCall} style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.5rem', padding: '10px 32px', background: PX.red, color: PX.white, cursor: 'pointer', ...pixelBorder(PX.redDark, 2), lineHeight: 1.8 }}>HANG UP</button>
        </div>
      )}

      {/* Dial display + pad */}
      {!isActive && (
        <>
          <div style={{ width: '100%', background: PX.black, padding: '1rem', ...pixelBorder(PX.border, 3) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontFamily: 'var(--font-pixel)', fontSize: '0.35rem', letterSpacing: '0.1em' }}>
              <span style={{ color: PX.grayLight }}>EXTENSION</span>
              <span style={{ color: statusColor }}>{statusText}</span>
            </div>
            <div style={{
              fontFamily: 'var(--font-pixel)', fontSize: 'clamp(1rem, 5vw, 1.6rem)',
              color: digits.length === 8 ? PX.green : PX.white, textAlign: 'center',
              padding: '0.75rem 0', letterSpacing: '0.15em', minHeight: '3rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderBottom: `2px solid ${PX.gray}`, borderTop: `2px solid ${PX.gray}`,
            }}>
              {digits.length > 0 ? (
                <span>
                  <span style={{ color: PX.grayLight, fontSize: '0.6em' }}>0x01-</span>
                  {formatExtension(digits)}
                  {digits.length < 8 && <span style={{ color: PX.grayLight, animation: 'blink 1s step-end infinite' }}>_</span>}
                </span>
              ) : (
                <span style={{ color: PX.grayLight, fontSize: '0.5em' }}>ENTER EXTENSION...</span>
              )}
            </div>
            {lookupAgent && (
              <div style={{
                marginTop: 8, padding: '6px 8px',
                background: lookupAgent.voiceEnabled ? 'rgba(0,204,68,0.1)' : 'rgba(204,0,0,0.1)',
                border: `1px solid ${lookupAgent.voiceEnabled ? PX.green : PX.red}`,
                fontFamily: 'var(--font-pixel)', fontSize: '0.35rem',
                color: lookupAgent.voiceEnabled ? PX.green : PX.red,
                display: 'flex', justifyContent: 'space-between', letterSpacing: '0.05em', lineHeight: 1.8,
              }}>
                <span>&gt; {lookupAgent.name}</span>
                <span>{lookupAgent.voiceEnabled ? 'VOICE ON' : 'NO VOICE'}</span>
              </div>
            )}
            {error && <div style={{ marginTop: 8, fontFamily: 'var(--font-pixel)', fontSize: '0.35rem', color: PX.red, textAlign: 'center' }}>! {error}</div>}
          </div>

          <div style={{ width: '100%', background: PX.black, padding: '1rem', ...pixelBorder(PX.border, 3) }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((key) => (
                <button key={key} onClick={() => addDigit(key)} disabled={digits.length >= 8} style={{
                  fontFamily: 'var(--font-pixel)', fontSize: 'clamp(0.6rem, 3vw, 0.9rem)', padding: 'clamp(8px, 2vw, 14px)',
                  background: pressedKey === key ? PX.green : digits.length >= 8 ? PX.gray : PX.black,
                  color: pressedKey === key ? PX.black : digits.length >= 8 ? PX.grayLight : PX.white,
                  cursor: digits.length >= 8 ? 'not-allowed' : 'pointer',
                  ...pixelBorder(pressedKey === key ? PX.greenDark : PX.gray, 2),
                  transition: 'background 0.05s, color 0.05s', lineHeight: 1.5,
                }}>
                  {key}
                  <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.25rem', color: PX.grayLight, marginTop: 2, letterSpacing: '0.1em' }}>
                    {key === '2' ? 'ABC' : key === '3' ? 'DEF' : key === '4' ? 'GHI' : key === '5' ? 'JKL' : key === '6' ? 'MNO' : key === '7' ? 'PQRS' : key === '8' ? 'TUV' : key === '9' ? 'WXYZ' : key === '0' ? '+' : ''}
                  </div>
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
              <button onClick={backspace} disabled={digits.length === 0} style={{
                fontFamily: 'var(--font-pixel)', fontSize: '0.4rem', padding: '10px',
                background: PX.black, color: digits.length > 0 ? PX.white : PX.grayLight,
                cursor: digits.length === 0 ? 'not-allowed' : 'pointer', ...pixelBorder(PX.gray, 2), lineHeight: 1.8,
              }}>&lt;DEL</button>
              <button onClick={dialFromPad}
                disabled={digits.length !== 8 || (mode === 'browser' && !lookupAgent?.voiceEnabled)}
                style={{
                  fontFamily: 'var(--font-pixel)', fontSize: '0.4rem', padding: '10px',
                  background: digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? PX.green : PX.gray,
                  color: digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? PX.black : PX.grayLight,
                  cursor: digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? 'pointer' : 'not-allowed',
                  ...pixelBorder(digits.length === 8 && (mode === 'dial' || lookupAgent?.voiceEnabled) ? PX.greenDark : PX.grayLight, 2),
                  lineHeight: 1.8,
                }}>{mode === 'browser' ? 'CALL' : 'DIAL'}</button>
              <button onClick={clearAll} style={{
                fontFamily: 'var(--font-pixel)', fontSize: '0.4rem', padding: '10px',
                background: PX.black, color: PX.white, cursor: 'pointer', ...pixelBorder(PX.gray, 2), lineHeight: 1.8,
              }}>CLEAR</button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  // ── PANEL: GUIDE (right / mobile tab 3) ──
  const guidePanel = (
    <div style={{ flex: '0 0 280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '0.5rem 0' }}>
      {/* Call guide box */}
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

      {/* Mode info */}
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

      {/* Central number copy */}
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
        {!isActive && agentsPanel(true)}
        {phonePanel}
        {!isActive && guidePanel}
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

        /* Desktop: show 3-col, hide mobile */
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
