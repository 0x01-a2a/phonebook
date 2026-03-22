'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import WinampEqualizer from './WinampEqualizer';

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

interface DjClip {
  type: 'intro' | 'filler' | 'signoff' | 'jingle';
  variant: number;
  audioUrl: string;
  script: string;
}

type RadioState = 'loading' | 'ready' | 'jingle' | 'dj_intro' | 'broadcast' | 'dj_filler' | 'idle';

const API = '';

// Pixel art color palette
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

  // DJ state
  const [radioState, setRadioState] = useState<RadioState>('loading');
  const [djClips, setDjClips] = useState<DjClip[]>([]);
  const [broadcastIndex, setBroadcastIndex] = useState(0);
  const [currentDjClip, setCurrentDjClip] = useState<DjClip | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const fillerIndexRef = useRef(0);
  const jingleIndexRef = useRef(0);
  const jingleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jingleNextStateRef = useRef<'dj_intro' | 'broadcast'>('dj_intro');

  // Load topics
  useEffect(() => {
    fetch(`${API}/api/broadcasts/topics`)
      .then((r) => r.json())
      .then((data: Topic[]) => setTopics(data))
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

  // Load DJ clips
  useEffect(() => {
    fetch(`${API}/api/radio-dj/clips`)
      .then((r) => r.json())
      .then((data: DjClip[]) => {
        setDjClips(Array.isArray(data) ? data : []);
        setRadioState('ready');
      })
      .catch(() => {
        // DJ clips are optional — continue without them
        setRadioState('ready');
      });
  }, []);

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
              // If idle or filler, jump to new broadcast
              setRadioState((prev) => {
                if ((prev === 'idle' || prev === 'dj_filler') && list.length > 0 && list[0].audioUrlMp3) {
                  return 'broadcast';
                }
                return prev;
              });
            })
            .catch(console.error);
        }
      } catch {}
    };
    es.onerror = () => { es.close(); setConnected(false); setTimeout(connectSSE, 5000); };
  }, [currentTopic]);

  useEffect(() => { connectSSE(); return () => { esRef.current?.close(); }; }, [connectSSE]);

  const ensureAudioContext = useCallback(() => {
    if (audioCtxRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;
  }, []);

  // 8-bit chiptune jingle — plays before the TTS tagline
  const playChiptuneJingle = useCallback((): number => {
    ensureAudioContext();
    const ctx = audioCtxRef.current;
    if (!ctx) return 0;
    if (ctx.state === 'suspended') ctx.resume();

    // News broadcast fanfare melody in 8-bit style
    const melody: { freq: number; dur: number; type?: OscillatorType }[] = [
      // Rising fanfare
      { freq: 523.25, dur: 0.12 },  // C5
      { freq: 587.33, dur: 0.12 },  // D5
      { freq: 659.25, dur: 0.12 },  // E5
      { freq: 783.99, dur: 0.20 },  // G5
      { freq: 0, dur: 0.06 },       // tiny pause
      { freq: 783.99, dur: 0.12 },  // G5
      { freq: 880.00, dur: 0.12 },  // A5
      { freq: 987.77, dur: 0.12 },  // B5
      { freq: 1046.50, dur: 0.35 }, // C6 (held)
      { freq: 0, dur: 0.10 },       // pause
      // Signature ending
      { freq: 783.99, dur: 0.10 },  // G5
      { freq: 1046.50, dur: 0.10 }, // C6
      { freq: 1318.51, dur: 0.40 }, // E6 (finale, held)
    ];

    // Bass accompaniment (lower octave, triangle wave)
    const bass: { freq: number; dur: number }[] = [
      { freq: 130.81, dur: 0.48 },  // C3
      { freq: 0, dur: 0.06 },
      { freq: 196.00, dur: 0.48 },  // G3
      { freq: 0, dur: 0.10 },
      { freq: 130.81, dur: 0.20 },  // C3
      { freq: 164.81, dur: 0.60 },  // E3
    ];

    const now = ctx.currentTime + 0.05;
    const destination = analyserRef.current || ctx.destination;

    // Play melody (square wave for 8-bit sound)
    let time = now;
    melody.forEach(note => {
      if (note.freq === 0) { time += note.dur; return; }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.10, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + note.dur * 0.95);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(time);
      osc.stop(time + note.dur);
      time += note.dur;
    });
    const melodyEnd = time;

    // Play bass (triangle wave)
    time = now;
    bass.forEach(note => {
      if (note.freq === 0) { time += note.dur; return; }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.08, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + note.dur * 0.95);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(time);
      osc.stop(time + note.dur);
      time += note.dur;
    });

    const totalDur = Math.max(melodyEnd, time) - now;
    return totalDur;
  }, [ensureAudioContext]);

  const playAudioUrl = useCallback((url: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    ensureAudioContext();
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    // Convert absolute backend URLs to relative paths for proxy
    const relativeUrl = url.replace(/^https?:\/\/[^/]+/, '');
    audio.src = relativeUrl;
    audio.play().catch(console.error);
    setIsPlaying(true);
  }, [ensureAudioContext]);

  const playBroadcast = useCallback((b: Broadcast, index?: number) => {
    const raw = b.audioUrlMp3 || b.audioUrl;
    if (!raw) return;
    setNowPlaying(b);
    setCurrentDjClip(null);
    setRadioState('broadcast');
    if (index !== undefined) setBroadcastIndex(index);
    playAudioUrl(raw);
  }, [playAudioUrl]);

  const playDjClip = useCallback((clip: DjClip, state: 'dj_intro' | 'dj_filler') => {
    setCurrentDjClip(clip);
    setNowPlaying(null);
    setRadioState(state);
    playAudioUrl(clip.audioUrl);
  }, [playAudioUrl]);

  // Play full jingle: chiptune melody → TTS tagline clip
  const playJingle = useCallback((nextState: 'dj_intro' | 'broadcast') => {
    jingleNextStateRef.current = nextState;
    setRadioState('jingle');
    setNowPlaying(null);
    setCurrentDjClip(null);
    setIsPlaying(true);

    const jingles = djClips.filter((c) => c.type === 'jingle');
    const chimeDuration = playChiptuneJingle();

    if (jingles.length > 0) {
      // After chiptune ends, play TTS jingle tagline
      const jingle = jingles[jingleIndexRef.current % jingles.length];
      jingleIndexRef.current++;
      jingleTimeoutRef.current = setTimeout(() => {
        setCurrentDjClip(jingle);
        playAudioUrl(jingle.audioUrl);
        // The onEnded handler will transition to nextState
      }, chimeDuration * 1000 + 200);
    } else {
      // No TTS jingle clips — just play chiptune then transition
      jingleTimeoutRef.current = setTimeout(() => {
        setIsPlaying(false);
        // Transition to next state
        if (nextState === 'dj_intro') {
          const introClip = djClips.find((c) => c.type === 'intro');
          if (introClip) {
            playDjClip(introClip, 'dj_intro');
          } else if (broadcasts.length > 0 && broadcasts[0].audioUrlMp3) {
            setBroadcastIndex(0);
            playBroadcast(broadcasts[0], 0);
          } else {
            setRadioState('idle');
          }
        } else {
          const playable = broadcasts.filter((b) => b.audioUrlMp3);
          if (playable.length > 0) {
            setBroadcastIndex(0);
            playBroadcast(playable[0], 0);
          } else {
            setRadioState('idle');
          }
        }
      }, chimeDuration * 1000 + 300);
    }
  }, [djClips, broadcasts, playChiptuneJingle, playAudioUrl, playDjClip, playBroadcast]);

  // TUNE IN — starts the radio flow
  const tuneIn = useCallback(() => {
    // Start with branded jingle → then intro → then broadcasts
    playJingle('dj_intro');
  }, [playJingle]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else if (nowPlaying || currentDjClip) {
      ensureAudioContext();
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
      audio.play().catch(console.error);
      setIsPlaying(true);
    }
  }, [isPlaying, nowPlaying, currentDjClip, ensureAudioContext]);

  // Handle audio events — state machine transitions
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onDur = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setIsPlaying(false);

      // State machine transitions
      if (radioState === 'jingle') {
        // Jingle TTS clip ended → transition based on jingleNextStateRef
        if (jingleNextStateRef.current === 'dj_intro') {
          const introClip = djClips.find((c) => c.type === 'intro');
          if (introClip) {
            playDjClip(introClip, 'dj_intro');
          } else {
            const playable = broadcasts.filter((b) => b.audioUrlMp3);
            if (playable.length > 0) {
              setBroadcastIndex(0);
              playBroadcast(playable[0], 0);
            } else {
              setRadioState('idle');
            }
          }
        } else {
          // nextState === 'broadcast' — loop broadcasts from start
          const playable = broadcasts.filter((b) => b.audioUrlMp3);
          if (playable.length > 0) {
            setBroadcastIndex(0);
            playBroadcast(playable[0], 0);
          } else {
            setRadioState('idle');
          }
        }
      } else if (radioState === 'dj_intro') {
        // Intro ended → play first broadcast or filler
        const playable = broadcasts.filter((b) => b.audioUrlMp3);
        if (playable.length > 0) {
          setBroadcastIndex(0);
          playBroadcast(playable[0], 0);
        } else {
          const filler = djClips.find((c) => c.type === 'filler');
          if (filler) {
            playDjClip(filler, 'dj_filler');
          } else {
            setRadioState('idle');
          }
        }
      } else if (radioState === 'broadcast') {
        // Current broadcast ended → next broadcast or filler
        const playable = broadcasts.filter((b) => b.audioUrlMp3);
        const nextIdx = broadcastIndex + 1;
        if (nextIdx < playable.length) {
          setBroadcastIndex(nextIdx);
          playBroadcast(playable[nextIdx], nextIdx);
        } else {
          // All broadcasts played → filler then jingle
          const fillers = djClips.filter((c) => c.type === 'filler');
          if (fillers.length > 0) {
            const filler = fillers[fillerIndexRef.current % fillers.length];
            fillerIndexRef.current++;
            playDjClip(filler, 'dj_filler');
          } else {
            setRadioState('idle');
          }
        }
      } else if (radioState === 'dj_filler') {
        // Filler ended → play jingle before looping broadcasts
        const playable = broadcasts.filter((b) => b.audioUrlMp3);
        if (playable.length > 0) {
          playJingle('broadcast');
        } else {
          setRadioState('idle');
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
  }, [radioState, nowPlaying, broadcasts, broadcastIndex, djClips, playBroadcast, playDjClip, playJingle]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const currentTopicData = topics.find((t) => t.slug === currentTopic);
  const showTuneIn = radioState === 'ready' || radioState === 'loading';
  const isDjPlaying = radioState === 'dj_intro' || radioState === 'dj_filler' || radioState === 'jingle';

  return (
    <div style={{
      minHeight: '100vh',
      background: PX.bg,
      display: 'flex',
      flexDirection: 'column',
      imageRendering: 'pixelated',
    }}>
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" />

      {/* HEADER */}
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

      {/* NAV */}
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
        }}>
          [{connected ? 'LIVE' : 'OFFLINE'}]
        </span>
      </div>

      {/* TOPIC TABS */}
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

      {/* NOW PLAYING */}
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

        {showTuneIn ? (
          /* TUNE IN splash */
          <div style={{
            textAlign: 'center',
            padding: '2rem 0',
          }}>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.55rem',
              color: PX.green,
              marginBottom: 16,
              lineHeight: 2,
              letterSpacing: '0.1em',
            }}>
              TUNE IN TO RADIO PHONEBOOK
            </div>
            <button
              onClick={tuneIn}
              disabled={radioState === 'loading'}
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.7rem',
                padding: '12px 32px',
                background: PX.green,
                color: PX.black,
                cursor: radioState === 'loading' ? 'wait' : 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                ...pixelBorder(PX.greenDark, 3),
                opacity: radioState === 'loading' ? 0.5 : 1,
              }}
            >
              {radioState === 'loading' ? 'LOADING...' : '> PLAY'}
            </button>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.35rem',
              color: PX.grayLight,
              marginTop: 12,
              lineHeight: 2,
            }}>
              {broadcasts.length} BROADCASTS READY
            </div>
          </div>
        ) : radioState === 'idle' ? (
          /* Idle — waiting for new broadcasts */
          <div style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '0.4rem',
            color: PX.grayLight,
            textAlign: 'center',
            padding: '1.5rem 0',
            lineHeight: 2,
          }}>
            &gt; WAITING FOR NEW BROADCASTS... STAY TUNED
          </div>
        ) : (
          /* Playing — DJ or broadcast */
          <div>
            {/* Winamp Equalizer — centered with side panels on desktop */}
            <div className="radio-eq-row" style={{ marginBottom: 12 }}>
              {/* Left panel — frequency labels */}
              <div className="radio-eq-side" style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.25rem',
                color: PX.grayLight,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '4px 0',
                textAlign: 'right',
                lineHeight: 1.4,
                minWidth: 60,
              }}>
                <span style={{ color: PX.red }}>HIGH</span>
                <span style={{ color: '#CCCC00' }}>MID</span>
                <span style={{ color: PX.green }}>LOW</span>
                <span style={{ fontSize: '0.2rem', marginTop: 4 }}>dB</span>
              </div>

              <WinampEqualizer
                analyser={analyserRef.current}
                isPlaying={isPlaying}
                width={400}
                height={120}
              />

              {/* Right panel — radio info */}
              <div className="radio-eq-side" style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.25rem',
                color: PX.grayLight,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '4px 0',
                minWidth: 60,
                lineHeight: 1.4,
              }}>
                <span style={{ color: PX.green }}>FM 0x01</span>
                <span>{isPlaying ? 'ON AIR' : 'PAUSED'}</span>
                <span style={{ color: PX.blue }}>{broadcasts.length} TRK</span>
                <span style={{ fontSize: '0.2rem', color: isDjPlaying ? PX.blue : PX.green }}>
                  {isDjPlaying ? 'DJ' : 'LIVE'}
                </span>
              </div>
            </div>

            {/* Agent/DJ name + duration */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 4,
            }}>
              <span style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.6rem',
                color: isDjPlaying ? PX.blue : PX.green,
              }}>
                {radioState === 'jingle' ? 'PHONEBOOK RADIO SHOW' : isDjPlaying ? 'RADIO DJ' : nowPlaying?.agentName}
              </span>
              <span style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.5rem',
                color: PX.blue,
              }}>
                {duration > 0 ? formatDuration(duration) : '--:--'}
              </span>
            </div>

            {/* Title / script */}
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
              &gt; {radioState === 'jingle' && !currentDjClip ? '♪ JINGLE ♪' : isDjPlaying ? currentDjClip?.script : nowPlaying?.title}
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
          </div>
        )}
      </div>

      {/* BROADCAST LIST */}
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
              onClick={() => {
                if (!b.audioUrlMp3) return;
                const playable = broadcasts.filter((x) => x.audioUrlMp3);
                const pIdx = playable.findIndex((x) => x.id === b.id);
                setBroadcastIndex(pIdx >= 0 ? pIdx : 0);
                playBroadcast(b, pIdx >= 0 ? pIdx : 0);
              }}
              style={{
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'baseline',
                padding: '6px 4px',
                borderBottom: '1px solid rgba(0,0,0,0.1)',
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

      {/* FOOTER */}
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

      <style>{`
        .radio-eq-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }
        .radio-eq-side {
          display: flex !important;
        }
        @media (max-width: 768px) {
          .radio-eq-side {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
