/**
 * Teacher-authored problem sets (TeacherApp.tsx's "Homework" screen), kept
 * here rather than inside either app because TeacherApp.tsx and
 * StudentApp.tsx are separate routes with no existing cross-route store in
 * this codebase - a plain module-level array, backed by sessionStorage, is
 * the proportionate amount of machinery for a prototype (no Redux/Context,
 * no real backend, needed for one array).
 *
 * IMPORTANT - this does NOT live-sync across already-mounted routes. It's a
 * JS module singleton: any route that imports it reads whatever is
 * currently in `problemSets` at render time, but nothing here triggers a
 * re-render of a route that's already mounted elsewhere when the array
 * changes. In practice that means a problem set created in /teacher shows up
 * in /student's list the next time StudentApp mounts (e.g. navigating to it
 * fresh) - not instantly if a student view happened to already be sitting
 * open in the background. The sessionStorage backing means a hard reload no
 * longer loses it - it survives for as long as this browser tab does - but
 * it's still not a real backend: a new tab, a different browser, or closing
 * this one starts fresh, same as every other piece of state in this
 * prototype (see data/engine.ts).
 *
 * Question shape intentionally matches StudentApp.tsx's existing PS_SET.questions
 * items exactly (topic / q / hint) so a created set can be handed straight to
 * the same homework-solving screen without any translation step.
 */

export interface AuthoredQuestion {
  topic: string
  q: string
  hint: string
}

export interface AuthoredProblemSet {
  id: string
  title: string
  /** Display string, topics joined with ' · ' - matches PS_SET.topics / PROBLEM_SETS[].topics' shape. */
  topics: string
  /** Free text, exactly as the teacher typed it - no date parsing/validation in this prototype. */
  due: string
  questions: AuthoredQuestion[]
  /** Teacher-set flag: block submission in `psolve` until the student attaches a photo of their handwritten working - same field PracticeLoop's `requireHandwriting` prop gates, applied at the whole-set level instead of per-problem. */
  requireHandwriting?: boolean
}

const STORAGE_KEY = 'anadromos.teacherProblemSets'

/** Reads back whatever was persisted for this tab - any parse failure (corrupted value, private-mode quota, storage disabled) is treated the same as "nothing saved yet" rather than thrown. */
function loadInitial(): AuthoredProblemSet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(sets: AuthoredProblemSet[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sets))
  } catch {
    // Storage unavailable (private mode quota, disabled, etc.) - the in-memory array still
    // works for the rest of this tab's session, it just won't survive a reload.
  }
}

const problemSets: AuthoredProblemSet[] = loadInitial()
// Resumes numbering after whatever was already persisted, rather than a separately-stored
// counter that could drift out of sync with it.
let seq = problemSets.reduce((max, p) => Math.max(max, Number(p.id.slice(2)) || 0), -1) + 1

/** Appends a newly-authored problem set and returns it (with its assigned id). */
export function addProblemSet(input: { title: string; topics: string; due: string; questions: AuthoredQuestion[]; requireHandwriting?: boolean }): AuthoredProblemSet {
  const created: AuthoredProblemSet = { id: `hw${seq++}`, ...input }
  problemSets.push(created)
  persist(problemSets)
  return created
}

/** Every problem set created so far, oldest first. */
export function getProblemSets(): AuthoredProblemSet[] {
  return problemSets
}
