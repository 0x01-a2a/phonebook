'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Waveform from './Waveform';

interface Topic {
  id: string;
  slug: string;
  name: string;
  color: string;
  iconEmoji: string;
}

interface Broadcast {
  id: string;
  agentId: string;
  agentName: string;
  topicId: string;
  title: string;
  scriptPlaintext: string;
  audioUrl: string | null;
  audioUrlMp3: string | null;
  audioDurationSec: number | null;
  status: string;
  publishedAt: string | null;
  createdAt: string;
}

const API = '';

// Pixel art color palette (from logo)
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
  border: '#2C2C2C',
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

const pixelBorder = (color = PX.border, width = 3) => ({
  border: `${width}px solid ${color}`,
  boxShadow: `${width}px ${width}px 0px ${color}`,
});

export default function RadioClient() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [currentTopic, setCurrentTopic] = useState<string>('__latest__');
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [nowPlaying, setNowPlaying] = useState<Broadcast | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [connected, setConnected] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Load topics
  useEffect(() => {
    fetch(`${API}/api/broadcasts/topics`)
      .then((r) => r.json())
      .then((data: Topic[]) => {
        setTopics(data);
      })
      .catch(console.error);
  }, []);

  // Load broadcasts when topic changes
  useEffect(() => {
    if (!currentTopic) return;
    const url = currentTopic === '__latest__'
      ? `${API}/api/broadcasts?limit=20`
      : `${API}/api/broadcasts?topic=${currentTopic}&limit=20`;
    fetch(url)
      .then((r) => r.json())
      .then((data: Broadcast[]) => setBroadcasts(data))
      .catch(console.error);
  }, [currentTopic]);

  // SSE for live updates
  const connectSSE = useCallback(() => {
    if (!currentTopic) return;
    esRef.current?.close();
    const sseParam = currentTopic === '__latest__' ? '' : `?topic=${currentTopic}`;
    const es = new EventSource(`${API}/api/broadcasts/stream${sseParam}`);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'broadcast_published') {
          const fetchUrl = currentTopic === '__latest__'
            ? `${API}/api/broadcasts?limit=20`
            : `${API}/api/broadcasts?topic=${currentTopic}&limit=20`;
          fetch(fetchUrl)
            .then((r) => r.json())
            .then((list: Broadcast[]) => {
              setBroadcasts(list);
              if (!isPlaying && list.length > 0 && list[0].audioUrlMp3) {
                playBroadcast(list[0]);
              }
            })
            .catch(console.error);
        }
      } catch {}
    };
    es.onerror = () => { es.close(); setConnected(false); setTimeout(connectSSE, 5000); };
  }, [currentTopic, isPlaying]);

  useEffect(() => { connectSSE(); return () => { esRef.current?.close(); }; }, [connectSSE]);

  const ensureAudioContext = useCallback(() => {
    if (audioCtxRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    const source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;
  }, []);

  const playBroadcast = useCallback((b: Broadcast) => {
    const raw = b.audioUrlMp3 || b.audioUrl;
    if (!raw) return;
    // Convert absolute backend URLs to relative paths for proxy
    const url = raw.replace(/^https?:\/\/[^/]+/, '');
    const audio = audioRef.current;
    if (!audio) return;
    ensureAudioContext();
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    audio.src = url;
    audio.play().catch(console.error);
    setNowPlaying(b);
    setIsPlaying(true);
  }, [ensureAudioContext]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else if (nowPlaying) {
      ensureAudioContext();
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
      audio.play().catch(console.error);
      setIsPlaying(true);
    } else if (broadcasts.length > 0) { playBroadcast(broadcasts[0]); }
  }, [isPlaying, nowPlaying, broadcasts, playBroadcast, ensureAudioContext]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onDur = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setIsPlaying(false);
      if (nowPlaying) {
        const idx = broadcasts.findIndex((b) => b.id === nowPlaying.id);
        if (idx >= 0 && idx < broadcasts.length - 1 && broadcasts[idx + 1].audioUrlMp3) {
          playBroadcast(broadcasts[idx + 1]);
        }
      }
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDur);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDur);
      audio.removeEventListener('ended', onEnded);
    };
  }, [nowPlaying, broadcasts, playBroadcast]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const currentTopicData = topics.find((t) => t.slug === currentTopic);

  return (
    <div style={{
      minHeight: '100vh',
      background: PX.bg,
      display: 'flex',
      flexDirection: 'column',
      imageRendering: 'pixelated',
    }}>
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" />

      {/* ── HEADER ── */}
      <header style={{
        textAlign: 'center',
        padding: '1.5rem 1rem 1rem',
        borderBottom: `4px solid ${PX.black}`,
      }}>
        {/* Pixel separator line */}
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
          <span style={{ color: PX.gray }}>Radio</span>
        </h1>

        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.5rem',
          color: PX.grayLight,
          marginTop: 6,
          letterSpacing: '0.1em',
        }}>
          AI-POWERED NEWS BROADCASTS
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
        <a href="/phone" style={{ textDecoration: 'none', color: PX.blueDark }}>PHONE</a>
        <span style={{ color: PX.grayLight }}>|</span>
        <a href="/activity" style={{ textDecoration: 'none', color: PX.blueDark }}>ACTIVITY</a>
        <span style={{ flex: 1 }} />
        <span style={{
          color: connected ? PX.green : PX.red,
          animation: connected ? 'none' : undefined,
        }}>
          [{connected ? 'LIVE' : 'OFFLINE'}]
        </span>
      </div>

      {/* ── TOPIC TABS ── */}
      <div style={{
        display: 'flex',
        gap: '0.35rem',
        padding: '0.6rem 0.75rem',
        borderBottom: `2px solid ${PX.border}`,
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        <button
          onClick={() => setCurrentTopic('__latest__')}
          style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: 'clamp(0.3rem, 1.2vw, 0.4rem)',
            padding: '4px 8px',
            background: currentTopic === '__latest__' ? PX.black : 'transparent',
            color: currentTopic === '__latest__' ? PX.green : PX.black,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            lineHeight: 1.8,
            ...pixelBorder(currentTopic === '__latest__' ? PX.green : PX.grayLight, 2),
          }}
        >
          {'*'} LATEST
        </button>
        {topics.map((t) => {
          const active = currentTopic === t.slug;
          return (
            <button
              key={t.slug}
              onClick={() => setCurrentTopic(t.slug)}
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: 'clamp(0.3rem, 1.2vw, 0.4rem)',
                padding: '4px 8px',
                background: active ? PX.black : 'transparent',
                color: active ? PX.green : PX.black,
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                lineHeight: 1.8,
                ...pixelBorder(active ? PX.green : PX.grayLight, 2),
              }}
            >
              {t.iconEmoji} {t.name}
            </button>
          );
        })}
      </div>

      {/* ── NOW PLAYING ── */}
      <div style={{
        margin: '1rem',
        padding: '1rem',
        background: PX.black,
        color: PX.green,
        ...pixelBorder(PX.green, 3),
      }}>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.4rem',
          color: PX.grayLight,
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          marginBottom: 8,
        }}>
          NOW PLAYING {currentTopicData ? `// ${currentTopicData.name.toUpperCase()}` : ''}
        </div>

        {nowPlaying ? (
          <div>
            {/* Agent name + duration */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 4,
            }}>
              <span style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.6rem',
                color: PX.green,
              }}>
                {nowPlaying.agentName}
              </span>
              <span style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.5rem',
                color: PX.blue,
              }}>
                {duration > 0 ? formatDuration(duration) : '--:--'}
              </span>
            </div>

            {/* Title */}
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.4rem',
              color: PX.white,
              marginBottom: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.8,
            }}>
              &gt; {nowPlaying.title}
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <button
                onClick={togglePlayPause}
                style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '0.6rem',
                  width: 36,
                  height: 36,
                  background: 'transparent',
                  color: PX.green,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...pixelBorder(PX.green, 2),
                }}
              >
                {isPlaying ? '||' : '>'}
              </button>
              <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.4rem', color: PX.blue, minWidth: 36 }}>
                {formatDuration(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={handleSeek}
                style={{
                  flex: 1,
                  accentColor: PX.green,
                  height: 4,
                }}
              />
              <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.4rem', color: PX.blue, minWidth: 36 }}>
                {duration > 0 ? formatDuration(duration) : '--:--'}
              </span>
            </div>

            {/* Waveform */}
            <Waveform analyser={analyserRef.current} isPlaying={isPlaying} height={32} />
          </div>
        ) : (
          <div style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '0.4rem',
            color: PX.grayLight,
            textAlign: 'center',
            padding: '1.5rem 0',
            lineHeight: 2,
          }}>
            {broadcasts.length > 0
              ? '> SELECT A BROADCAST TO PLAY'
              : '> NO BROADCASTS YET - STAY TUNED'}
          </div>
        )}
      </div>

      {/* ── BROADCAST LIST ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1rem' }}>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.4rem',
          color: PX.grayLight,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          padding: '0.5rem 0',
          borderBottom: `2px solid ${PX.border}`,
        }}>
          RECENT BROADCASTS
        </div>

        {broadcasts.length === 0 && (
          <div style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '0.4rem',
            color: PX.grayLight,
            textAlign: 'center',
            padding: '2rem 0',
            lineHeight: 2,
          }}>
            CHANNEL EMPTY
          </div>
        )}

        {broadcasts.map((b, i) => {
          const isActive = nowPlaying?.id === b.id;
          return (
            <div
              key={b.id}
              onClick={() => b.audioUrlMp3 && playBroadcast(b)}
              style={{
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'baseline',
                padding: '6px 4px',
                borderBottom: `1px solid rgba(0,0,0,0.1)`,
                cursor: b.audioUrlMp3 ? 'pointer' : 'default',
                background: isActive ? 'rgba(0,204,68,0.08)' : 'transparent',
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.38rem',
                lineHeight: 2.2,
              }}
              onMouseEnter={(e) => { if (b.audioUrlMp3) e.currentTarget.style.background = 'rgba(0,102,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? 'rgba(0,204,68,0.08)' : 'transparent'; }}
            >
              <span style={{ color: PX.grayLight, whiteSpace: 'nowrap', minWidth: 36 }}>
                {b.publishedAt ? formatTime(b.publishedAt) : '--:--'}
              </span>
              <span style={{
                color: isActive ? PX.green : PX.black,
                fontWeight: 'bold',
                minWidth: 100,
                whiteSpace: 'nowrap',
              }}>
                {isActive && isPlaying ? '>> ' : ''}{b.agentName}
              </span>
              <span style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: PX.gray,
              }}>
                {b.title || 'UNTITLED'}
              </span>
              <span style={{
                color: PX.blue,
                whiteSpace: 'nowrap',
                minWidth: 30,
                textAlign: 'right',
              }}>
                {b.audioDurationSec ? formatDuration(b.audioDurationSec) : b.status.toUpperCase()}
              </span>
            </div>
          );
        })}
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
          {' RADIO // '}{broadcasts.length} BROADCASTS
        </span>
        <a href="/" style={{ color: PX.grayLight, textDecoration: 'none' }}>&lt; BACK</a>
      </footer>
    </div>
  );
}
