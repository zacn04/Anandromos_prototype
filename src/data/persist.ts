/**
 * Durable state, backed by the local backend in `server/`.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ THE NETWORK BOUNDARY IS `hydrate` AND `flush` — NOTHING ELSE         │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Same shape as the content store: **async once at boot, synchronous
 * everywhere after**. `hydrate()` pulls the whole key/value set in one request
 * before the first render; `load`/`save` then work against an in-memory cache,
 * so no component becomes async and no call site knows a server exists.
 *
 * **localStorage is the fallback, not the store.** Every write goes to both,
 * so the demo degrades to browser-local persistence if the API is unreachable
 * rather than losing state or throwing. That matters: forgetting to start a
 * server should never be the thing that breaks a pitch.
 *
 * Swapping the local backend for a hosted one is a change to `API_BASE` and
 * nothing else.
 */

const NAMESPACE = 'anadromos'
const SCHEMA = 1
const API_BASE = '/api/state'

const keyFor = (name: string): string => `${NAMESPACE}.v${SCHEMA}.${name}`

/** Populated by `hydrate()`. Authoritative for every synchronous read. */
let cache: Record<string, unknown> = {}
let serverUp = false

// ---------------------------------------------------------------------------
// localStorage mirror
// ---------------------------------------------------------------------------

function readLocal(name: string): string | null {
  try {
    return localStorage.getItem(keyFor(name))
  } catch {
    // Private mode, disabled storage, hostile iframe.
    return null
  }
}

function writeLocal(name: string, value: string): void {
  try {
    localStorage.setItem(keyFor(name), value)
  } catch {
    // Quota or unavailable; the cache still serves this session.
  }
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

/**
 * Pulls all persisted state in one round trip. Awaited once, in `main.tsx`,
 * next to `loadContent()`.
 *
 * Never throws: an unreachable backend leaves `serverUp` false and the app
 * runs on the localStorage mirror.
 */
export async function hydrate(): Promise<{ serverUp: boolean; keys: number }> {
  try {
    const res = await fetch(API_BASE, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    cache = (await res.json()) as Record<string, unknown>
    serverUp = true
    // Mirror down, so a later offline reload still has everything.
    for (const [k, v] of Object.entries(cache)) writeLocal(k, JSON.stringify(v))
  } catch {
    serverUp = false
    cache = {}
  }
  return { serverUp, keys: Object.keys(cache).length }
}

/** Whether the local backend answered at boot. Surfaced in the UI, not guessed at. */
export function isServerBacked(): boolean {
  return serverUp
}

// ---------------------------------------------------------------------------
// synchronous API
// ---------------------------------------------------------------------------

export function load<T>(name: string, fallback: T): T {
  if (Object.prototype.hasOwnProperty.call(cache, name)) {
    const cached = cache[name]
    if (cached !== null && cached !== undefined) return cached as T
  }
  const raw = readLocal(name)
  if (raw === null) return fallback
  try {
    return (JSON.parse(raw) as T) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Stores a value. Returns immediately.
 *
 * The cache and the localStorage mirror update synchronously, so a read
 * straight after a write always sees the new value. The server write is
 * fire-and-forget — a failed PUT must not stall a render or surface as an
 * unhandled rejection mid-demo; the mirror has already made the write durable
 * enough to survive a reload.
 */
export function save<T>(name: string, value: T): void {
  cache[name] = value
  const encoded = JSON.stringify(value)
  writeLocal(name, encoded)
  if (!serverUp) return
  void fetch(`${API_BASE}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: encoded,
  }).catch(() => {
    // Server went away mid-session; the mirror keeps the demo alive.
    serverUp = false
  })
}

/**
 * Clears everything this module owns, server included.
 *
 * Exposed as "Reset demo": running the same pitch twice needs a reliable way
 * back to a known-good start, and clearing site data by hand in front of an
 * audience is not it. Async so the caller can reload only once the server has
 * actually wiped — reloading first would re-hydrate the old state straight back.
 */
export async function resetAll(): Promise<void> {
  cache = {}
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`${NAMESPACE}.`)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
    for (const k of ['anadromos.liveSessions', 'anadromos.liveOversight', 'anadromos.problemSets', 'anadromos.liveGaps.v1']) {
      localStorage.removeItem(k)
      sessionStorage.removeItem(k)
    }
  } catch {
    // Nothing sensible to do; the caller reloads regardless.
  }
  if (!serverUp) return
  try {
    await fetch(API_BASE, { method: 'DELETE' })
  } catch {
    // Already gone, or never there.
  }
}

/** True when anything has been persisted — drives whether "Reset demo" is offered. */
export function hasSavedState(): boolean {
  if (Object.keys(cache).length > 0) return true
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`${NAMESPACE}.`)) return true
    }
  } catch {
    return false
  }
  return false
}
