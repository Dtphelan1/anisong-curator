import { useEffect, useRef, useState } from 'react';
import { claim } from '../../lib/sampler';
import { mmss } from './common';

interface Props {
  /** The card's own audio element: the review's `space` key plays and pauses it. */
  audioRef: React.RefObject<HTMLAudioElement>;
  url: string | null | undefined;
  autoplay: boolean;
  onAutoplay: (on: boolean) => void;
}

/**
 * The preview player: a big play/pause, a seekable progress bar and the
 * Autoplay switch. One real <audio> element; it and the candidate sampler
 * never play at once (`claim`).
 */
export function Player({ audioRef, url, autoplay, onAutoplay }: Props) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const unclaim = claim(el);
    const sync = () => { setPlaying(!el.paused && !el.ended); setTime(el.currentTime); setDuration(Number.isFinite(el.duration) ? el.duration : 0); };
    const events = ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'emptied'] as const;
    for (const ev of events) el.addEventListener(ev, sync);
    return () => { unclaim(); for (const ev of events) el.removeEventListener(ev, sync); };
  }, [audioRef]);

  // A new song: load its preview and, with Autoplay on, start it. Turning
  // Autoplay on doesn't start the current one; it applies from the next song.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setTime(0); setDuration(0);
    if (!url) { el.removeAttribute('src'); el.load(); return; }
    el.src = url;
    if (autoplayRef.current) el.play().catch(() => { /* blocked until the first interaction */ });
  }, [url, audioRef]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el || !url) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <section className="player" aria-label="Preview">
      <audio ref={audioRef} preload="none" />
      <button className="play" onClick={toggle} disabled={!url} aria-label={playing ? 'Pause preview' : 'Play preview'} title="Play / pause (space)">
        {playing ? <span className="pause-glyph" aria-hidden="true" /> : <span className="play-glyph" aria-hidden="true" />}
      </button>
      <div className="progress-wrap">
        <div className="progress" onClick={seek} role="presentation"><span style={{ width: `${pct}%` }} /></div>
        <div className="progress-times">
          <span>{url ? mmss(time * 1000) || '0:00' : 'No preview'}</span>
          <span>{url ? `${mmss(duration * 1000) || '0:30'} preview` : ''}</span>
        </div>
      </div>
      <button role="switch" aria-checked={autoplay} className="switch" onClick={() => onAutoplay(!autoplay)} title="Play each song's preview as soon as it's open">
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        Autoplay
      </button>
    </section>
  );
}
