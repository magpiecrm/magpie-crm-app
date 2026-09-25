/**
 * In-memory fixed-window rate limiter for public endpoints. Per process, so it
 * resets on restart and isn't shared across instances — fine for the single
 * container this app runs in.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  return function check(key: string, now = Date.now()): boolean {
    // Opportunistic cleanup so the map can't grow without bound.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
    }
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    entry.count++
    return entry.count <= limit
  }
}

/** Best-effort client IP behind the platform proxy. */
export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}
