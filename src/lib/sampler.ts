import { useSyncExternalStore } from 'react';

/**
 * One shared audio element for sampling candidate and search-result
 * previews: starting one stops the last, and it pauses the review card's own
 * player (and vice versa, via `claim`). Replaces one <audio controls> per row.
 */
let audio: HTMLAudioElement | null = null;
let playing: string | null = null;
const listeners = new Set<() => void>();
const others = new Set<HTMLAudioElement>();

function emit() { for (const l of listeners) l(); }

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'none';
    const stop = () => { playing = null; emit(); };
    audio.addEventListener('ended', stop);
    audio.addEventListener('pause', stop);
    audio.addEventListener('error', stop);
  }
  return audio;
}

/** Play `url` (or stop it if it's the one playing). */
export function toggleSample(url: string): void {
  const a = el();
  if (playing === url) { a.pause(); return; }
  for (const o of others) o.pause();
  a.src = url;
  playing = url;
  emit();
  a.play().catch(() => { playing = null; emit(); });
}

export function stopSample(): void {
  if (audio && playing) audio.pause();
}

/**
 * Register another player (the review card's): when it starts, the sampler
 * stops; when the sampler starts, it pauses. Returns an unregister function.
 */
export function claim(other: HTMLAudioElement): () => void {
  others.add(other);
  const onPlay = () => stopSample();
  other.addEventListener('play', onPlay);
  return () => { others.delete(other); other.removeEventListener('play', onPlay); };
}

/** The URL currently playing, reactively. */
export function usePlayingSample(): string | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => playing,
    () => null,
  );
}
