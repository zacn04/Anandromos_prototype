import type { LogActivity } from '../content'

/**
 * Live Lesson/Review sessions Aisha has actually completed, surfaced
 * alongside the static sample history in both her own Sessions list
 * (StudentApp.tsx) and the teacher's per-student Activity Log
 * (TeacherApp.tsx) - see components/LessonSession.tsx and
 * ReviewSession.tsx's `onSessionLogged`, fired once a session reaches its
 * summary screen.
 *
 * Same module-singleton-plus-localStorage pattern as
 * data/teacherProblemSets.ts and data/liveOversight.ts, including the same
 * caveat: does NOT live-sync into an already-mounted route, survives a
 * reload in this tab, and starts fresh in a new tab or browser. See either
 * of those files' comments for the full explanation.
 */

const STORAGE_KEY = 'anadromos.liveSessions'

/** Reads back whatever was persisted for this tab - any parse failure is treated as "nothing saved yet" rather than thrown. */
function loadInitial(): LogActivity[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(sessions: LogActivity[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // Storage unavailable - the in-memory array still works for the rest of this tab's session.
  }
}

const liveSessions: LogActivity[] = loadInitial()

/** Records a just-completed live session. Newest first, so it reads above the static "Today"/"Yesterday" sample rows rather than after them. */
export function pushLiveSession(entry: LogActivity): LogActivity {
  liveSessions.unshift(entry)
  persist(liveSessions)
  return entry
}

/** Every live session recorded so far, most recent first. */
export function getLiveSessions(): LogActivity[] {
  return liveSessions
}
