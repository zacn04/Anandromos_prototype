/**
 * The multi-student engine store — one live `EngineState` per student, shared
 * by every point of view.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ THE PROBLEM THIS SOLVES                                              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * `data/engine.ts` is pure logic for ONE student and holds nothing. Until this
 * module existed, the only live `EngineState` in the app was a `useState` inside
 * `StudentApp` for `'aisha'`. Teacher and parent are separate routes with
 * separate React trees, so they could not see it, and no student other than
 * Aisha had live state at all — which is why the teacher's class dashboard had
 * nothing real to show.
 *
 * This module is the single owner instead: a module-level `Map` of studentId →
 * `EngineState`, written through `data/persist.ts` (server-backed, with a
 * localStorage mirror), plus a subscribe/notify pair so a mounted component
 * re-renders when a different POV moves a student's state.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ EVERY READ IS SYNCHRONOUS                                            │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Same contract as the content store and `persist.ts`: async once at boot
 * (`hydrate()` in `main.tsx`), synchronous everywhere after. Nothing here
 * returns a promise, nothing here suspends, and `engineFor` never returns
 * undefined — an unknown student gets the same honest all-zero state
 * `initEngineState` already falls back to for a roster name with no sample
 * profile, never another student's data relabelled.
 *
 * IDs are the same namespace as `sampleStudentIds()` — lowercase first name
 * (`'aisha'`, `'daniel'`, `'reuben'`), which is also what `TeacherApp` derives
 * from a roster name. There is no id for the other roster names beyond that
 * convention; `engineFor` will happily serve them, it will just have nothing
 * to seed from. Use `isKnownStudent` to tell the two apart before showing a
 * number that would otherwise read as "this student knows nothing".
 *
 * Persistence keys are `engine.<studentId>` — deliberately the same key
 * `StudentApp` already writes, so state saved before this module existed is
 * picked up rather than orphaned.
 */
import { initEngineState, recordAttempt } from './engine'
import type { AttemptEvent, EngineState } from './engine'
import { load, save } from './persist'
import { isContentLoaded, sampleStudentIds } from '../content'
import { useSyncExternalStore } from 'react'

/** Convenience re-exports: the two engine types that appear in this module's own signatures. */
export type { AttemptEvent, EngineState } from './engine'

const engineKey = (studentId: string): string => `engine.${studentId}`

/**
 * The list of students this store has written state for. Needed because
 * `persist.ts` exposes `load`/`save` and no key enumeration — deliberately, it
 * is a key/value cache and not a database — so "which students exist" has to be
 * a value we keep ourselves. Sample-content students are NOT in here; they come
 * from `sampleStudentIds()`, which is authored content and the source of truth
 * for them.
 *
 * Namespaced away from `engine.*` / `progress.*` / `xp.*` so it can never
 * collide with a student id.
 */
const INDEX_KEY = 'students.index'

/**
 * The shared "nothing yet" state. Returned only when something reads this store
 * before `loadContent()` has resolved, which should not happen — `main.tsx`
 * awaits it before the first render. It is frozen and never cached, so a read
 * that lands in that window cannot poison the cache with an empty state that
 * would then outlive the content load.
 */
const EMPTY_ENGINE: EngineState = Object.freeze({
  nodes: Object.freeze({}),
  masteryByTopic: Object.freeze({}),
}) as EngineState

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/**
 * studentId → the live state. Entries are only ever REPLACED, never mutated, so
 * an entry's object identity is stable between writes. That is what makes
 * `engineFor` safe to use directly as a `useSyncExternalStore` snapshot.
 */
const engines = new Map<string, EngineState>()

/** Bumped on every write. The `useSyncExternalStore` snapshot for "anything changed". */
let version = 0

const listeners = new Set<() => void>()

/** Lazily read from `INDEX_KEY`; null until first use so nothing touches storage at import time. */
let registered: Set<string> | null = null

/** Memoised `knownStudentIds()` result — a stable array identity, invalidated on registration. */
let cachedIds: readonly string[] | null = null

