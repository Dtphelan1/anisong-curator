/**
 * Serial, per-host request spacing with 429 backoff.
 *
 * Each API gets its own limiter so a slow host never stalls another. Requests
 * run one at a time, at least `60_000 / perMinute` ms apart, which is simpler
 * and more predictable than a burst-capable token bucket for budgets this small.
 */
export interface Limiter {
  schedule<T>(task: () => Promise<T>): Promise<T>;
}

export interface LimiterOptions {
  perMinute: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createLimiter({ perMinute, sleep = realSleep, now = Date.now }: LimiterOptions): Limiter {
  const spacing = Math.ceil(60_000 / perMinute);
  let last = -Infinity;
  let chain: Promise<unknown> = Promise.resolve();

  return {
    schedule<T>(task: () => Promise<T>): Promise<T> {
      const run = async () => {
        const wait = last + spacing - now();
        if (wait > 0) await sleep(wait);
        last = now();
        return task();
      };
      const result = chain.then(run, run);
      chain = result.catch(() => undefined);
      return result;
    },
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * fetch through a limiter, retrying 429 (and 503) with Retry-After or
 * exponential backoff. Other non-2xx responses throw HttpError.
 */
export async function limitedFetch(
  limiter: Limiter,
  url: string,
  init?: RequestInit,
  { retries = 3, sleep = realSleep, fetchImpl = fetch }: { retries?: number; sleep?: (ms: number) => Promise<void>; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await limiter.schedule(() => fetchImpl(url, init));
    if (res.ok) return res;
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
      continue;
    }
    throw new HttpError(res.status, `HTTP ${res.status} from ${new URL(url).host}`);
  }
}

/** Shared limiters. AniList is budgeted at its "degraded" 30/min. */
export const limiters = {
  anilist: createLimiter({ perMinute: 30 }),
  animethemes: createLimiter({ perMinute: 80 }),
  jikan: createLimiter({ perMinute: 50 }),
};
