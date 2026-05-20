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

interface MusicTrack {
  id: string;
  title: string;
  genre: string | null;
  audioUrlMp3: string | null;
  durationSec: number | null;
  publishedAt: string | null;
}

type RadioState = 'loading' | 'ready' | 'jingle' | 'dj_intro' | 'broadcast' | 'music' | 'dj_filler' | 'idle';

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

  // Music tracks (Pro subscriber generated)
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [currentMusicTrack, setCurrentMusicTrack] = useState<MusicTrack | null>(null);
  const musicIndexRef = useRef(0);

  // Stations + favorites
  const [currentStation, setCurrentStation] = useState<string>('mix');
  const [favoriteTracks, setFavoriteTracks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('phonebook_favorite_tracks');
      if (raw) setFavoriteTracks(new Set(JSON.parse(raw) as string[]));
    } catch {}
  }, []);

  const toggleFavorite = useCallback((trackId: string) => {
    setFavoriteTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      try {
        localStorage.setItem('phonebook_favorite_tracks', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }, []);

  // Filter music tracks by selected station
  const filteredMusicTracks = (() => {
    if (currentStation === 'mix' || currentStation === 'news') return musicTracks;
    if (currentStation === 'favorites') return musicTracks.filter((t) => favoriteTracks.has(t.id));
    const genreMap: Record<string, string[]> = {
      synthwave: ['synthwave', 'cyberpunk'],
      lofi: ['lo-fi hip hop', 'lo-fi', 'lofi'],
      ambient: ['ambient', 'cinematic'],
      chiptune: ['chiptune', '8-bit'],
    };
    const wanted = genreMap[currentStation] || [currentStation];
    return musicTracks.filter((t) => t.genre && wanted.some((w) => t.genre!.toLowerCase().includes(w)));
  })();

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

  // Load music tracks (Pro subscriber generated)
  useEffect(() => {
    fetch(`${API}/api/music?limit=50`)
      .then((r) => r.json())
      .then((data: MusicTrack[]) => {
        if (Array.isArray(data)) {
          setMusicTracks(data.filter((t) => t.audioUrlMp3));
        }
      })
      .catch(() => {
        // Music is optional — continue without
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

  const playMusicTrack = useCallback((track: MusicTrack) => {
    if (!track.audioUrlMp3) return;
    setCurrentMusicTrack(track);
    setNowPlaying(null);
    setCurrentDjClip(null);
    setRadioState('music');
    playAudioUrl(track.audioUrlMp3);
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
    } else if (nowPlaying || currentDjClip || currentMusicTrack) {
      ensureAudioContext();
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
      audio.play().catch(console.error);
      setIsPlaying(true);
    }
  }, [isPlaying, nowPlaying, currentDjClip, currentMusicTrack, ensureAudioContext]);

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
        // Current broadcast ended → maybe play music, else next broadcast/filler
        const playable = broadcasts.filter((b) => b.audioUrlMp3);
        const nextIdx = broadcastIndex + 1;

        // 60% chance to play music between broadcasts (if music available)
        // Station 'news' = broadcasts only. Other stations = mostly music
        const musicProbability = currentStation === 'news' ? 0 : currentStation === 'mix' ? 0.6 : 0.85;
        if (filteredMusicTracks.length > 0 && Math.random() < musicProbability) {
          const track = filteredMusicTracks[musicIndexRef.current % filteredMusicTracks.length];
          musicIndexRef.current++;
          playMusicTrack(track);
        } else if (nextIdx < playable.length) {
          setBroadcastIndex(nextIdx);
          playBroadcast(playable[nextIdx], nextIdx);
        } else {
          const fillers = djClips.filter((c) => c.type === 'filler');
          if (fillers.length > 0) {
            const filler = fillers[fillerIndexRef.current % fillers.length];
            fillerIndexRef.current++;
            playDjClip(filler, 'dj_filler');
          } else {
            setRadioState('idle');
          }
        }
      } else if (radioState === 'music') {
        // Music ended → next broadcast or filler
        const playable = broadcasts.filter((b) => b.audioUrlMp3);
        const nextIdx = broadcastIndex + 1;
        setCurrentMusicTrack(null);
        if (nextIdx < playable.length) {
          setBroadcastIndex(nextIdx);
          playBroadcast(playable[nextIdx], nextIdx);
        } else {
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
  }, [radioState, nowPlaying, broadcasts, broadcastIndex, djClips, musicTracks, filteredMusicTracks, currentStation, playBroadcast, playDjClip, playJingle, playMusicTrack]);

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
      padding: '1.5rem 1rem',
      alignItems: 'center',
    }}>
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" />

      {/* ┌─ THE MACHINE — physical hi-fi tower chassis ─┐ */}
      <div style={{
        width: '100%',
        maxWidth: 980,
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #3a3a3a 0%, #1a1a1a 100%)',
        borderRadius: 6,
        // chunky outer chassis: highlight + shadow combo for 3D bevel
        boxShadow: [
          '0 0 0 2px #000',                    // hairline outline
          '0 0 0 6px #4a4a4a',                 // outer chrome ring
          '0 0 0 8px #1a1a1a',                 // dark gap
          '0 12px 0 8px #0a0a0a',              // shadow under feet
          '0 18px 30px rgba(0,0,0,0.5)',       // ambient shadow
          'inset 0 2px 0 rgba(255,255,255,0.15)', // top highlight
          'inset 0 -2px 0 rgba(0,0,0,0.6)',    // bottom shadow
        ].join(', '),
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* decorative screws — corners */}
        {[
          { top: 8, left: 8 },
          { top: 8, right: 8 },
          { bottom: 8, left: 8 },
          { bottom: 8, right: 8 },
        ].map((pos, i) => (
          <span key={i} style={{
            position: 'absolute', width: 10, height: 10, borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #888 0%, #333 60%, #111 100%)',
            boxShadow: 'inset 0 0 0 1px #000, 0 1px 0 rgba(255,255,255,0.1)',
            zIndex: 5, ...pos,
          }}>
            <span style={{
              position: 'absolute', inset: 3, background: '#000', borderRadius: 1,
              transform: 'rotate(45deg)', width: 4, height: 1,
            }} />
          </span>
        ))}

      {/* TOWER TOP — brushed metal header with brand plate */}
      <header style={{
        textAlign: 'center',
        padding: '1.2rem 1rem 1rem',
        background: 'linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 40%, #1a1a1a 100%)',
        borderBottom: '4px solid #000',
        boxShadow: 'inset 0 -8px 16px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,255,255,0.08)',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* power LED + brand */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 8 }}>
          <span style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
            background: '#FF1A1A',
            boxShadow: '0 0 8px #FF1A1A, 0 0 16px #FF000080, inset 0 -2px 4px rgba(0,0,0,0.4)',
          }} />
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.32rem', color: '#888', letterSpacing: '0.3em' }}>
            POWER • TUNED • STEREO
          </span>
          <span style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
            background: '#00FF44',
            boxShadow: '0 0 8px #00FF44, 0 0 16px #00FF0080, inset 0 -2px 4px rgba(0,0,0,0.4)',
          }} />
        </div>

        {/* brand plate */}
        <div style={{
          display: 'inline-block',
          padding: '6px 24px',
          background: 'linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%)',
          border: '2px solid #444',
          borderRadius: 2,
          boxShadow: 'inset 0 0 12px rgba(0,0,0,0.8), 0 2px 0 rgba(255,255,255,0.05)',
        }}>
          <h1 style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: 'clamp(0.85rem, 2.4vw, 1.3rem)',
            margin: 0,
            letterSpacing: '0.15em',
            lineHeight: 1.5,
            textShadow: '0 0 8px currentColor',
          }}>
            <span style={{ color: '#00FF44' }}>PHONE</span>
            <span style={{ color: '#FFD700' }}>BOOK</span>
            <span style={{ color: '#888', margin: '0 8px' }}>·</span>
            <span style={{ color: '#FF00AA' }}>RADIO</span>
          </h1>
        </div>

        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.42rem',
          color: '#FFD700',
          marginTop: 8,
          letterSpacing: '0.25em',
          textShadow: '0 0 4px #FFD70080',
        }}>
          FM 0X01 • AGENT BROADCAST NETWORK
        </div>
      </header>

      {/* NAV — stereo top rail */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        padding: '0.5rem 1rem',
        fontFamily: 'var(--font-pixel)',
        fontSize: '0.42rem',
        borderBottom: '2px solid #000',
        background: 'linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%)',
        alignItems: 'center',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)',
      }}>
        <a href="/" style={{ textDecoration: 'none', color: '#00CC44' }}>&lt; DIRECTORY</a>
        <span style={{ color: '#444' }}>|</span>
        <a href="/phone" style={{ textDecoration: 'none', color: '#00CCFF' }}>PHONE</a>
        <span style={{ color: '#444' }}>|</span>
        <a href="/activity" style={{ textDecoration: 'none', color: '#00CCFF' }}>ACTIVITY</a>
        <span style={{ color: '#444' }}>|</span>
        <a href="/subscribe" style={{ textDecoration: 'none', color: '#FFD700' }}>♪ PRO $9</a>
        <span style={{ flex: 1 }} />
        <span style={{
          color: connected ? '#00FF44' : '#FF1A1A',
          textShadow: `0 0 4px ${connected ? '#00FF44' : '#FF1A1A'}80`,
        }}>
          [{connected ? '◉ ON AIR' : '◯ OFFLINE'}]
        </span>
      </div>

      {/* STATIONS BAR — stereo preset panel */}
      <div style={{
        padding: '1rem 0.75rem 0.8rem',
        borderBottom: '3px solid #000',
        background: 'linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%)',
        boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.06), inset 0 -8px 16px rgba(0,0,0,0.6)',
      }}>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.35rem',
          color: '#FFD700',
          textAlign: 'center',
          letterSpacing: '0.4em',
          marginBottom: 12,
          textShadow: '0 0 4px #FFD70060',
        }}>
          ━━━ PRESET STATIONS ━━━
        </div>
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>
          {[
            { slug: 'mix', label: 'PHONEBOOK MIX', icon: '🎙', color: PX.green },
            { slug: 'news', label: 'NEWS', icon: '📣', color: PX.blue },
            { slug: 'synthwave', label: 'SYNTHWAVE', icon: '🌆', color: '#FF00AA' },
            { slug: 'lofi', label: 'LO-FI LOUNGE', icon: '🌙', color: '#FFD700' },
            { slug: 'ambient', label: 'AMBIENT', icon: '🌌', color: '#00CCFF' },
            { slug: 'favorites', label: '♥ FAVORITES', icon: '', color: PX.red },
          ].map((s) => {
            const active = currentStation === s.slug;
            const count =
              s.slug === 'mix' ? musicTracks.length + broadcasts.length :
              s.slug === 'news' ? broadcasts.length :
              s.slug === 'favorites' ? favoriteTracks.size :
              musicTracks.filter((t) => {
                if (!t.genre) return false;
                const g = t.genre.toLowerCase();
                if (s.slug === 'synthwave') return g.includes('synthwave') || g.includes('cyberpunk');
                if (s.slug === 'lofi') return g.includes('lo-fi') || g.includes('lofi');
                if (s.slug === 'ambient') return g.includes('ambient') || g.includes('cinematic');
                return false;
              }).length;
            return (
              <button
                key={s.slug}
                onClick={() => { setCurrentStation(s.slug); musicIndexRef.current = 0; }}
                style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '0.42rem',
                  padding: '10px 14px',
                  background: active
                    ? `linear-gradient(180deg, ${s.color} 0%, ${s.color}cc 100%)`
                    : 'linear-gradient(180deg, #2a2a2a 0%, #161616 100%)',
                  color: active ? '#000' : s.color,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  lineHeight: 1.6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  border: `1px solid ${active ? '#000' : '#555'}`,
                  borderTopColor: active ? '#000' : '#777',
                  borderLeftColor: active ? '#000' : '#777',
                  boxShadow: active
                    ? `inset 0 2px 6px rgba(0,0,0,0.4), 0 0 12px ${s.color}80`
                    : `inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 4px rgba(0,0,0,0.6)`,
                  textShadow: active ? 'none' : `0 0 6px ${s.color}60`,
                  transform: active ? 'translateY(1px)' : 'none',
                  transition: 'all 80ms',
                }}
              >
                {s.icon && <span style={{ fontSize: '0.7rem' }}>{s.icon}</span>}
                <span>{s.label}</span>
                <span style={{
                  fontSize: '0.32rem',
                  padding: '2px 5px',
                  background: active ? '#000' : s.color,
                  color: active ? s.color : '#000',
                  borderRadius: 2,
                  minWidth: 14,
                  textAlign: 'center',
                }}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TOPIC TABS — news subgenre selector */}
      <div style={{
        display: 'flex',
        gap: '0.35rem',
        padding: '0.5rem 0.75rem',
        borderBottom: '2px solid #000',
        flexWrap: 'wrap',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #161616 0%, #0d0d0d 100%)',
      }}>
        <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '0.32rem', color: '#666', alignSelf: 'center', letterSpacing: '0.2em' }}>NEWS:</span>
        <button
          onClick={() => setCurrentTopic('__latest__')}
          style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: 'clamp(0.3rem, 1.2vw, 0.4rem)',
            padding: '4px 8px',
            background: currentTopic === '__latest__' ? '#00CC44' : 'transparent',
            color: currentTopic === '__latest__' ? '#000' : '#888',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            lineHeight: 1.8,
            border: `1px solid ${currentTopic === '__latest__' ? '#00CC44' : '#444'}`,
          }}
        >
          ALL
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
                background: active ? '#0066FF' : 'transparent',
                color: active ? '#fff' : '#888',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                lineHeight: 1.8,
                border: `1px solid ${active ? '#0066FF' : '#444'}`,
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
              {broadcasts.length} BROADCASTS · {musicTracks.length} TRACKS READY
            </div>
            <a
              href="/subscribe"
              style={{
                display: 'inline-block',
                marginTop: 16,
                padding: '10px 20px',
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.5rem',
                background: PX.blue,
                color: PX.white,
                textDecoration: 'none',
                letterSpacing: '0.1em',
                ...pixelBorder(PX.blueDark, 3),
              }}
            >
              + ADD YOUR MUSIC ($9/MO)
            </a>
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
                {radioState === 'jingle' ? 'PHONEBOOK RADIO SHOW' : radioState === 'music' ? `♪ ${currentMusicTrack?.genre?.toUpperCase() || 'MUSIC'}` : isDjPlaying ? 'RADIO DJ' : nowPlaying?.agentName}
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
              &gt; {radioState === 'jingle' && !currentDjClip ? '♪ JINGLE ♪' : radioState === 'music' ? `♪ ${currentMusicTrack?.title || 'Now Playing'}` : isDjPlaying ? currentDjClip?.script : nowPlaying?.title}
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
        {/* MUSIC LIBRARY (separate section) */}
        {musicTracks.length > 0 && (
          <>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '0.4rem',
              color: '#FFD700',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              padding: '0.9rem 0 0.4rem',
              borderBottom: '2px solid #FFD70040',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              textShadow: '0 0 4px #FFD70040',
            }}>
              <span>♪♪♪ MUSIC LIBRARY ({filteredMusicTracks.length}/{musicTracks.length})</span>
              <a href="/subscribe" style={{
                fontSize: '0.35rem',
                color: '#000',
                background: '#FFD700',
                textDecoration: 'none',
                padding: '4px 10px',
                border: '1px solid #FFD700',
                boxShadow: '0 0 8px #FFD70080',
              }}>+ ADD YOURS</a>
            </div>
            {filteredMusicTracks.length === 0 && (
              <div style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.4rem',
                color: PX.grayLight,
                textAlign: 'center',
                padding: '1rem 0',
              }}>
                {currentStation === 'favorites'
                  ? '♥ no favorites yet — click hearts to save tracks'
                  : 'no tracks in this station yet'}
              </div>
            )}
            {filteredMusicTracks.map((t) => {
              const isActive = currentMusicTrack?.id === t.id;
              const isFav = favoriteTracks.has(t.id);
              return (
                <div key={t.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 6px',
                  borderBottom: '1px solid #222',
                  background: isActive ? 'linear-gradient(90deg, #00FF4422 0%, transparent 60%)' : 'transparent',
                }}>
                  <button
                    onClick={() => playMusicTrack(t)}
                    style={{
                      fontFamily: 'var(--font-pixel)',
                      fontSize: '0.5rem',
                      padding: '4px 10px',
                      background: isActive ? '#00FF44' : '#1a1a1a',
                      color: isActive ? '#000' : '#00FF44',
                      cursor: 'pointer',
                      border: `1px solid ${isActive ? '#00FF44' : '#444'}`,
                      boxShadow: isActive ? '0 0 8px #00FF4480' : 'none',
                    }}
                  >
                    {isActive && isPlaying ? '||' : '▶'}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-pixel)',
                      fontSize: '0.45rem',
                      color: '#FFD700',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textShadow: isActive ? '0 0 4px #FFD70060' : 'none',
                    }}>
                      ♪ {t.title}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-pixel)',
                      fontSize: '0.32rem',
                      color: '#888',
                      marginTop: 3,
                      letterSpacing: '0.05em',
                    }}>
                      [{t.genre?.toUpperCase() || 'MUSIC'}]
                      {t.durationSec && ` · ${formatDuration(t.durationSec)}`}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleFavorite(t.id)}
                    aria-label={isFav ? 'unfavorite' : 'favorite'}
                    style={{
                      fontSize: '1.1rem',
                      lineHeight: 1,
                      padding: '4px 10px',
                      background: 'transparent',
                      color: isFav ? '#FF1A1A' : '#555',
                      cursor: 'pointer',
                      border: 'none',
                      textShadow: isFav ? '0 0 6px #FF1A1A80' : 'none',
                    }}
                  >
                    {isFav ? '♥' : '♡'}
                  </button>
                </div>
              );
            })}
          </>
        )}

        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '0.4rem',
          color: '#00CCFF',
          textTransform: 'uppercase',
          letterSpacing: '0.2em',
          padding: '0.9rem 0 0.4rem',
          borderBottom: '2px solid #00CCFF40',
          textShadow: '0 0 4px #00CCFF40',
        }}>
          📣 NEWS BROADCASTS
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
                padding: '8px 4px',
                borderBottom: '1px solid #222',
                cursor: b.audioUrlMp3 ? 'pointer' : 'default',
                background: isActive ? 'linear-gradient(90deg, #00CCFF22 0%, transparent 60%)' : 'transparent',
                fontFamily: 'var(--font-pixel)',
                fontSize: '0.38rem',
                lineHeight: 2.2,
              }}
              onMouseEnter={(e) => { if (b.audioUrlMp3) e.currentTarget.style.background = 'rgba(0,204,255,0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? 'rgba(0,204,255,0.12)' : 'transparent'; }}
            >
              <span style={{ color: '#666', whiteSpace: 'nowrap', minWidth: 36 }}>
                {b.publishedAt ? formatTime(b.publishedAt) : '--:--'}
              </span>
              <span style={{
                color: isActive ? '#00FF44' : '#FFD700',
                fontWeight: 'bold',
                minWidth: 100,
                whiteSpace: 'nowrap',
                textShadow: isActive ? '0 0 4px #00FF4480' : 'none',
              }}>
                {isActive && isPlaying ? '>> ' : ''}{b.agentName}
              </span>
              <span style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: '#bbb',
              }}>
                {b.title || 'UNTITLED'}
              </span>
              <span style={{
                color: '#00CCFF',
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

      {/* FOOTER — base of the tower */}
      <footer style={{
        padding: '0.7rem 1rem',
        borderTop: '3px solid #000',
        background: 'linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%)',
        boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.06)',
        fontFamily: 'var(--font-pixel)',
        fontSize: '0.35rem',
        color: '#888',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        lineHeight: 2,
      }}>
        <span>
          <span style={{ color: '#00CC44' }}>PHONE</span>
          <span style={{ color: '#FFD700' }}>BOOK</span>
          <span style={{ color: '#888' }}>{' RADIO // '}</span>
          <span style={{ color: '#00CCFF' }}>{broadcasts.length} BROADCASTS · {musicTracks.length} TRACKS</span>
        </span>
        <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* tower feet indicator */}
          <span style={{ display: 'inline-block', width: 8, height: 8, background: '#FF1A1A', borderRadius: '50%', boxShadow: '0 0 6px #FF1A1A' }} />
          <a href="/" style={{ color: '#888', textDecoration: 'none' }}>&lt; EXIT</a>
        </span>
      </footer>
      </div>
      {/* └─ /THE MACHINE ─┘ */}

      {/* tower feet under the chassis */}
      <div style={{
        width: '100%',
        maxWidth: 980,
        display: 'flex',
        justifyContent: 'space-between',
        padding: '0 40px',
        marginTop: -2,
      }}>
        {[0,1].map((i) => (
          <div key={i} style={{
            width: 60, height: 14,
            background: 'linear-gradient(180deg, #2a2a2a 0%, #0a0a0a 100%)',
            borderRadius: '0 0 6px 6px',
            boxShadow: '0 4px 8px rgba(0,0,0,0.4), inset 0 -2px 0 rgba(255,255,255,0.05)',
          }} />
        ))}
      </div>

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