function notify(): void {
  // Copied, so a listener that unsubscribes itself mid-notification cannot
  // disturb the iteration.
  for (const listener of [...listeners]) listener()
}

function registeredIds(): Set<string> {
  if (!registered) {
    const saved = load<string[]>(INDEX_KEY, [])
    registered = new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string' && id !== '') : [])
  }
  return registered
}

/**
 * Records that this student has real state of their own. Called on every write,
 * and on a read that finds a persisted value — including the `engine.aisha`
 * `StudentApp` wrote before this store existed.
 *
 * Deliberately does NOT notify: nothing about anyone's state changed, only our
 * bookkeeping of who exists. It does drop the `knownStudentIds` memo, which is
 * why a first read of a previously-unseen persisted student can hand back a new
 * array identity once. That settles after one render and cannot loop.
 */
function remember(studentId: string): void {
  const ids = registeredIds()
  if (ids.has(studentId)) return
  ids.add(studentId)
  cachedIds = null
  save(INDEX_KEY, [...ids])
}

/**
 * Shape check for a persisted value. A saved state from an older shape, a
 * half-written value, or a hand-edited server file re-seeds from sample content
 * instead of crashing a render — losing a demo's progress is bad, taking the
 * whole app down mid-pitch is worse.
 */
function isEngineState(value: unknown): value is EngineState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EngineState>
  return (
    typeof candidate.nodes === 'object' && candidate.nodes !== null &&
    typeof candidate.masteryByTopic === 'object' && candidate.masteryByTopic !== null
  )
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

/**
 * This student's live state. Never undefined.
 *
 * Resolution order, once per student per session: the in-memory entry, then
 * whatever `persist.ts` has under `engine.<studentId>`, then a fresh
 * `initEngineState(studentId)` seeded from the sample overlays. The result is
 * cached, so the returned object identity is stable until someone writes.
 *
 * Seeding is memoisation, not a write: it does not persist and does not notify,
 * which is what makes this safe to call during render (including from
 * `useSyncExternalStore`). A seed is deterministic from content, so re-deriving
 * it on the next load costs nothing.
 */
export function engineFor(studentId: string): EngineState {
  const cached = engines.get(studentId)
  if (cached) return cached

  const persisted = load<EngineState | null>(engineKey(studentId), null)
  if (isEngineState(persisted)) {
    engines.set(studentId, persisted)
    remember(studentId)
    return persisted
  }

  // `initEngineState` reads the content store, which throws if content has not
  // loaded. Serve the empty state without caching rather than crash — see
  // EMPTY_ENGINE.
  if (!isContentLoaded()) return EMPTY_ENGINE

  const seeded = initEngineState(studentId)
  engines.set(studentId, seeded)
  return seeded
}

/**
 * Every student this store or the sample content knows about, sample-content
 * students first in authored order (aisha, daniel, reuben), then anyone the
 * store has written state for.
 *
 * NOT the class roster: `defaultRoster()` is eight display names, and the
 * teacher's lanes are twenty-four, none of which are student ids and most of
 * which have no content behind them. Deriving ids from those names is a
 * decision for the POV that owns the roster, not for this store to invent.
 */
export function knownStudentIds(): readonly string[] {
  if (cachedIds) return cachedIds

  const seen = new Set<string>()
  const ids: string[] = []
  const push = (id: string): void => {
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }

  const contentLoaded = isContentLoaded()
  if (contentLoaded) for (const id of sampleStudentIds()) push(id)
  for (const id of registeredIds()) push(id)

  // Only memoise once content is in, or an early read would freeze a list that
  // is missing every sample student.
  if (contentLoaded) cachedIds = ids
  return ids
}

/**
 * Whether this student has state of their own — a sample profile, or something
 * they have actually done. False means `engineFor` will hand back an all-zero
 * state because there is nothing to show, which is a different thing from a
 * student who has genuinely mastered nothing. Show the honest "not built out
 * yet" note for these, never a 0%.
 */
