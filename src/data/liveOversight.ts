import type { OversightItem } from './oversight'

/**
 * Live, session-detected Oversight flags - real detection, as opposed to
 * data/oversight.ts's OVERSIGHT_RAW, which is static sample narrative. The
 * one gaming pattern this prototype's own mechanics can actually observe is
 * three consecutive "I got it all wrong" attempts (PracticeLoop's
 * `flaggedLines === 'all'`) within one Lesson or Review session - see the
 * counters in components/LessonSession.tsx and components/ReviewSession.tsx
 * and where StudentApp.tsx wires their `onGamingSignal` callback to
 * `pushLiveFlag` below.
 *
 * Same shape and same caveat as data/teacherProblemSets.ts: a plain
 * module-level array, backed by sessionStorage, not a live backend. It does
 * NOT sync across already-mounted routes - TeacherApp.tsx's Oversight screen
 * only sees a flag pushed from /student the next time it (re)renders/mounts,
 * not instantly if it happened to already be open in the background. A hard
 * reload no longer loses it (sessionStorage survives for this tab), but a
 * new tab or a different browser still starts fresh, same as everything
 * else in this prototype.
 */

export interface LiveFlag extends OversightItem {
  id: string
}

const STORAGE_KEY = 'anadromos.liveOversight'

/** Reads back whatever was persisted for this tab - any parse failure is treated as "nothing saved yet" rather than thrown. */
function loadInitial(): LiveFlag[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(flags: LiveFlag[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flags))
  } catch {
    // Storage unavailable - the in-memory array still works for the rest of this tab's session.
  }
}

const liveFlags: LiveFlag[] = loadInitial()
let seq = liveFlags.reduce((max, f) => Math.max(max, Number(f.id.slice(4)) || 0), -1) + 1

/** Appends a live-detected Oversight flag and returns it (with its assigned id). */
export function pushLiveFlag(item: OversightItem): LiveFlag {
  const flagged: LiveFlag = { ...item, id: `live${seq++}` }
  liveFlags.push(flagged)
  persist(liveFlags)
  return flagged
}

/** Every live flag detected so far, oldest first. */
export function getLiveFlags(): LiveFlag[] {
  return liveFlags
}
