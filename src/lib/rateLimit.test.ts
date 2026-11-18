import { describe, expect, it } from 'vitest';
import { createLimiter, HttpError, limitedFetch, TimeoutError } from './rateLimit';

const fast = () => createLimiter({ perMinute: 60_000, sleep: async () => {} });

/** A fetch that never answers unless aborted, like a host that hangs. */
const hanging: typeof fetch = (_url, init) =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

describe('limitedFetch', () => {
  it('gives up on a hung request after timeoutMs', async () => {
    const t0 = Date.now();
    const err = await limitedFetch(fast(), 'https://api.jikan.moe/v4/anime/1/themes', undefined, { fetchImpl: hanging, timeoutMs: 50 }).catch((e) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as Error).message).toMatch(/api\.jikan\.moe didn't answer/);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('passes other network errors through unchanged', async () => {
    const fail: typeof fetch = async () => { throw new TypeError('Failed to fetch'); };
    await expect(limitedFetch(fast(), 'https://x.test/', undefined, { fetchImpl: fail, timeoutMs: 1000 })).rejects.toThrow(TypeError);
  });

  it('retries 503 up to `retries` times, then throws HttpError', async () => {
    let calls = 0;
    const busy: typeof fetch = async () => { calls++; return new Response('', { status: 503 }); };
    await expect(limitedFetch(fast(), 'https://x.test/', undefined, { fetchImpl: busy, retries: 1, sleep: async () => {} })).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(2);
  });
});