export function isKnownStudent(studentId: string): boolean {
  // Deliberately NOT `engines.has(...)`: merely having been looked at is not
  // knowing anything, and a class dashboard reads every roster id it renders.
  // Exactly the membership test for `knownStudentIds()`, by construction.
  if (registeredIds().has(studentId)) return true
  return isContentLoaded() && sampleStudentIds().includes(studentId)
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

/**
 * Replaces this student's state and persists it. Notifies every subscriber, in
 * this tab, across POVs.
 *
 * Handing back the exact object `engineFor` just returned is a no-op — there is
 * nothing to persist and nothing to re-render for.
 */
export function setEngineFor(studentId: string, state: EngineState): void {
  if (engines.get(studentId) === state) return
  engines.set(studentId, state)
  remember(studentId)
  save(engineKey(studentId), state)
  version++
  notify()
}

/**
 * Records one attempt for this student and returns the new state — the whole
 * read-modify-write in one call, which is what every practice surface actually
 * wants. `recordAttempt` never mutates, so the previous state is still valid
 * for anything holding it.
 *
 * `now` is passed straight through, so a smoke test or a scripted demo can
 * drive the spaced-repetition schedule at a fixed clock.
 */
export function recordFor(studentId: string, event: AttemptEvent, now?: number): EngineState {
  const next = recordAttempt(engineFor(studentId), event, now)
  setEngineFor(studentId, next)
  return next
}

/**
 * Re-reads this student from `persist.ts`, discarding the cached object.
 *
 * The escape hatch for the transitional period while `StudentApp` still owns a
 * `useState` copy of Aisha's engine and write-throughs it to the same key: this
 * store would otherwise keep serving whatever it read first. Call it from an
 * effect (on mount, or on POV entry), never during render.
 *
 * Idempotent: an unchanged value keeps its existing object identity and
 * notifies nobody, so calling it on every mount cannot cause a render loop.
 */
export function refreshFor(studentId: string): EngineState {
  const persisted = load<EngineState | null>(engineKey(studentId), null)
  if (!isEngineState(persisted)) return engineFor(studentId)

  const cached = engines.get(studentId)
  if (cached === persisted) return cached
  if (cached && JSON.stringify(cached) === JSON.stringify(persisted)) return cached

  engines.set(studentId, persisted)
  remember(studentId)
  version++
  notify()
  return persisted
}

// ---------------------------------------------------------------------------
// subscription — the `useSyncExternalStore` pair
// ---------------------------------------------------------------------------

/** Registers a change listener. Returns the unsubscribe, as `useSyncExternalStore` requires. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * A monotonic version, bumped by every write to any student. A number, not an
 * object, precisely because `useSyncExternalStore` compares snapshots by
 * identity and would loop forever on a freshly-allocated one.
 */
export function getSnapshot(): number {
  return version
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------
// Thin, and the only React in this file. They exist so that three separate POVs
// wire up to the same store the same way, rather than each hand-rolling the
// subscription and one of them getting the snapshot-identity rule wrong.

/**
 * One student's live state, re-rendering when anything moves it — including a
 * write from another POV.
 *
 *   const engine = useEngine('aisha')
 */
export function useEngine(studentId: string): EngineState {
  const read = (): EngineState => engineFor(studentId)
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * Subscribes to "any student changed" without picking one. This is the pattern
 * for a class dashboard, which needs many students at once:
 *
 *   useEngineVersion()
 *   const rows = knownStudentIds().map((id) => summarise(id, engineFor(id)))
 *
 * There is deliberately no `useEngines(ids)` — it would have to allocate a new
 * array every render, which is exactly the snapshot-identity mistake
 * `getSnapshot` returning a number avoids.
 */
export function useEngineVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** `knownStudentIds()` with a subscription. Stable array identity between changes. */
export function useKnownStudentIds(): readonly string[] {
  return useSyncExternalStore(subscribe, knownStudentIds, knownStudentIds)
}
