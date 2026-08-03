import { useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { GraphSvg } from '../components/GraphSvg'
import { NodeInfoCard } from '../components/NodeInfoCard'
import { PracticeLoop } from '../components/PracticeLoop'
import {
  activityLogFor,
  catalogueGroups,
  defaultBasket,
  edgePairs,
  edgePath,
  graphFilters,
  graphTopics,
  oversightItems,
  prereqsOf,
  questionAt,
  schoolClasses,
  teachers,
  topicById,
  topicLabel,
  studentProfile,
  yearBands,
} from '../content'
import type { LogQuestion, NodeStats, NodeStatus, OversightDetail, Topic, TopicId } from '../content'
import { getLiveFlags } from '../data/liveOversight'
import { summariseGaps } from '../data/liveGaps'
import { suggestedOrder, orderWarnings, missingPrereqs } from '../data/basket'
import { exportProfile, importProfile, importSummary } from '../data/transfer'
import type { ImportResult, TransferableProfile } from '../data/transfer'
import { buildQueue, dueLabel } from '../data/schedule'
import { masteryBand } from '../data/xp'
import { engineFor, isKnownStudent, setEngineFor, useEngineVersion, useKnownStudentIds } from '../data/students'
import type { EngineState } from '../data/students'
import { initEngineState } from '../data/engine'
import type { TierMastery } from '../data/engine'
import { getLiveSessions } from '../data/liveSessions'
import { enrolledClassOf, enrolStudent, setStudentName, studentIdForName, studentName, unenrolStudent, useStudentName } from '../data/profile'
import { addProblemSet, getProblemSets, gradable, mintQuestions } from '../data/teacherProblemSets'
import type { AuthoredQuestion } from '../data/teacherProblemSets'
import { FONT_MONO, FONT_SERIF, NODE_STYLE, OVERSIGHT_KIND_META } from '../theme'

/**
 * Teacher POV — triage a class, drill into a student's knowledge profile,
 * pinpoint why a student is stuck, run the Oversight queue, keep an
 * "Address in person" list, and set up classes/baskets.
 */

type Screen =
  | 'dashboard'
  | 'student'
  | 'graphfull'
  | 'graphfocused'
  | 'logdetail'
  | 'oversight'
  | 'setup'
  | 'homework'
  | 'practice'

interface AddressItem {
  id: string
  student: string
  context: string
  note: string
}

interface LogDetailSource {
  kind: string
  title: string
  date: string
  result: string
  flag: 'attention' | 'ok'
  upload: boolean
  items: readonly LogQuestion[]
}

/**
 * The result of reading a transferable profile off disk. `result` is null when
 * the file could not be read at all, in which case `error` says why — a
 * mangled download and a profile from a different graph are two different
 * problems and must not look the same.
 */
interface ImportPanel {
  fileName: string
  studentId: string
  result: ImportResult | null
  error: string | null
  /** True once the teacher has explicitly loaded it into that student's live state. */
  applied: boolean
}

interface TeacherState {
  screen: Screen
  layout: 'attention' | 'lanes' | 'roster'
  expOnTrack: boolean
  expAhead: boolean
  activeClass: string
  selectedStudentId: string
  /** One-line result of the last transferable-profile export. */
  transferNote: string | null
  /** The last transferable-profile *import*, with everything it could not carry over. */
  importPanel: ImportPanel | null
  graphFilter: string
  openLog: number | null
  selectedNode: string | null
  selectedLog: number | null
  qOpen: number | null
  ovDetail: OversightDetail | null
  detailReturn: 'student' | 'oversight'
  addressList: AddressItem[]
  dismissedOv: string[]
  /** How far through the selected student's topic the practice preview has walked. */
  previewIdx: number
  addSeq: number
  addingNote: boolean
  noteDraft: string
  menuOpen: string | null
  suClass: string
  suGrade: string
  suYear: string
  suSearch: string
  suDraft: string
  suBasket: Record<string, boolean>
  // ---- Homework (teacher problem-set authoring) ----
  hwTitle: string
  hwDue: string
  hwSearch: string
  hwBasket: Record<string, boolean>
  /** Topic label the next drafted question will be tagged with - one of the currently-checked hwBasket labels. */
  hwQTopic: string
  hwQText: string
  hwQHint: string
  hwQuestions: AuthoredQuestion[]
  /** Whole-set "require handwriting" gate - see data/teacherProblemSets.ts's AuthoredProblemSet.requireHandwriting and StudentApp.tsx's psolve submit-gating. */
  hwRequireHandwriting: boolean
  /** Which already-created set (see data/teacherProblemSets.ts) has its questions expanded open. */
  hwExpandedId: string | null
}

const monoCap = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  color: '#8a7c63',
  ...extra,
})

const chip = (status: string): CSSProperties => {
  if (status === 'attention')
    return { background: '#fbe7d8', color: '#b6531f', border: '1px solid #eecab0', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }
  if (status === 'ahead')
    return { background: '#e8f0f4', color: '#2f6f92', border: '1px solid #cfe0e9', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }
  return { background: '#e4edf3', color: '#1f4e75', border: '1px solid #cddceb', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }
}

/** Same id convention `mkStudent()` derives from a roster name — lowercase first name. */
const idForName = (name: string): string => name.split(' ')[0].toLowerCase()

const avatar = (color?: string): CSSProperties => ({
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: color || '#0e2a43',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 600,
  fontSize: 12,
  flex: 'none',
})

const tierFill = (frac: number, color: string): CSSProperties => ({
  width: `${frac * 100}%`,
  height: '100%',
  background: color,
  borderRadius: 5,
})

const kindStyle: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '2px 7px',
  borderRadius: 5,
  background: '#efe7d9',
  color: '#8a7c63',
  flex: 'none',
}

const logFlag = (f: string): CSSProperties =>
  f === 'attention'
    ? { background: '#fbe7d8', color: '#b6531f', border: '1px solid #eecab0' }
    : { background: '#e4edf3', color: '#1f4e75', border: '1px solid #cddceb' }

const chipStyle = (bg: string, col: string, bd: string): CSSProperties => ({
  background: bg,
  color: col,
  border: `1px solid ${bd}`,
  fontSize: 12,
  fontWeight: 500,
  padding: '5px 11px',
  borderRadius: 7,
})

// difficulty-weighted tier triple: Foundations / Core / Stretch
const T = (f: number, c: number, st: number) => [
  { f, color: '#1f4e75' },
  { f: c, color: '#4a86ad' },
  { f: st, color: '#e8a06a' },
]

// ---------------------------------------------------------------------------
// LIVE CLASS TRIAGE
// ---------------------------------------------------------------------------
// The three lanes, the per-student sentence and the class mastery bars used to
// be three hand-written arrays. They are now computed from every student's
// `EngineState` (via `data/students.ts`), which is the same state the student
// and parent POVs read and the same state practice writes to.
//
// WHY NOT A BARE AVERAGE. The design brief is explicit that a student must not
// be able to look fine by only clearing a topic's easy items. Every mastery
// number below is therefore difficulty-weighted — a stretch item counts three
// times a foundations one — and the "avoiding the hard end" signal is scored
// separately on top of that. A flat mean of the three tiers would put Daniel
// (foundations 95%, stretch 0%) in the middle of the class.
//
// THE SIGNALS, all read from live state, none of them a name list:
//
//   STALLED   real attempts behind the current topic and its difficulty-weighted
//             mastery still very low. Names the weakest *prerequisite* when the
//             graph has one below par — that is the "missing foundation" read.
//   AVOIDING  foundations strong, stretch near zero, with enough reps for that
//             shape to be a habit rather than a start.
//   THIN      practice volume far below the class median. Measured against the
//             class rather than an invented target, because "enough practice"
//             is not a number anyone can state in the abstract.
//   OVERDUE   reviews that `buildQueue` says are due or overdue, weighted by how
//             overdue the oldest one is.
//   STALE     nothing logged for over a week.
//   SLIPPED   topics `masteryBand` puts in the 'relearn' band, with enough reps
//             behind them for that to be evidence rather than a fresh start.
//
// A student is in the attention lane when those sum past ATTENTION_BAR; the
// heaviest single signal becomes the row's cause and its one sentence, so the
// sentence always says the thing that actually put them there.
//
// AHEAD is deliberately not "high score". It is: working on material above the
// class's own year band, with the prerequisites under it mastered. That is a
// fact about the curriculum graph rather than a ranking, which matters — the
// design brief rules out anything that reads as a class league table.

/** The one class in this prototype with a roster of real student state behind it. */

/** Stable empty roster, so a class with no students does not reallocate per render. */

/** Whose dashboard this is. Matches `content/school/teachers.json`. */
const TEACHER_ID = 'teacher.okafor'

/**
 * Roster display names for the seeded cohort. The content store holds student
 * *ids* (lowercase first names) and no display names at all, so surnames are the
 * one authored thing left on this screen; who is in the class, and everything
 * shown about them, comes from content or from a student enrolled on the setup
 * screen. Checked only after `studentName` (data/profile.ts), so a student who
 * has named themselves is never overridden by this table. An id in neither
 * still renders, under its capitalised first name.
 */
const ROSTER_NAMES: Record<string, string> = {
  aisha: 'Aisha Bello',
  daniel: 'Daniel Kovač',
  reuben: 'Reuben Clarke',
  priya: 'Priya Shah',
  tom: 'Tom Weller',
  grace: 'Grace Idowu',
  marcus: 'Marcus Lin',
  sofia: 'Sofia Rossi',
  jack: 'Jack Enright',
  amara: 'Amara Okoli',
  leo: 'Leo Marsh',
  hana: 'Hana Ali',
  noah: 'Noah Pratt',
  ivy: 'Ivy Chen',
  ben: 'Ben Osei',
  ruth: 'Ruth Adeyemi',
  sam: 'Sam Doyle',
  elif: 'Elif Demir',
  oscar: 'Oscar Reid',
  maya: 'Maya Kumar',
  finn: 'Finn Walsh',
  zara: 'Zara Haq',
  louis: 'Louis Berger',
  nina: 'Nina Petrov',
}

/**
 * A student renaming themselves in their own view (data/profile.ts) wins here:
 * the teacher's class list should call them what they call themselves. Falls
 * back to this file's roster surnames, then to the capitalised id.
 */
/**
 * Which class a student is in.
 *
 * A student enrolled on the setup screen (data/profile.ts) wins over the
 * content store, which is what turns "add a student" from a form that appended
 * to a local string array into something that actually puts a person on the
 * class dashboard, in the drill-down, and in range of assigned homework.
 */
const classOfStudent = (id: string): string | undefined =>
  enrolledClassOf(id) ?? studentProfile(id)?.classId

const displayName = (id: string): string => {
  const chosen = studentName(id)
  if (chosen !== id) return chosen
  return ROSTER_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

// ---- tuning ---------------------------------------------------------------
/** Attempts before a tier profile is evidence rather than a topic just opened. */
const MIN_REPS_FOR_EVIDENCE = 5
/** Difficulty-weighted mastery under this, with reps behind it, reads as stalled. */
const STALLED_BELOW = 0.3
/** A prerequisite under this is worth naming as the thing to re-teach first. */
const WEAK_PREREQ_BELOW = 0.45
/** foundations − stretch at or above this is the "clears the easy items" shape. */
const AVOIDANCE_GAP = 0.8
/** Practice volume below this fraction of the class median is thin. */
const THIN_RATIO = 0.75
/** Days with nothing logged before it is worth the teacher's attention. */
const STALE_DAYS = 7
/** Summed signal weight at which a student enters the attention lane. */
const ATTENTION_BAR = 0.6
/** A class average is only shown once this share of the class has worked the topic. */
const CLASS_AVERAGE_SHARE = 5

type Lane = 'attention' | 'ontrack' | 'ahead'

interface WeakLink {
  topicId: TopicId
  label: string
  weighted: number
}

interface StudentSignal {
  id: string
  name: string
  initials: string
  lane: Lane
  score: number
  /** The topic they are actually working on now, derived from node status + recency. */
  topicId: TopicId | null
  topicLabel: string
  /** Days since anything at all was logged; null when nothing ever was. */
  daysSince: number | null
  lastLabel: string
  /** Short tag under the name on an attention card, e.g. "Stuck · 5 attempts". */
  trend: string
  /** The one-word status chip on an attention card. */
  chipLabel: string
  /** Plain-language cause, e.g. "Missing foundational knowledge". */
  cause: string
  /** The single sentence every lane's row shows. Derived from the dominant signal. */
  line: string
  /** Weakest prerequisite under the current topic, when it has one with evidence. */
  weakestLink: WeakLink | null
  dueCount: number
  totalReps: number
}

/** Difficulty-weighted mastery: a stretch item is worth three foundations items. */
const weightedMastery = (m: TierMastery): number => (m.foundations + 2 * m.core + 3 * m.stretch) / 6

const pct = (n: number): string => `${Math.round(n * 100)}%`

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Days since an engine `last` label. Handles the suffixed forms `recordAttempt`
 * writes ('today · trickle-down') and the sample overlays carry ('2 days ago ·
 * free play'). Returns null for '—' and anything else it cannot read, which is
 * "never worked" — never 0, which would read as "worked today".
 */
function daysSinceLabel(label: string): number | null {
  const head = (label ?? '').split(' · ')[0].trim()
  if (head === 'today') return 0
  if (head === 'yesterday') return 1
  const match = /^(\d+) days? ago$/.exec(head)
  return match ? Number(match[1]) : null
}

const recencyLabel = (days: number | null): string =>
  days === null ? 'not started' : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`

function totalRepsOf(state: EngineState): number {
  let total = 0
  for (const id of Object.keys(state.nodes)) total += state.nodes[id].reps ?? 0
  return total
}

/**
 * The topic a student is actually on: the most recently touched frontier or
 * in-progress node, breaking ties on reps and then on depth in the graph. Falls
 * back to whatever they touched most recently when nothing is open.
 */
function currentTopicOf(state: EngineState, depthOf: (id: TopicId) => number): TopicId | null {
  let best: TopicId | null = null
  let bestDays = Infinity
  let bestReps = -1
  let bestDepth = -1
  for (const id of Object.keys(state.nodes)) {
    const node = state.nodes[id]
    if (node.status !== 'frontier' && node.status !== 'inprogress') continue
    const days = daysSinceLabel(node.last)
    if (days === null) continue
    const depth = depthOf(id)
    const better =
      days < bestDays ||
      (days === bestDays && (node.reps > bestReps || (node.reps === bestReps && depth > bestDepth)))
    if (better) {
      best = id
      bestDays = days
      bestReps = node.reps
      bestDepth = depth
    }
  }
  if (best) return best

  for (const id of Object.keys(state.nodes)) {
    const days = daysSinceLabel(state.nodes[id].last)
    if (days === null || days >= bestDays) continue
    best = id
    bestDays = days
  }
  return best
}

/** One scored signal, carrying the words the row will use if it turns out to be the dominant one. */
interface Reason {
  weight: number
  cause: string
  trend: string
  chip: string
  line: string
}

interface AssessContext {
  medianReps: number
  depthOf: (id: TopicId) => number
  classYearBand: string
  /** Year bands in curriculum order, so "above this class" is an ordering, not a string compare. */
  bandOrder: readonly string[]
}

function assessStudent(id: string, state: EngineState, ctx: AssessContext): StudentSignal {
  const name = displayName(id)
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
  const nodeIds = Object.keys(state.nodes)

  const base = {
    id,
    name,
    initials,
    score: 0,
    trend: '',
    chipLabel: '',
    cause: '',
    weakestLink: null,
    dueCount: 0,
  }

  // Nothing behind this student at all. Say so, rather than showing a 0% that
  // reads as "knows nothing".
  if (nodeIds.length === 0) {
    return {
      ...base,
      lane: 'ontrack',
      topicId: null,
      topicLabel: 'Not started',
      daysSince: null,
      lastLabel: 'not started',
      line: 'No practice recorded yet — nothing has been logged against this student.',
      totalReps: 0,
    }
  }

  const topicId = currentTopicOf(state, ctx.depthOf)
  const node = topicId ? state.nodes[topicId] : null
  const label = topicId ? topicLabel(topicId) : 'Not started'
  const current = topicId ? state.masteryByTopic[topicId] : undefined
  const currentWeighted = current ? weightedMastery(current) : null

  let daysSince: number | null = null
  for (const t of nodeIds) {
    const d = daysSinceLabel(state.nodes[t].last)
    if (d !== null && (daysSince === null || d < daysSince)) daysSince = d
  }

  // The scheduler decides what is due, not this screen.
  const queue = buildQueue(state)
  const dueReviews = queue.items.filter((item) => item.kind === 'review' && item.dueInDays <= 0)
  let oldestDue = dueReviews[0] ?? null
  for (const item of dueReviews) if (item.dueInDays < oldestDue.dueInDays) oldestDue = item
  const overdueDays = oldestDue ? Math.max(0, -oldestDue.dueInDays) : 0

  const totalReps = totalRepsOf(state)

  // Topics below the re-teach line, with enough attempts behind them that the
  // band is a read on the student rather than on a topic barely begun.
  let slipped: WeakLink | null = null
  let slippedCount = 0
  for (const t of Object.keys(state.masteryByTopic)) {
    const mastery = state.masteryByTopic[t]
    if (masteryBand(t, mastery) !== 'relearn') continue
    if ((state.nodes[t]?.reps ?? 0) < MIN_REPS_FOR_EVIDENCE) continue
    slippedCount++
    const w = weightedMastery(mastery)
    if (!slipped || w < slipped.weighted) slipped = { topicId: t, label: topicLabel(t), weighted: w }
  }

  // The weakest direct prerequisite of what they are on now — the real weakest link.
  let weakestLink: WeakLink | null = null
  if (topicId) {
    for (const p of prereqsOf(topicId)) {
      const mastery = state.masteryByTopic[p]
      if (!mastery) continue
      const w = weightedMastery(mastery)
      if (!weakestLink || w < weakestLink.weighted) weakestLink = { topicId: p, label: topicLabel(p), weighted: w }
    }
  }

  // Work above the class's own year band, with everything under it mastered.
  const classBand = ctx.bandOrder.indexOf(ctx.classYearBand)
  let beyondBand: TopicId | null = null
  for (const t of nodeIds) {
    const status = state.nodes[t].status
    if (status !== 'frontier' && status !== 'inprogress' && status !== 'mastered') continue
    const topic = topicById(t)
    if (!topic || ctx.bandOrder.indexOf(topic.yearBand) <= classBand) continue
    if (!beyondBand || ctx.depthOf(t) > ctx.depthOf(beyondBand)) beyondBand = t
  }

  const reasons: Reason[] = []

  if (current && node && currentWeighted !== null && node.reps >= MIN_REPS_FOR_EVIDENCE && currentWeighted < STALLED_BELOW) {
    const blocked = weakestLink && weakestLink.weighted < WEAK_PREREQ_BELOW ? weakestLink : null
    reasons.push({
      weight: (STALLED_BELOW - currentWeighted) * 4,
      cause: blocked ? 'Missing foundational knowledge' : 'Stalled on the current topic',
      trend: `Stuck · ${plural(node.reps, 'attempt')}`,
      chip: 'Stuck',
      line:
        `${label}: ${plural(node.reps, 'attempt')} logged and core is still ${pct(current.core)}, stretch ${pct(current.stretch)}.` +
        // "weakest prerequisite", never "weakest link" — it is the weakest of the
        // topic's prerequisites, which is not the same claim as being the weakest
        // thing the student has, and the two must not be conflated.
        (blocked ? ` The weakest prerequisite under it, ${blocked.label}, is itself only at ${pct(blocked.weighted)}.` : ''),
    })
  }

  if (current && node && node.reps >= MIN_REPS_FOR_EVIDENCE + 1 && current.foundations - current.stretch >= AVOIDANCE_GAP) {
    reasons.push({
      weight: 0.6,
      cause: 'Ineffective practice method',
      trend: 'Plateaued · easy items only',
      chip: 'Plateaued',
      line: `${label}: foundations at ${pct(current.foundations)} but stretch at ${pct(current.stretch)} — the average reads higher than the real mastery.`,
    })
  }

  const repRatio = ctx.medianReps > 0 ? totalReps / ctx.medianReps : 1
  if (repRatio < THIN_RATIO) {
    reasons.push({
      weight: (THIN_RATIO - repRatio) * 2.5,
      cause: 'Not enough practice',
      trend: `${plural(totalReps, 'attempt')} in total`,
      chip: 'Thin practice',
      line:
        `${plural(totalReps, 'attempt')} logged against a class median of ${ctx.medianReps}` +
        (node ? `, and ${label} has ${node.reps} of them — too few for it to become durable.` : ' — too few to build on.'),
    })
  }

  if (oldestDue) {
    reasons.push({
      weight: 0.12 * dueReviews.length + 0.04 * overdueDays,
      cause: 'Reviews falling due',
      trend: `${plural(dueReviews.length, 'review')} due`,
      chip: 'Reviews due',
      line: `${plural(dueReviews.length, 'review')} due — the oldest, ${oldestDue.label}, came up ${dueLabel(oldestDue)}.`,
    })
  }

  if (daysSince !== null && daysSince >= STALE_DAYS) {
    reasons.push({
      weight: (daysSince - (STALE_DAYS - 1)) * 0.12,
      cause: 'No recent activity',
      trend: `${daysSince} days since a session`,
      chip: 'Inactive',
      line:
        `Nothing logged for ${daysSince} days` +
        (dueReviews.length > 0 ? `, and ${plural(dueReviews.length, 'review')} have come due since.` : '.'),
    })
  }

  if (slipped) {
    const mastery = state.masteryByTopic[slipped.topicId]
    reasons.push({
      weight: 0.3 * slippedCount,
      cause: 'Topic below the re-teach line',
      trend: `${plural(slippedCount, 'topic')} to re-teach`,
      chip: 'Slipped',
      line: `${slipped.label} has dropped below the re-teach line — foundations ${pct(mastery.foundations)}, stretch ${pct(mastery.stretch)}.`,
    })
  }

  let score = 0
  let dominant: Reason | null = null
  for (const reason of reasons) {
    score += reason.weight
    if (!dominant || reason.weight > dominant.weight) dominant = reason
  }

  const lane: Lane = score >= ATTENTION_BAR ? 'attention' : beyondBand ? 'ahead' : 'ontrack'

  let line: string
  if (lane === 'attention' && dominant) {
    line = dominant.line
  } else if (lane === 'ahead' && beyondBand) {
    const aheadTopic = node && beyondBand === topicId ? topicId : beyondBand
    const aheadLabel = topicLabel(aheadTopic)
    const band = topicById(aheadTopic)?.yearBand ?? ''
    const prereqs = prereqsOf(aheadTopic)
    const secure = prereqs.length > 0 && prereqs.every((p) => state.nodes[p]?.status === 'mastered')
    line = oldestDue
      ? `Ahead on ${aheadLabel}, ${band} work; ${plural(dueReviews.length, 'review')} due keeps it durable.`
      : `${aheadLabel} is ${band} work, ahead of this class's ${ctx.classYearBand} basket${secure ? ' — every prerequisite under it is mastered' : ''}.`
  } else if (oldestDue) {
    // The recency here is the *reviewed* topic's, not the student's overall —
    // "a review is due on Ratio, last worked today" would be a contradiction.
    const dueNode = oldestDue.topicId ? state.nodes[oldestDue.topicId] : null
    line = `A review is due on ${oldestDue.label} — last worked ${recencyLabel(dueNode ? daysSinceLabel(dueNode.last) : daysSince)}.`
  } else if (topicId && current && masteryBand(topicId, current) === 'mastered') {
    line = `${label} is holding across all three difficulty tiers, stretch included at ${pct(current.stretch)}.`
  } else if (node && node.status === 'frontier' && node.reps < MIN_REPS_FOR_EVIDENCE) {
    const prereqs = topicId ? prereqsOf(topicId) : []
    const secure = prereqs.length > 0 && prereqs.every((p) => state.nodes[p]?.status === 'mastered')
    line = secure
      ? `${label} has just opened — every prerequisite under it is mastered.`
      : `${label} has just opened; ${plural(node.reps, 'attempt')} so far.`
  } else if (current && node) {
    line = `Building on ${label}: foundations ${pct(current.foundations)}, core ${pct(current.core)}, over ${plural(node.reps, 'attempt')}.`
  } else if (node) {
    line = `Working on ${label}; ${plural(node.reps, 'attempt')} logged, nothing flagged.`
  } else {
    line = 'No topic open right now.'
  }

  return {
    id,
    name,
    initials,
    lane,
    score,
    topicId,
    topicLabel: label,
    daysSince,
    lastLabel: recencyLabel(daysSince),
    trend: lane === 'attention' && dominant ? dominant.trend : '',
    chipLabel: lane === 'attention' && dominant ? dominant.chip : '',
    cause: lane === 'attention' && dominant ? dominant.cause : '',
    line,
    weakestLink,
    dueCount: dueReviews.length,
    totalReps,
  }
}

/**
 * Every roster student, triaged. Two passes: practice volume is scored against
 * the class median, which cannot be known until every student has been read.
 */
function buildSignals(ids: readonly string[], classYearBand: string): StudentSignal[] {
  const order = new Map<TopicId, number>()
  graphTopics().forEach((t, i) => order.set(t.id, i))
  const depthOf = (id: TopicId): number => order.get(id) ?? -1

  const states = ids.map((id) => ({ id, state: engineFor(id) }))
  const volumes = states.map((s) => totalRepsOf(s.state)).sort((a, b) => a - b)
  const medianReps = volumes.length === 0
    ? 0
    : volumes.length % 2 === 1
      ? volumes[(volumes.length - 1) / 2]
      : Math.round((volumes[volumes.length / 2 - 1] + volumes[volumes.length / 2]) / 2)

  const ctx: AssessContext = { medianReps, depthOf, classYearBand, bandOrder: yearBands() }
  return states.map((s) => assessStudent(s.id, s.state, ctx))
}

interface ClassTopicRow {
  topicId: TopicId
  name: string
  /** How many students this average is actually made of. */
  n: number
  foundations: number
  core: number
  stretch: number
}

/**
 * Per-topic class aggregates. Averaged only over the students who have recorded
 * mastery on that topic — folding in students who have never met it as zero
 * would understate every topic the class has not reached yet. A topic worked by
 * only a handful of students is dropped rather than shown as a "class average"
 * computed from two people.
 */
function classTopicRows(ids: readonly string[]): ClassTopicRow[] {
  const totals = new Map<TopicId, { n: number; f: number; c: number; s: number }>()
  for (const id of ids) {
    const state = engineFor(id)
    for (const t of Object.keys(state.masteryByTopic)) {
      const m = state.masteryByTopic[t]
      const acc = totals.get(t) ?? { n: 0, f: 0, c: 0, s: 0 }
      acc.n += 1
      acc.f += m.foundations
      acc.c += m.core
      acc.s += m.stretch
      totals.set(t, acc)
    }
  }
  const floor = Math.max(3, Math.ceil(ids.length / CLASS_AVERAGE_SHARE))
  const rows: ClassTopicRow[] = []
  // graphTopics() is the one accessor that returns curriculum order, which is
  // the order a teacher reads a topic list in. Its labels are the graph's own
  // short forms though, so the name comes from topicLabel() — the same topic
  // must not read one way in a lane row and another way here.
  for (const topic of graphTopics()) {
    const acc = totals.get(topic.id)
    if (!acc || acc.n < floor) continue
    rows.push({
      topicId: topic.id,
      name: topicLabel(topic.id),
      n: acc.n,
      foundations: acc.f / acc.n,
      core: acc.c / acc.n,
      stretch: acc.s / acc.n,
    })
  }
  return rows
}

/**
 * Reads a downloaded transferable profile back off disk, tolerantly. Missing
 * graph versions become 'unknown' rather than failing the read, precisely so
 * `importProfile` still gets to raise its mismatch warning — a profile with no
 * version stamp is exactly the case the teacher most needs telling about.
 */
function readProfile(value: unknown): TransferableProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.studentId !== 'string' || raw.studentId === '') return null
  if (!raw.nodeStates || typeof raw.nodeStates !== 'object') return null
  const str = (v: unknown): string => (typeof v === 'string' && v !== '' ? v : 'unknown')
  return {
    formatVersion: typeof raw.formatVersion === 'number' ? raw.formatVersion : 0,
    studentId: raw.studentId,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    topicGraphVersion: str(raw.topicGraphVersion),
    subtopicGraphVersion: str(raw.subtopicGraphVersion),
    contentVersion: str(raw.contentVersion),
    nodeStates: raw.nodeStates as TransferableProfile['nodeStates'],
    masteryByTopic: (raw.masteryByTopic && typeof raw.masteryByTopic === 'object'
      ? raw.masteryByTopic
      : {}) as TransferableProfile['masteryByTopic'],
  }
}

const NODE_META: Record<string, { ret: string; retColor: string }> = {
  mastered: { ret: 'Strong', retColor: '#1f4e75' },
  inprogress: { ret: 'Building', retColor: '#3f82ab' },
  frontier: { ret: 'Active now', retColor: '#b6531f' },
  notready: { ret: 'Not started', retColor: '#8a7c63' },
  locked: { ret: 'Not started', retColor: '#8a7c63' },
}

// The knowledge graph and its node card read the LIVE engine state rather than
// `sampleNodeStatus`/`sampleNodeStats`. For a student who has not practised the
// two are identical — `initEngineState` seeds itself from exactly those overlays
// — but only this version moves when they do, or when a transferred profile is
// loaded in. Fallbacks match the sample accessors' documented ones (§5.6) so a
// topic the student has no entry for still renders as not-started rather than
// blank.
const liveStatus = (studentId: string, topicId: TopicId): NodeStatus =>
  engineFor(studentId).nodes[topicId]?.status ?? 'notready'

const liveStats = (studentId: string, topicId: TopicId): NodeStats =>
  engineFor(studentId).nodes[topicId] ?? { last: '—', next: '—', reps: 0 }

/** Derives the Frontier panel's three buckets from live per-student node status, instead of hand-curating them per student. */
function buildFrontierGroups(studentId: string) {
  const chipsFor = (pred: (st: string) => boolean, color: string, bg: string, bd: string) =>
    graphTopics()
      .filter((n) => pred(liveStatus(studentId, n.id)))
      .map((n) => ({ name: n.label, style: chipStyle(bg, color, bd) }))
  return [
    { label: 'Mastered', color: '#1f4e75', chips: chipsFor((st) => st === 'mastered', '#1f4e75', '#e4edf3', '#cddceb') },
    { label: 'Ready to learn now', color: '#b6531f', chips: chipsFor((st) => st === 'frontier', '#b6531f', '#fdf0e6', '#f0d3bc') },
    { label: 'Not ready yet', color: '#8a7c63', chips: chipsFor((st) => st === 'notready' || st === 'locked', '#8a7c63', '#f2ede2', '#ddd2bd') },
  ]
}

export default function TeacherApp() {
  // Lazy initialiser, not a module-scope constant: the store is installed by
  // main.tsx's `await loadContent()`, which runs AFTER this module is
  // evaluated. Reading defaultBasket() at module scope would
  // throw before the first render. See content-schema-spec §6.12.
  const [s, setS] = useState<TeacherState>(() => ({
    screen: 'dashboard',
    layout: 'attention',
    expOnTrack: false,
    expAhead: false,
    activeClass: '8M2',
    selectedStudentId: 'aisha',
    transferNote: null,
    importPanel: null,
    graphFilter: 'all',
    openLog: null,
    selectedNode: null,
    selectedLog: null,
    qOpen: null,
    ovDetail: null,
    detailReturn: 'student',
    addressList: [],
    dismissedOv: [],
    previewIdx: 0,
    addSeq: 0,
    addingNote: false,
    noteDraft: '',
    menuOpen: null,
    suClass: '8M2',
    suGrade: 'Year 8',
    suYear: 'all',
    suSearch: '',
    suDraft: '',
    suBasket: { ...defaultBasket() },
    hwTitle: '',
    hwDue: '',
    hwSearch: '',
    hwBasket: {},
    hwQTopic: '',
    hwQText: '',
    hwQHint: '',
    hwQuestions: [],
    hwRequireHandwriting: false,
    hwExpandedId: null,
  }))
  const setState = (patch: Partial<TeacherState> | ((st: TeacherState) => Partial<TeacherState>)) =>
    setS((st) => ({ ...st, ...(typeof patch === 'function' ? patch(st) : patch) }))

  // ---- live class state -----------------------------------------------------
  // One subscription for the whole dashboard: `useEngineVersion` re-renders this
  // tree when ANY student's state moves, including a write from the student POV
  // or a profile import below. It is called for the subscription and not for its
  // value — see `data/students.ts`, which documents exactly this pattern for a
  // screen that needs many students rather than one.
  useEngineVersion()
  // Same idea for names: called for the subscription, so a student renaming
  // themselves redraws this class list. Any id subscribes to the whole store.
  useStudentName('aisha')
  const knownIds = useKnownStudentIds()

  // Ms. Okafor's classes, from content. Only 8M2 has student state behind it —
  // 8M4 and 9S1 exist in `content/school/classes.json` with no roster, and this
  // screen says so rather than showing 8M2's twenty-four students three times.
  const okafor = teachers().find((t) => t.id === TEACHER_ID)
  const classes = schoolClasses().filter((c) =>
    okafor ? okafor.classIds.includes(c.id) : c.teacherId === TEACHER_ID,
  )
  // `ac` can legitimately be undefined if the school's class list stops naming
  // this teacher; `activeClassId` is what the screen says either way, so a
  // content change can never white-screen the dashboard.
  const ac = classes.find((c) => c.id === s.activeClass) ?? classes[0]
  const activeClassId = ac?.id ?? s.activeClass
  // Roster comes from the content store: each student profile names its class.
  // This used to key off a single hardcoded class id,
  // which put every student in one class and left the other two permanently
  // empty however real their data was.
  const rosterIds = knownIds.filter((id) => classOfStudent(id) === activeClassId)
  const hasRoster = rosterIds.length > 0

  // Deliberately not memoised. Triaging twenty-four students is a few thousand
  // arithmetic operations, and a memo here would have to be keyed on a store
  // version that the dependency linter cannot see — a stale class dashboard is a
  // far worse bug than a recomputation nobody can measure.
  //
  // Every known student is assessed, not just the active class's, so the
  // drill-down still resolves while a rosterless class is selected and so a
  // student loaded in from an imported profile is reachable at once.
  const allSignals = buildSignals(knownIds, ac?.yearBand ?? 'Year 8')
  const signals = hasRoster ? allSignals : []
  const classTopics = hasRoster ? classTopicRows(rosterIds) : []

  const fileRef = useRef<HTMLInputElement>(null)

  /**
   * Reads a transferable profile off disk and runs it through `importProfile`.
   * Nothing is written to the student's live state here — that is the explicit
   * "load into" action in the panel, so the teacher sees the graph-version
   * warning before anything moves.
   */
  const onProfileFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared so re-picking the same file fires a fresh change event.
    event.target.value = ''
    if (!file) return
    const fileName = file.name
    file
      .text()
      .then((text) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          setState({ importPanel: { fileName, studentId: '', result: null, error: 'That file is not valid JSON.', applied: false } })
          return
        }
        const profile = readProfile(parsed)
        if (!profile) {
          setState({
            importPanel: {
              fileName,
              studentId: '',
              result: null,
              error: 'That JSON is not a transferable profile — it needs a studentId and a nodeStates object.',
              applied: false,
            },
          })
          return
        }
        setState({
          importPanel: { fileName, studentId: profile.studentId, result: importProfile(profile), error: null, applied: false },
        })
      })
      .catch(() => {
        setState({ importPanel: { fileName, studentId: '', result: null, error: 'That file could not be read.', applied: false } })
      })
  }

  const pushAddress = (p: Omit<AddressItem, 'id'>) =>
    setState((st) => ({
      addressList: [...st.addressList, { id: `a${st.addSeq}`, ...p }],
      addSeq: st.addSeq + 1,
      addingNote: false,
      noteDraft: '',
    }))

  const openStudent = (id: string) =>
    setState({ screen: 'student', selectedStudentId: id, selectedNode: null, selectedLog: null, openLog: null })

  const dismissOv = (id: string) => setState((st) => ({ dismissedOv: [...st.dismissedOv, id] }))

  // Both Resolve and Address in person dismiss a flag; prototype-local, resets on reload.
  // getLiveFlags() (data/liveOversight.ts) is real, session-detected flags added to - never
  // replacing - the authored oversightItems() sample narrative; see that module's comment for
  // the cross-route caveat (this only sees a flag pushed from /student on this screen's next mount).
  const ovList = [...oversightItems().map((it, i) => ({ ...it, id: `ov${i}` })), ...getLiveFlags()].filter(
    (it) => !s.dismissedOv.includes(it.id),
  )


  // ---- nav ----
  const activeNav =
    s.screen === 'student' || s.screen === 'logdetail' || s.screen === 'graphfull' || s.screen === 'graphfocused'
      ? 'students'
      : s.screen === 'homework'
        ? 'homework'
        : s.screen === 'oversight'
          ? 'oversight'
          : s.screen === 'setup'
            ? 'setup'
            : 'dash'
  const navItems: Array<{ key: string; label: string; go: () => void }> = [
    { key: 'dash', label: 'Dashboard', go: () => setState({ screen: 'dashboard' }) },
    { key: 'students', label: 'Students', go: () => openStudent(s.selectedStudentId) },
    { key: 'homework', label: 'Homework', go: () => setState({ screen: 'homework' }) },
    { key: 'oversight', label: 'Oversight', go: () => setState({ screen: 'oversight' }) },
    { key: 'setup', label: 'Class setup', go: () => setState({ screen: 'setup' }) },
  ]

  // ---- roster / lanes data ----
  // Every row is one triaged `StudentSignal`; the shapes below only dress it.
  const mkStudent = (sig: StudentSignal) => {
    const color = sig.lane === 'ahead' ? '#2f6f92' : sig.lane === 'attention' ? '#dd6a2f' : '#1f4e75'
    return {
      id: sig.id,
      name: sig.name,
      topic: sig.topicLabel,
      sub: sig.topicLabel,
      last: sig.lastLabel,
      insight: sig.line,
      initials: sig.initials,
      status: sig.lane,
      statusLabel: sig.lane === 'attention' ? 'Needs attention' : sig.lane === 'ahead' ? 'Ahead' : 'On track',
      avatarStyle: avatar(color),
      chipStyle: chip(sig.lane),
    }
  }
  // Attention first, and within it the strongest signal first — the lane is an
  // ordering of how much the teacher's time is needed, not a ranking of students.
  const attentionSignals = signals.filter((sig) => sig.lane === 'attention').sort((a, b) => b.score - a.score)
  const onTrackSignals = signals.filter((sig) => sig.lane === 'ontrack')
  const aheadSignals = signals.filter((sig) => sig.lane === 'ahead')
  const attentionStudents = attentionSignals.map(mkStudent)
  const onTrackStudents = onTrackSignals.map(mkStudent)
  const aheadStudents = aheadSignals.map(mkStudent)
  const lanes = [
    { title: 'Needs attention', count: attentionStudents.length, dot: '#dd6a2f', students: attentionStudents },
    { title: 'On track', count: onTrackStudents.length, dot: '#1f4e75', students: onTrackStudents.slice(0, 6) },
    { title: 'Ahead', count: aheadStudents.length, dot: '#2f6f92', students: aheadStudents.slice(0, 5) },
  ]
  const rosterAll = [...attentionStudents, ...onTrackStudents, ...aheadStudents]
  const collapsed = [
    { title: 'On track', count: onTrackStudents.length, open: s.expOnTrack, toggle: () => setState({ expOnTrack: !s.expOnTrack }), dot: '#1f4e75', students: onTrackStudents },
    { title: 'Ahead of pace', count: aheadStudents.length, open: s.expAhead, toggle: () => setState({ expAhead: !s.expAhead }), dot: '#2f6f92', students: aheadStudents },
  ]

  // ---- selected student (drill-down) ----
  // Resolved from the full signal list rather than the active class's lanes, so
  // the drill-down still works while a rosterless class is selected, and so a
  // student loaded in from an imported profile is reachable immediately.
  const selectedSignal =
    allSignals.find((sig) => sig.id === s.selectedStudentId) ?? allSignals[0] ?? null
  const selectedRoster = selectedSignal
    ? mkStudent(selectedSignal)
    : { id: s.selectedStudentId, name: displayName(s.selectedStudentId), topic: 'Not started', sub: 'Not started', last: 'not started', insight: '', initials: displayName(s.selectedStudentId).slice(0, 2).toUpperCase(), status: 'ontrack', statusLabel: 'On track', avatarStyle: avatar('#1f4e75'), chipStyle: chip('ontrack') }
  const selectedProfile = studentProfile(s.selectedStudentId)

  if (s.screen === 'practice') {
    // The preview shows what THIS student is actually being served: the topic
    // they are on now, walked question by question. It used to be hardwired to
    // alg.linear's first question no matter whose profile it was opened from,
    // so a teacher looking at a student stuck on percentages was shown a linear
    // equation. Falls back to alg.linear only when the selected student has no
    // current topic at all.
    //
    // Read inside the component, never at module scope: the store is not
    // installed until main.tsx awaits loadContent(). See content-schema-spec §6.12.
    const previewTopic = selectedSignal?.topicId ?? 'alg.linear'
    // questionAt past the authored pool mints a fresh template instance, so a
    // teacher can keep pressing on without the preview wrapping to the start.
    const previewProblem = questionAt(previewTopic, s.previewIdx) ?? questionAt('alg.linear', 0)!
    return (
      <PracticeLoop
        key={`${previewProblem.id}-${s.previewIdx}`}
        variant="preview"
        problem={previewProblem}
        title={topicLabel(previewTopic)}
        previewSubject={selectedRoster.name.split(' ')[0]}
        backLabel="← Exit preview"
        onExit={() => setState({ screen: 'student', previewIdx: 0 })}
        // Advances rather than exiting: a teacher checking what the loop feels
        // like wants the next question, not to be thrown back to the dashboard.
        onComplete={() => setState((st) => ({ previewIdx: st.previewIdx + 1 }))}
      />
    )
  }

  // "Where to start" leads with the live weakest link where the graph gives one,
  // then the authored diagnostic bullets. The derived line is what actually
  // moves when the student practises.
  const derivedWhereToStart = ((): string | null => {
    if (!selectedSignal || !selectedSignal.topicId) return null
    const state = engineFor(selectedSignal.id)
    const node = state.nodes[selectedSignal.topicId]
    const mastery = state.masteryByTopic[selectedSignal.topicId]
    const link = selectedSignal.weakestLink
    if (link && link.weighted < WEAK_PREREQ_BELOW) {
      return `Re-teach candidate: ${link.label}, the weakest prerequisite under ${selectedSignal.topicLabel}, at ${pct(link.weighted)} difficulty-weighted${mastery ? ` — ${selectedSignal.topicLabel} itself is at ${pct(weightedMastery(mastery))}` : ''}, over ${plural(node?.reps ?? 0, 'attempt')}.`
    }
    if (mastery) {
      return `${selectedSignal.topicLabel} is the live focus: foundations ${pct(mastery.foundations)}, core ${pct(mastery.core)}, stretch ${pct(mastery.stretch)} across ${plural(node?.reps ?? 0, 'attempt')}.`
    }
    return `${selectedSignal.topicLabel} is the live focus, with ${plural(node?.reps ?? 0, 'attempt')} logged and no tier breakdown recorded yet.`
  })()
  const whereToStart = [
    ...(derivedWhereToStart ? [derivedWhereToStart] : []),
    ...(selectedProfile?.whereToStart ?? []),
  ]
  const frontierGroups = buildFrontierGroups(s.selectedStudentId)

  // ---- knowledge graph (student drill-down) ----
  const graphNodes = graphTopics().map((n) => {
    const st = NODE_STYLE[liveStatus(s.selectedStudentId, n.id)]
    const sel = s.selectedNode === n.id
    return {
      id: n.id,
      x: n.x,
      y: n.y,
      tx: n.x + 66,
      ty: n.y + 22,
      label: n.label,
      fill: st.fill,
      stroke: sel ? '#dd6a2f' : st.stroke,
      sw: sel ? 3 : st.sw,
      dash: st.dash,
      text: st.text,
      onClick: () => setState((prev) => ({ selectedNode: prev.selectedNode === n.id ? null : n.id })),
    }
  })
  const graphEdges = edgePairs().map(([a, b]) => {
    const frontier = liveStatus(s.selectedStudentId, b) === 'frontier'
    return { d: edgePath(a, b), stroke: frontier ? '#e8a06a' : '#d3c6ab', sw: frontier ? 2 : 1.4 }
  })
  const gf = s.graphFilter
  const activeBasket = gf === 'all' ? null : graphFilters().find((f) => f.id === gf)
  const inFocus = (id: string) => !activeBasket || activeBasket.topicIds.indexOf(id) > -1
  const focusedNodes = graphNodes.map((n) => ({ ...n, op: inFocus(n.id) ? 1 : 0.14 }))
  const focusedEdges = graphEdges.map((e, idx) => {
    const [a, b] = edgePairs()[idx]
    return { ...e, op: inFocus(a) && inFocus(b) ? 1 : 0.1 }
  })
  const filterChips = [
    { key: 'all', label: 'All basket topics' },
    ...graphFilters().map((f) => ({ key: f.id, label: f.label })),
  ]

  const selNode = s.selectedNode ? graphTopics().find((n) => n.id === s.selectedNode) : null
  const nodeInfoCard = selNode && (
    <NodeInfoCard
      topicId={selNode.id}
      heading="Topic"
      title={selNode.label}
      fields={[
        { label: 'Last worked', value: liveStats(s.selectedStudentId, selNode.id).last },
        { label: 'Next review', value: liveStats(s.selectedStudentId, selNode.id).next },
        { label: 'Times practised', value: liveStats(s.selectedStudentId, selNode.id).reps },
        {
          label: 'Retention',
          value: NODE_META[liveStatus(s.selectedStudentId, selNode.id)].ret,
          color: NODE_META[liveStatus(s.selectedStudentId, selNode.id)].retColor,
        },
      ]}
      onClose={() => setState({ selectedNode: null })}
    />
  )

  const tagStyleFor = (k: string): CSSProperties => {
    const base: CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20 }
    if (k === 'ahead') return { ...base, color: '#2f6f92', background: '#e8f0f4' }
    if (k === 'behind') return { ...base, color: '#b6531f', background: '#fbe7d8' }
    return { ...base, color: '#1f4e75', background: '#e4edf3' }
  }

  // ---- log detail (shared with oversight "Go to the question") ----
  // Live Lesson/Review sessions (data/liveSessions.ts) only ever come from StudentApp, which is
  // always Aisha - so they're only merged in for them, ahead of their static sample history. Same
  // merge-live-in pattern as ovList's getLiveFlags() below.
  const studentLog =
    s.selectedStudentId === 'aisha' ? [...getLiveSessions(), ...activityLogFor('aisha')] : activityLogFor(s.selectedStudentId)
  const ld: LogDetailSource | null = s.ovDetail ? s.ovDetail : s.selectedLog != null ? (studentLog[s.selectedLog] ?? null) : null

  // ---- class setup ----
  const q = s.suSearch.toLowerCase()
  const matchTopic = (t: Topic) =>
    (s.suYear === 'all' || t.yearBand === s.suYear) && (!q || t.label.toLowerCase().indexOf(q) > -1)
  const basketGroups = catalogueGroups()
    .map((g) => ({ group: g.label, topics: g.topics.filter(matchTopic) }))
    .filter((g) => g.topics.length > 0)
  /**
   * The roster for the class named in step 1, derived rather than stored.
   *
   * It used to be a `string[]` of display names seeded from `defaultRoster()`
   * that nothing else in the app ever read: a student "added" here appeared in
   * this one list and nowhere else. Deriving it from the same source the
   * dashboard uses means the step shows the truth, and the buttons below change
   * it for real.
   */
  const suRoster = knownIds
    .filter((id) => classOfStudent(id) === s.suClass)
    .map((id) => ({ id, name: displayName(id), removable: enrolledClassOf(id) !== null }))

  /**
   * Adds a student to the class named in step 1, for real: mints a semantic id,
   * records the name they go by, enrols them, and seeds their engine state so
   * the store counts them as a student who exists rather than one nobody has
   * heard of. Seeding also registers them, which is what puts them on the
   * dashboard and in the drill-down.
   */
  const addStudentToClass = (rawName: string) => {
    const name = rawName.trim()
    if (!name || !s.suClass.trim()) return
    const id = studentIdForName(name, (candidate) => isKnownStudent(candidate) || enrolledClassOf(candidate) !== null)
    setStudentName(id, name)
    enrolStudent(id, s.suClass)
    // A brand-new student has no sample overlay behind them, so this is an
    // honest all-zero start rather than invented history.
    setEngineFor(id, initEngineState(id))
    setState({ suDraft: '' })
  }

  const basketCount = Object.values(s.suBasket).filter(Boolean).length

  // ---- homework (teacher problem-set authoring) ----
  // Reuses Class setup's grouped topic-chip picker pattern above (same catalogue groups, same
  // toggle-chip look) rather than a fresh widget - see Homework screen render below.
  const hq = s.hwSearch.toLowerCase()
  const hwBasketGroups = catalogueGroups()
    .map((g) => ({
      group: g.label,
      topics: g.topics.filter((t) => !hq || t.label.toLowerCase().indexOf(hq) > -1),
    }))
    .filter((g) => g.topics.length > 0)
  const hwBasketCount = Object.values(s.hwBasket).filter(Boolean).length
  const hwSelectedTopics = catalogueGroups()
    .flatMap((g) => g.topics)
    .filter((t) => s.hwBasket[t.id])
  const hwQuestionTopicOptions = hwSelectedTopics.map((t) => t.label)
  const hwCanCreate = s.hwTitle.trim().length > 0 && hwBasketCount > 0 && s.hwQuestions.length > 0
  const createdProblemSets = getProblemSets()

  const toggleHwTopic = (key: string) =>
    setState((st) => {
      const hwBasket = { ...st.hwBasket, [key]: !st.hwBasket[key] }
      const remainingLabels = catalogueGroups()
        .flatMap((g) => g.topics)
        .filter((t) => hwBasket[t.id])
        .map((t) => t.label)
      // Keep the per-question topic selector pointed at a still-selected topic - never left
      // referencing one that was just unchecked.
      const hwQTopic = remainingLabels.includes(st.hwQTopic) ? st.hwQTopic : (remainingLabels[0] ?? '')
      return { hwBasket, hwQTopic }
    })

  const addHwQuestion = () => {
    const text = s.hwQText.trim()
    if (!text || !s.hwQTopic) return
    setState((st) => ({
      hwQuestions: [...st.hwQuestions, { topic: st.hwQTopic, q: text, hint: st.hwQHint.trim() }],
      hwQText: '',
      hwQHint: '',
    }))
  }

  /**
   * Fills the set from the question bank, balanced across the topics ticked
   * above and across each topic's difficulty tiers.
   *
   * This is what makes a teacher-built set actually count. A hand-typed
   * question has no answer key, so StudentApp can't mark it and records nothing
   * against it - the student finishes the homework and their mastery, their
   * schedule, and anything gated behind those topics all stay exactly where
   * they were. Bank questions carry their id and answer, so submitting the set
   * moves the same mastery a lesson would.
   *
   * Duplicates are skipped rather than deduped after the fact: pressing this
   * twice should top a set up, not silently serve the same question again.
   */
  const addHwFromBank = (count: number) => {
    const topicIds = hwSelectedTopics.map((t) => t.id)
    if (topicIds.length === 0) return
    setState((st) => {
      const already = new Set(st.hwQuestions.map((q) => q.questionId).filter(Boolean))
      // Over-draw, then keep the first `count` we haven't already got, so a
      // partially-exhausted topic still contributes what it has left.
      const fresh = mintQuestions(topicIds, count + already.size).filter((q) => !already.has(q.questionId))
      return { hwQuestions: [...st.hwQuestions, ...fresh.slice(0, count)] }
    })
  }
  const removeHwQuestion = (idx: number) => setState((st) => ({ hwQuestions: st.hwQuestions.filter((_, i) => i !== idx) }))

  const createHwSet = () => {
    if (!hwCanCreate) return
    addProblemSet({
      title: s.hwTitle.trim(),
      topics: hwSelectedTopics.map((t) => t.label).join(' · '),
      due: s.hwDue.trim() || 'No due date set',
      questions: s.hwQuestions,
      requireHandwriting: s.hwRequireHandwriting,
    })
    setState({ hwTitle: '', hwDue: '', hwSearch: '', hwBasket: {}, hwQTopic: '', hwQText: '', hwQHint: '', hwQuestions: [], hwRequireHandwriting: false })
  }
  const toggleHwExpanded = (id: string) => setState((st) => ({ hwExpandedId: st.hwExpandedId === id ? null : id }))

  return (
    <div style={{ minHeight: '100vh', background: '#fbf9f5' }}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Left nav rail */}
        <nav style={{ width: 212, flex: 'none', background: '#0e2a43', color: '#dbe6ef', display: 'flex', flexDirection: 'column', padding: '22px 14px', position: 'sticky', top: 0, height: '100vh' }}>
          <Link
            to="/"
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 24px', textDecoration: 'none' }}
          >
            <Logo size={30} />
            <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 19, color: '#fff', letterSpacing: '.2px' }}>Anadromos</span>
          </Link>
          {navItems.map((n) => {
            const active = n.key === activeNav
            return (
              <div
                key={n.key}
                onClick={n.go}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, fontSize: 13.5, fontWeight: active ? 600 : 500, cursor: 'pointer', color: active ? '#fff' : '#9fb4c7', background: active ? 'rgba(221,106,47,.16)' : 'transparent', marginBottom: 2 }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#dd6a2f' : 'transparent', flex: 'none' }} />
                {n.label}
              </div>
            )
          })}
          <div style={{ marginTop: 'auto', padding: '14px 10px 4px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
            <div style={{ fontSize: 12, color: '#9fb4c7' }}>Ms. Okafor</div>
            <div style={{ fontSize: 11, color: '#6f8aa2', marginTop: 2 }}>Maths · 8M2, 8M4, 9S1</div>
            <Link to="/admin" style={{ display: 'inline-block', marginTop: 10, fontSize: 10.5, color: '#6f8aa2', textDecoration: 'none' }}>
              School admin →
            </Link>
          </div>
        </nav>

        <main style={{ flex: 1, minWidth: 0 }}>
          {/* ---------- DASHBOARD ---------- */}
          {s.screen === 'dashboard' && (
            <div style={{ padding: '30px 40px 60px', maxWidth: 1180 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <span style={monoCap({ letterSpacing: '.6px', marginRight: 4 })}>Your classes</span>
                {classes.map((c) => {
                  const on = c.id === s.activeClass
                  return (
                    <button
                      key={c.id}
                      onClick={() => setState({ activeClass: c.id })}
                      style={{ cursor: 'pointer', textAlign: 'left', padding: '8px 15px', borderRadius: 9, background: on ? '#0e2a43' : '#efe7d9', color: on ? '#fff' : '#5c6773', border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd' }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13.5, display: 'block', lineHeight: 1.2 }}>{c.id}</span>
                      <span style={{ fontSize: 10.5, opacity: 0.75, display: 'block' }}>{c.yearBand}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Class overview</div>
                  <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 30, margin: '6px 0 4px', color: '#0e2a43' }}>
                    {ac ? `${ac.id} · ${ac.yearBand} ${ac.subject}` : activeClassId}
                  </h1>
                  <div style={{ fontSize: 14, color: '#5c6773' }}>
                    {hasRoster ? `${rosterIds.length} students` : 'Roster not imported'} · Autumn term, week 9 · updated live from practice
                  </div>
                </div>
                <div style={{ display: 'flex', background: '#efe7d9', border: '1px solid #e0d4bd', borderRadius: 11, padding: 3, gap: 2 }}>
                  {(
                    [
                      ['attention', 'Attention first'],
                      ['lanes', 'Three lanes'],
                      ['roster', 'Full roster'],
                    ] as const
                  ).map(([k, l]) => {
                    const on = s.layout === k
                    return (
                      <button
                        key={k}
                        onClick={() => setState({ layout: k })}
                        style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 8, background: on ? '#fff' : 'transparent', color: on ? '#0e2a43' : '#8a7c63', boxShadow: on ? '0 1px 2px rgba(20,48,74,.12)' : 'none' }}
                      >
                        {l}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Cross-topic gaps — the diagnostic claim, live */}
              {(() => {
                const gaps = summariseGaps()
                return (
                  <div style={{ marginTop: 24, background: '#fff', border: '1px solid #cddceb', borderRadius: 12, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#1f4e75', flex: 'none' }} />
                      <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: 0, color: '#0e2a43' }}>
                        Gaps found inside other topics
                      </h2>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#2b4a63' }}>
                        {gaps.length === 0 ? 'none yet' : `${gaps.length} topic${gaps.length === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.5, color: '#5c6773', maxWidth: 560, textWrap: 'pretty' }}>
                      Where a student's working went wrong on a step that belongs to an{' '}
                      <em>earlier</em> topic. A percentage question they can't finish is often a
                      fractions problem — this is where that shows up, before the fractions review
                      is due.
                    </p>

                    {gaps.length === 0 ? (
                      <div style={{ marginTop: 14, fontSize: 13, color: '#8a7c63', background: '#f6f1e7', border: '1px solid #e4dccb', borderRadius: 9, padding: '12px 14px' }}>
                        Nothing observed this session. Gaps appear here as students flag lines of
                        working in their sessions.
                      </div>
                    ) : (
                      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {gaps.map((g) => (
                          <div key={g.prereqTopicId} style={{ background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 10, padding: '13px 15px' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 14.5, fontWeight: 600, color: '#0e2a43' }}>{g.prereqTopicLabel}</span>
                              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#b6531f' }}>
                                {g.count} time{g.count === 1 ? '' : 's'}
                              </span>
                              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#2b4a63', marginLeft: 'auto' }}>
                                surfaced in {g.seenInLabels.join(', ')}
                              </span>
                            </div>
                            <div style={{ fontSize: 13, color: '#2b4a63', marginTop: 5 }}>
                              Specifically: {g.subtopicLabels.join(' · ')}
                            </div>
                            {g.latest.lineText && (
                              <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#5c6773', marginTop: 6, background: '#fff', border: '1px solid #d3e0ea', borderRadius: 7, padding: '7px 10px' }}>
                                {g.latest.lineText}
                              </div>
                            )}
                            {/* What the student typed when the four canned reasons didn't fit.
                                It is the only unprompted thing in the whole diagnosis, so it is
                                worth more than the code beside it - and it used to be collected
                                and then dropped. */}
                            {g.notes.length > 0 && (
                              <div style={{ marginTop: 8 }}>
                                <div style={monoCap({ fontSize: 10, marginBottom: 5 })}>In their words</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  {g.notes.map((n, i) => (
                                    <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: '#2b4a63', background: '#fff', border: '1px solid #d3e0ea', borderLeft: '3px solid #dd6a2f', borderRadius: 7, padding: '8px 11px', textWrap: 'pretty' }}>
                                      “{n}”
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Address in person to-do */}
              <div style={{ marginTop: 24, background: '#fdf0e6', border: '1px solid #f0d3bc', borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#dd6a2f', flex: 'none' }} />
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Address in person</h2>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#b6531f' }}>{s.addressList.length} to do</span>
                  <button
                    onClick={() => setState((st) => ({ addingNote: !st.addingNote, noteDraft: '' }))}
                    title="Add a note"
                    style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, border: '1px solid #e0b997', background: '#fff', color: '#b6531f', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
                  >
                    +
                  </button>
                </div>

                {s.addingNote && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <input
                      value={s.noteDraft}
                      onChange={(e) => setState({ noteDraft: e.target.value })}
                      placeholder="e.g. Check in with Marcus about missed homework"
                      style={{ flex: 1, minWidth: 0, border: '1px solid #e0b997', borderRadius: 8, background: '#fff', padding: '10px 12px', fontSize: 13.5, color: '#1a2129', outline: 'none' }}
                    />
                    <button
                      onClick={() => {
                        const d = s.noteDraft.trim()
                        if (d) pushAddress({ student: 'General', context: 'Note to self', note: d })
                      }}
                      style={{ background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Add
                    </button>
                  </div>
                )}

                {s.addressList.length > 0 ? (
                  <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
                    {s.addressList.map((c) => (
                      <div key={c.id} style={{ background: '#fff', border: '1px solid #f0d3bc', borderRadius: 10, padding: '12px 14px', position: 'relative' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0e2a43' }}>{c.student}</span>
                          <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: '#8a7c63', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.context}</span>
                          <button
                            onClick={() => setState((st) => ({ menuOpen: st.menuOpen === c.id ? null : c.id }))}
                            style={{ border: 'none', background: 'transparent', color: '#a99e88', fontSize: 16, lineHeight: 1, cursor: 'pointer', flex: 'none' }}
                          >
                            ···
                          </button>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.45, color: '#5c6773', textWrap: 'pretty' }}>{c.note}</p>
                        {s.menuOpen === c.id && (
                          <div style={{ position: 'absolute', top: 34, right: 10, background: '#fff', border: '1px solid #e4dccb', borderRadius: 8, boxShadow: '0 4px 14px rgba(20,48,74,.14)', overflow: 'hidden', zIndex: 5 }}>
                            <button
                              onClick={() => setState((st) => ({ addressList: st.addressList.filter((x) => x.id !== c.id), menuOpen: null }))}
                              style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '9px 16px', fontSize: 12.5, color: '#b6531f', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              Remove from list
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#8a6b4f', textWrap: 'pretty' }}>
                    Nothing flagged for a face-to-face yet. Add items from a student's activity log or the Oversight list, or hit + for a quick note.
                  </p>
                )}
              </div>

              {/* No roster behind this class — say so rather than showing another class's students */}
              {!hasRoster && (
                <div style={{ marginTop: 26, background: '#fff', border: '1px dashed #d8cfbb', borderRadius: 12, padding: '30px 24px' }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0e2a43' }}>No roster imported for {activeClassId}</p>
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8a7c63', maxWidth: 560, textWrap: 'pretty' }}>
                    {activeClassId} exists in the school's class list, but no students are on its roster yet.
                    Bring a roster in from Class setup, or from a transferring student's profile.
                  </p>
                </div>
              )}

              {/* ATTENTION FIRST layout */}
              {hasRoster && s.layout === 'attention' && (
                <div style={{ marginTop: 26 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#dd6a2f', display: 'inline-block' }} />
                    <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Needs attention first</h2>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{attentionSignals.length} students</span>
                  </div>
                  {attentionSignals.length === 0 ? (
                    <div style={{ background: '#fff', border: '1px dashed #d8cfbb', borderRadius: 12, padding: '26px 20px' }}>
                      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: '#0e2a43' }}>Nobody is flagged right now</p>
                      <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8a7c63', textWrap: 'pretty' }}>
                        No student is stalled on a topic, avoiding its hard end, short of practice or carrying
                        overdue reviews. The lanes below still show where everyone is.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 16 }}>
                      {attentionSignals.map((a) => (
                        <div key={a.id} style={{ background: '#fff', border: '1px solid #eecab0', borderTop: '3px solid #dd6a2f', borderRadius: 12, padding: '18px 18px 16px', boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#0e2a43', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, flex: 'none' }}>{a.initials}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 15, color: '#1a2129' }}>{a.name}</div>
                              <div style={{ fontSize: 12.5, color: '#8a7c63' }}>{a.trend}</div>
                            </div>
                            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#b6531f', background: '#fbe7d8', border: '1px solid #eecab0', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{a.chipLabel}</span>
                          </div>
                          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                              <span style={monoCap({ width: 56, flex: 'none' })}>Topic</span>
                              <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1a2129' }}>{a.topicLabel}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                              <span style={monoCap({ width: 56, flex: 'none' })}>Cause</span>
                              <span style={{ fontSize: 13.5, fontWeight: 600, color: '#b6531f' }}>{a.cause}</span>
                            </div>
                            <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, color: '#5c6773', textWrap: 'pretty' }}>{a.line}</p>
                          </div>
                          <button
                            onClick={() => openStudent(a.id)}
                            style={{ marginTop: 15, width: '100%', background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 9, padding: 10, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}
                          >
                            Open profile →
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* THREE LANES layout */}
              {hasRoster && s.layout === 'lanes' && (
                <div style={{ marginTop: 26, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  {lanes.map((lane) => (
                    <div key={lane.title} style={{ background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 12, padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: lane.dot, display: 'inline-block', flex: 'none' }} />
                        <h2 style={{ fontFamily: FONT_SERIF, fontSize: 15, fontWeight: 600, margin: 0, color: '#0e2a43' }}>{lane.title}</h2>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63', marginLeft: 'auto' }}>{lane.count}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {lane.students.map((st) => (
                          <div key={st.name} onClick={() => openStudent(st.id)} style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 9, padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={st.avatarStyle}>{st.initials}</div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1a2129', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.name}</div>
                              <div style={{ fontSize: 11.5, color: '#8a7c63', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.sub}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ROSTER layout */}
              {hasRoster && s.layout === 'roster' && (
                <div style={{ marginTop: 22, background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.4fr 1fr 0.8fr', gap: 12, padding: '11px 18px', background: '#efe7d9', fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.6px', textTransform: 'uppercase', color: '#8a7c63' }}>
                    <div>Student</div>
                    <div>Current topic</div>
                    <div>Status</div>
                    <div style={{ textAlign: 'right' }}>Last active</div>
                  </div>
                  {rosterAll.map((st) => (
                    <div key={st.name} onClick={() => openStudent(st.id)} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.4fr 1fr 0.8fr', gap: 12, padding: '12px 18px', borderTop: '1px solid #f0e9dc', cursor: 'pointer', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={st.avatarStyle}>{st.initials}</div>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{st.name}</span>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, color: '#5c6773' }}>{st.topic}</div>
                        {!!st.insight && <div style={{ fontSize: 11.5, color: '#a99e88', marginTop: 2, textWrap: 'pretty' }}>{st.insight}</div>}
                      </div>
                      <div>
                        <span style={st.chipStyle}>{st.statusLabel}</span>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 12.5, color: '#8a7c63' }}>{st.last}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Collapsed rest (shown only in attention layout) */}
              {hasRoster && s.layout === 'attention' && (
                <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {collapsed.map((grp) => (
                    <div key={grp.title} style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, overflow: 'hidden' }}>
                      <div onClick={grp.toggle} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', cursor: 'pointer' }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: grp.dot, display: 'inline-block', flex: 'none' }} />
                        <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 15, color: '#0e2a43' }}>{grp.title}</span>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{grp.count} students</span>
                        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: '#8a7c63' }}>{grp.open ? 'Hide ▲' : 'Show ▾'}</span>
                      </div>
                      {grp.open && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '2px 18px 18px' }}>
                          {grp.students.map((st) => (
                            <div key={st.name} onClick={() => openStudent(st.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 20, padding: '5px 12px 5px 5px', cursor: 'pointer' }}>
                              <div style={avatar(grp.dot)}>{st.initials}</div>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{st.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Class mastery by topic (difficulty-weighted) */}
              {hasRoster && (
              <div style={{ marginTop: 30, background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Class mastery by topic</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11.5, color: '#8a7c63' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 26, height: 9, borderRadius: 2, background: '#1f4e75', display: 'inline-block' }} />
                      Foundations
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 26, height: 9, borderRadius: 2, background: '#4a86ad', display: 'inline-block' }} />
                      Core
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 26, height: 9, borderRadius: 2, background: '#e8a06a', display: 'inline-block' }} />
                      Stretch
                    </span>
                  </div>
                </div>
                <p style={{ margin: '6px 0 18px', fontSize: 12.5, color: '#8a7c63', maxWidth: 640 }}>
                  Weighted by item difficulty, so a class can't look finished on a topic by only clearing its easy items. Thin stretch bars are where the hardest work still sits. Each row averages only the students who have actually worked that topic — the count says how many.
                </p>
                {classTopics.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#8a7c63', textWrap: 'pretty' }}>
                    No topic has been worked by enough of {activeClassId} yet to average honestly.
                  </p>
                ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {classTopics.map((t) => (
                    <div key={t.topicId} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 16, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1a2129' }}>{t.name}</div>
                        <div style={monoCap({ fontSize: 10, letterSpacing: '.4px' })}>{t.n} students</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {T(t.foundations, t.core, t.stretch).map((tier, i) => (
                          <div key={i} style={{ flex: 1, height: 22, borderRadius: 5, background: '#f0e9dc', overflow: 'hidden', position: 'relative' }}>
                            <div style={tierFill(tier.f, tier.color)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
              )}
            </div>
          )}

          {/* ---------- STUDENT DRILL-DOWN ---------- */}
          {s.screen === 'student' && (
            <div style={{ padding: '26px 40px 60px', maxWidth: 1180 }}>
              <div onClick={() => setState({ screen: 'dashboard' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5c6773', cursor: 'pointer', marginBottom: 16 }}>
                ← 8M2 class overview
              </div>
              {s.transferNote && (
                <div style={{ marginBottom: 12, background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 9, padding: '10px 13px', fontSize: 13, color: '#2b4a63' }}>
                  Profile exported · {s.transferNote}
                </div>
              )}

              {/* Transferable profile IMPORT. The graph-version mismatch is the
                  whole point of the format, so it is the loudest thing here —
                  numbers computed against a different graph may not mean the
                  same thing, and a receiving teacher has to be told before they
                  act on them. */}
              {s.importPanel && (() => {
                const panel = s.importPanel
                const result = panel.result
                const mismatch = !!result && !result.exact
                const versionIssues = result ? result.issues.filter((i) => i.kind !== 'unknown-topic') : []
                const droppedIssues = result ? result.issues.filter((i) => i.kind === 'unknown-topic') : []
                const bg = panel.error || mismatch ? '#fdf0e6' : '#eef3f7'
                const bd = panel.error || mismatch ? '#f0d3bc' : '#d3e0ea'
                const ink = panel.error || mismatch ? '#5c3a24' : '#2b4a63'
                return (
                  <div style={{ marginBottom: 12, background: bg, border: `1px solid ${bd}`, borderRadius: 10, padding: '15px 17px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: panel.error || mismatch ? '#dd6a2f' : '#1f4e75' }} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: panel.error || mismatch ? '#b6531f' : '#1f4e75', fontFamily: FONT_MONO }}>
                        {panel.error ? 'Profile not read' : mismatch ? 'Imported from a different graph' : 'Profile imported'}
                      </span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63' }}>{panel.fileName}</span>
                      <button
                        onClick={() => setState({ importPanel: null })}
                        style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#a99e88', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}
                      >
                        ×
                      </button>
                    </div>

                    {panel.error ? (
                      <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.5, color: ink, textWrap: 'pretty' }}>{panel.error}</p>
                    ) : result ? (
                      <>
                        <div style={{ marginTop: 9, fontSize: 13.5, fontWeight: 600, color: '#0e2a43' }}>
                          {displayName(panel.studentId)} · {importSummary(result)}
                        </div>
                        {versionIssues.length > 0 && (
                          <div style={{ marginTop: 10, background: '#fff', border: '1px solid #eecab0', borderRadius: 9, padding: '11px 13px' }}>
                            <div style={monoCap({ color: '#b6531f', marginBottom: 6 })}>Read these before you trust the numbers</div>
                            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                              {versionIssues.map((issue, i) => (
                                <li key={i} style={{ display: 'flex', gap: 9, fontSize: 13, lineHeight: 1.5, color: '#5c3a24' }}>
                                  <span style={{ color: '#dd6a2f', flex: 'none' }}>•</span>
                                  <span style={{ textWrap: 'pretty' }}>{issue.message}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {droppedIssues.length > 0 && (
                          <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.5, color: ink, textWrap: 'pretty' }}>
                            Dropped, because this school's curriculum has no such topic:{' '}
                            {droppedIssues.map((issue) => issue.topicId).join(' · ')}
                          </div>
                        )}
                        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          {panel.applied ? (
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1f4e75' }}>
                              Loaded into {displayName(panel.studentId)}'s live profile.
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEngineFor(panel.studentId, result.state)
                                  setState((st) => ({
                                    importPanel: st.importPanel ? { ...st.importPanel, applied: true } : null,
                                    selectedStudentId: panel.studentId,
                                    selectedNode: null,
                                    selectedLog: null,
                                    openLog: null,
                                  }))
                                }}
                                style={{ background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                              >
                                Load into {displayName(panel.studentId)}'s profile
                              </button>
                              <span style={{ fontSize: 12, color: '#8a7c63', textWrap: 'pretty' }}>
                                Nothing has changed yet — this replaces what this school currently holds for them.
                              </span>
                            </>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                )
              })()}

              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: selectedRoster.avatarStyle.background, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 19, flex: 'none' }}>
                  {selectedRoster.initials}
                </div>
                <div>
                  <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 27, margin: 0, color: '#0e2a43' }}>{selectedRoster.name}</h1>
                  <div style={{ fontSize: 13.5, color: '#5c6773' }}>Year 8 · 8M2</div>
                </div>
                <span style={selectedRoster.chipStyle}>{selectedRoster.statusLabel}</span>
                <button
                  onClick={() => {
                    // A transferable profile (build-plan §5.2): everything this
                    // school knows about the student, stamped with the graph
                    // version it was computed against so a receiving school can
                    // tell whether the numbers still mean the same thing.
                    // Exports the LIVE state, not a fresh seed, so anything the
                    // student has done since travels with them.
                    const state = engineFor(s.selectedStudentId)
                    const profile = exportProfile(s.selectedStudentId, state, new Date().toISOString())
                    const round = importProfile(profile)
                    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${s.selectedStudentId}-profile.json`
                    a.click()
                    URL.revokeObjectURL(url)
                    setState({ transferNote: importSummary(round) })
                  }}
                  title="Download this student's knowledge profile to move with them"
                  style={{ marginLeft: 'auto', background: '#f2ece0', color: '#5c6773', border: '1px solid #e0d4bd', borderRadius: 9, padding: '11px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                >
                  ⤓ Transferable profile
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={onProfileFile}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  title="Read a transferable profile from another school or class"
                  style={{ background: '#f2ece0', color: '#5c6773', border: '1px solid #e0d4bd', borderRadius: 9, padding: '11px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                >
                  ⤒ Import profile
                </button>
                <button
                  onClick={() => setState({ screen: 'practice' })}
                  style={{ marginLeft: 'auto', background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 18px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}
                >
                  Preview {selectedRoster.name.split(' ')[0]}'s practice view →
                </button>
              </div>

              {/* "Where to start" — deliberately bulleted to avoid AI-narrative prose */}
              <div style={{ marginTop: 8, background: '#fdf0e6', border: '1px solid #f0d3bc', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dd6a2f', flex: 'none' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: '#b6531f', fontFamily: FONT_MONO }}>Where to start</span>
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(whereToStart.length > 0
                    ? whereToStart
                    : [selectedRoster.insight || `${selectedRoster.name} hasn't got a detailed diagnostic history yet.`]
                  ).map((b, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.5, color: '#5c3a24' }}>
                      <span style={{ color: '#dd6a2f', flex: 'none' }}>•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {selectedProfile ? (
                <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 20, alignItems: 'start' }}>
                  {/* Pace ribbon */}
                  <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '20px 22px' }}>
                    <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 3px', color: '#0e2a43' }}>Against expected pace</h2>
                    <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#8a7c63' }}>
                      Where a Year 8 is expected to be by week 9 (marker) vs. where {selectedRoster.name.split(' ')[0]} actually is. Mixed is normal - ahead on some, behind on others.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                      {selectedProfile.pace.map((p) => (
                        <div key={p.label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: '#1a2129' }}>{p.label}</span>
                            <span style={tagStyleFor(p.kind)}>{p.tag}</span>
                          </div>
                          <div style={{ position: 'relative', height: 14, background: '#f0e9dc', borderRadius: 7 }}>
                            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${p.actual * 100}%`, background: p.kind === 'behind' ? '#c98a63' : '#1f4e75', borderRadius: 7 }} />
                            <div title="expected" style={{ position: 'absolute', top: -3, left: `calc(${p.expected * 100}% - 1px)`, width: 2, height: 20, background: '#0e2a43', borderRadius: 1 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 14, display: 'flex', gap: 18, fontSize: 11.5, color: '#8a7c63' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 20, height: 8, borderRadius: 2, background: '#1f4e75', display: 'inline-block' }} />
                        {selectedRoster.name.split(' ')[0]} now
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 2, height: 14, background: '#0e2a43', display: 'inline-block' }} />
                        Expected by wk 9
                      </span>
                    </div>
                  </div>

                  {/* Difficulty-weighted mastery */}
                  <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '20px 22px' }}>
                    <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 3px', color: '#0e2a43' }}>Mastery, difficulty-weighted</h2>
                    <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#8a7c63' }}>No place to hide: solid on the easy items, thin where it gets hard.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {selectedProfile.mastery.map((t) => (
                        <div key={t.label}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#1a2129', marginBottom: 6 }}>{t.label}</div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {T(t.foundations, t.core, t.stretch).map((tier, i) => (
                              <div key={i} style={{ flex: 1, height: 20, borderRadius: 5, background: '#f0e9dc', overflow: 'hidden' }}>
                                <div style={tierFill(tier.f, tier.color)} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 22, background: '#fff', border: '1px dashed #d8cfbb', borderRadius: 12, padding: '20px 22px' }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#8a7c63', textWrap: 'pretty' }}>
                    A fuller profile — pace, difficulty-weighted mastery, and activity log — isn't built out for {selectedRoster.name} in this prototype yet. Aisha Bello, Daniel Kovač and Reuben Clarke have full profiles.
                  </p>
                </div>
              )}

              {/* Knowledge graph access (opened on purpose, never auto-loaded) */}
              <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <button
                  onClick={() => setState({ screen: 'graphfocused', graphFilter: 'all' })}
                  style={{ textAlign: 'left', background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px', cursor: 'pointer' }}
                >
                  <div style={monoCap({ letterSpacing: '.6px', color: '#b6531f' })}>Day to day</div>
                  <div style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, color: '#0e2a43', margin: '5px 0 5px' }}>Focused knowledge graph →</div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#5c6773', textWrap: 'pretty' }}>
                    Scoped to 8M2's basket of topics for the year, plus every prerequisite subtopic. Filter by topic.
                  </p>
                </button>
                <button
                  onClick={() => setState({ screen: 'graphfull' })}
                  style={{ textAlign: 'left', background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px', cursor: 'pointer' }}
                >
                  <div style={monoCap({ letterSpacing: '.6px', color: '#1f4e75' })}>Full picture</div>
                  <div style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, color: '#0e2a43', margin: '5px 0 5px' }}>All of mathematics →</div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#5c6773', textWrap: 'pretty' }}>
                    Every topic Anadromos has assessed {selectedRoster.name.split(' ')[0]} on, across all years, not just this class.
                  </p>
                </button>
              </div>

              <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
                {/* Activity log */}
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '20px 22px' }}>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: '#0e2a43' }}>Activity log</h2>
                  <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#8a7c63' }}>
                    Every lesson, problem set and review completed. Click one for the detail behind the summary.
                  </p>
                  {studentLog.length === 0 && (
                    <p style={{ margin: 0, fontSize: 13, color: '#8a7c63' }}>No activity logged yet for {selectedRoster.name}.</p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {studentLog.map((a, i) => {
                      const open = s.openLog === i
                      return (
                        <div key={i} style={{ borderTop: '1px solid #f0e9dc' }}>
                          <div
                            onClick={() => setState((st) => ({ openLog: st.openLog === i ? null : i }))}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 0', cursor: 'pointer' }}
                          >
                            <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: a.flag === 'attention' ? '#dd6a2f' : '#1f4e75' }} />
                            <span style={kindStyle}>{a.kind}</span>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1a2129', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                              <div style={{ fontSize: 12.5, color: '#8a7c63', marginTop: 1, textWrap: 'pretty' }}>{a.summary}</div>
                            </div>
                            <span style={{ ...logFlag(a.flag), fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{a.result}</span>
                            <span style={{ color: '#b1a58c', fontSize: 12, width: 14, flex: 'none', textAlign: 'center' }}>{open ? '▾' : '▸'}</span>
                          </div>
                          {open && (
                            <div style={{ padding: '2px 0 16px 26px' }}>
                              <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: '#a99e88', marginBottom: 8 }}>{a.date}</div>
                              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                                {a.detail.map((d, j) => (
                                  <li key={j} style={{ display: 'flex', gap: 9, fontSize: 12.5, lineHeight: 1.5, color: '#5c6773' }}>
                                    <span style={{ color: '#c3b8a1', flex: 'none' }}>-</span>
                                    <span style={{ textWrap: 'pretty' }}>{d}</span>
                                  </li>
                                ))}
                              </ul>
                              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button
                                  onClick={() => setState({ screen: 'logdetail', selectedLog: i, ovDetail: null, detailReturn: 'student', selectedNode: null, qOpen: null })}
                                  style={{ background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                                >
                                  Open where it happened →
                                </button>
                                <button
                                  onClick={() => pushAddress({ student: selectedRoster.name, context: `${a.kind} · ${a.title}`, note: a.summary })}
                                  style={{ background: '#fff', color: '#b6531f', border: '1px solid #eecab0', borderRadius: 8, padding: '9px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                                >
                                  + Address in person
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Frontier / working on now */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '20px 22px' }}>
                    <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 14px', color: '#0e2a43' }}>Frontier</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {frontierGroups.map((g) => (
                        <div key={g.label}>
                          <div style={monoCap({ letterSpacing: '.6px', marginBottom: 8, color: g.color })}>{g.label}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                            {g.chips.length > 0 ? (
                              g.chips.map((c) => (
                                <span key={c.name} style={c.style}>
                                  {c.name}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: 12, color: '#a99e88' }}>None yet</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {selectedProfile && (
                    <div style={{ background: '#fdf0e6', border: '1px solid #f0d3bc', borderRadius: 12, padding: '18px 20px' }}>
                      <div style={monoCap({ letterSpacing: '.6px', color: '#b6531f' })}>Working on now</div>
                      <div style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 600, color: '#0e2a43', margin: '6px 0 4px' }}>{selectedProfile.workingOnNow.label}</div>
                      <p style={{ margin: '0 0 10px', fontSize: 13, color: '#5c3a24' }}>{selectedProfile.workingOnNow.detail}</p>
                      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#8a6b4f', textWrap: 'pretty' }}>{selectedProfile.workingOnNow.note}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---------- FULL KNOWLEDGE GRAPH ---------- */}
          {s.screen === 'graphfull' && (
            <div style={{ padding: '26px 40px 60px' }}>
              <div onClick={() => setState({ screen: 'student' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5c6773', cursor: 'pointer', marginBottom: 14 }}>
                ← {selectedRoster.name}'s profile
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
                <div>
                  <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Full picture</div>
                  <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '5px 0 3px', color: '#0e2a43' }}>{selectedRoster.name} · all of mathematics</h1>
                  <div style={{ fontSize: 13, color: '#5c6773' }}>
                    Every topic Anadromos has assessed {selectedRoster.name.split(' ')[0]} on, across all years. Scroll to explore; click a subtopic for its last-worked and review dates.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: '#8a7c63' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: '#1f4e75', display: 'inline-block' }} />
                    Mastered
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: '#7fb0cd', display: 'inline-block' }} />
                    In progress
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: '#fdf0e6', border: '2px solid #dd6a2f', display: 'inline-block' }} />
                    Frontier
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: '#efe7d9', border: '1px solid #d8cbb2', display: 'inline-block' }} />
                    Not ready
                  </span>
                </div>
              </div>
              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: 16, overflow: 'auto', maxHeight: '72vh' }}>
                <GraphSvg edges={graphEdges} nodes={graphNodes} width={1120} />
              </div>
              {nodeInfoCard}
            </div>
          )}

          {/* ---------- FOCUSED KNOWLEDGE GRAPH ---------- */}
          {s.screen === 'graphfocused' && (
            <div style={{ padding: '26px 40px 60px' }}>
              <div onClick={() => setState({ screen: 'student' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5c6773', cursor: 'pointer', marginBottom: 14 }}>
                ← {selectedRoster.name}'s profile
              </div>
              <div>
                <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Day to day</div>
                <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '5px 0 3px', color: '#0e2a43' }}>Focused profile · 8M2 basket</h1>
                <div style={{ fontSize: 13, color: '#5c6773', maxWidth: 640, textWrap: 'pretty' }}>
                  The topics 8M2 should master this year, expanded to every prerequisite subtopic (shared subtopics shown once). Filter to a single basket topic and its prerequisite chain.
                </div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={monoCap({ letterSpacing: '.6px', marginRight: 2 })}>Filter</span>
                {filterChips.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setState({ graphFilter: c.key })}
                    style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 8, background: gf === c.key ? '#0e2a43' : '#efe7d9', color: gf === c.key ? '#fff' : '#5c6773' }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#8a7c63' }}>
                Click a subtopic to see when {selectedRoster.name.split(' ')[0]} last worked on it and when it's next due for review.
              </div>
              <div style={{ marginTop: 8, background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
                <GraphSvg edges={focusedEdges} nodes={focusedNodes} width="100%" style={{ minWidth: 760 }} />
              </div>
              {nodeInfoCard}
            </div>
          )}

          {/* ---------- ACTIVITY LOG DETAIL ---------- */}
          {s.screen === 'logdetail' && ld && (
            <div style={{ padding: '26px 40px 60px', maxWidth: 960 }}>
              <div
                onClick={() => setState({ screen: s.detailReturn || 'student', ovDetail: null })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5c6773', cursor: 'pointer', marginBottom: 14 }}
              >
                {s.detailReturn === 'oversight' ? '← Oversight' : `← ${selectedRoster.name}'s profile`}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={kindStyle}>{ld.kind}</span>
                <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 24, margin: 0, color: '#0e2a43' }}>{ld.title}</h1>
                <span style={{ ...logFlag(ld.flag), fontSize: 12, fontWeight: 600, padding: '3px 11px', borderRadius: 20, whiteSpace: 'nowrap' }}>{ld.result}</span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63' }}>{ld.date}</span>
              </div>
              <p style={{ margin: '10px 0 18px', fontSize: 13, color: '#5c6773' }}>
                Every item in this activity, with the hiccups flagged. Orange rows are where it went wrong.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {ld.items.map((it, qi) => {
                    const canOpen = !!(it.hit && it.work)
                    const isOpen = s.qOpen === qi
                    return (
                      <div
                        key={qi}
                        onClick={() => {
                          if (canOpen) setState((st) => ({ qOpen: st.qOpen === qi ? null : qi }))
                        }}
                        style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 14, padding: '13px 14px', borderRadius: 9, background: it.hit ? '#fdf0e6' : '#faf6ee', border: `1px solid ${it.hit ? '#f0d3bc' : '#ece3d2'}`, cursor: canOpen ? 'pointer' : 'default' }}
                      >
                        <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, color: it.hit ? '#b6531f' : '#8a7c63' }}>{it.label}</span>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: FONT_SERIF, fontSize: 15, color: '#1a2129' }}>{it.q}</span>
                            <span
                              style={
                                it.hit
                                  ? { fontSize: 10.5, fontWeight: 600, color: '#b6531f', background: '#fbe7d8', border: '1px solid #eecab0', padding: '2px 8px', borderRadius: 20 }
                                  : { fontSize: 10.5, fontWeight: 600, color: '#1f4e75', background: '#e4edf3', border: '1px solid #cddceb', padding: '2px 8px', borderRadius: 20 }
                              }
                            >
                              {it.hit ? 'Hiccup here' : 'OK'}
                            </span>
                            {canOpen && (
                              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#b6531f', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {isOpen ? 'Hide working ▾' : 'See working ▸'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12.5, color: '#5c6773', marginTop: 4, textWrap: 'pretty' }}>{it.note}</div>
                          {isOpen && (
                            <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e4dccb', borderRadius: 10, padding: '14px 16px' }}>
                              <div style={monoCap({ fontSize: 10, marginBottom: 8 })}>{selectedRoster.name.split(' ')[0]}'s full working — flagged lines highlighted</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {(it.work || []).map((tex, li) => {
                                  const wrong = (it.wrong || []).includes(li)
                                  return (
                                    <div
                                      key={li}
                                      style={
                                        wrong
                                          ? { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 12px', borderRadius: 8, background: '#fdf0e6', border: '1px solid #f0d3bc' }
                                          : { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 12px' }
                                      }
                                    >
                                      <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#a99e88', width: 16, flex: 'none' }}>{li + 1}</span>
                                      <span style={{ fontFamily: FONT_SERIF, fontSize: 18, color: wrong ? '#b6531f' : '#1a2129' }}>{tex}</span>
                                    </div>
                                  )
                                })}
                              </div>
                              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {(it.wrong || []).map((li, k) => (
                                  <div key={li} style={{ borderLeft: '3px solid #dd6a2f', padding: '2px 0 2px 12px' }}>
                                    <div style={{ fontFamily: FONT_SERIF, fontSize: 15, color: '#b6531f' }}>
                                      Line {li + 1}: {(it.work || [])[li] || ''}
                                    </div>
                                    <div style={{ fontSize: 12.5, color: '#5c6773', marginTop: 3, textWrap: 'pretty' }}>{(it.why || [])[k] || ''}</div>
                                  </div>
                                ))}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  pushAddress({ student: selectedRoster.name, context: `${ld.kind} · ${ld.title} · ${it.label}`, note: (it.why && it.why[0]) || it.note })
                                }}
                                style={{ marginTop: 14, background: '#fff', color: '#b6531f', border: '1px solid #eecab0', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                              >
                                Address in person →
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px' }}>
                  <div style={monoCap({ marginBottom: 10 })}>Handwritten working</div>
                  {ld.upload ? (
                    <>
                      <div style={{ border: '1px solid #e4dccb', borderRadius: 10, height: 260, background: 'repeating-linear-gradient(#fffdf8,#fffdf8 30px,#eef0f2 31px)', position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 14, left: 16, fontFamily: FONT_SERIF, fontSize: 18, color: '#33404b', transform: 'rotate(-1.5deg)' }}>3x − 7 = 11</div>
                        <div style={{ position: 'absolute', top: 44, left: 22, fontFamily: FONT_SERIF, fontSize: 18, color: '#33404b', transform: 'rotate(-1deg)' }}>3x = 11 − 7  ✗</div>
                        <div style={{ position: 'absolute', top: 74, left: 20, fontFamily: FONT_SERIF, fontSize: 18, color: '#33404b', transform: 'rotate(-2deg)' }}>3x = 4</div>
                        <div style={{ width: '100%', padding: 8, background: 'rgba(14,42,67,.82)', color: '#dbe6ef', fontSize: 11, textAlign: 'center', fontFamily: FONT_MONO }}>
                          aisha_working.jpg · uploaded today · click to enlarge
                        </div>
                      </div>
                      <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.5, color: '#8a7c63', textWrap: 'pretty' }}>
                        They uploaded this for reference. It isn't read by the AI or used in the diagnosis - it's here so you can confirm the working was done by hand.
                      </p>
                    </>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: '#8a7c63', textWrap: 'pretty' }}>No handwritten working was uploaded for this activity.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---------- OVERSIGHT ---------- */}
          {s.screen === 'oversight' && (
            <div style={{ padding: '30px 40px 60px', maxWidth: 900 }}>
              <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Oversight</div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 28, margin: '6px 0 4px', color: '#0e2a43' }}>What the AI wants your eyes on</h1>
              <p style={{ margin: '0 0 8px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 640, textWrap: 'pretty' }}>
                A short, triaged list of flagged moments, not a transcript archive. Only diagnoses that look uncertain or interactions worth a teacher's judgement surface here, so the list stays short enough to actually clear.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 14px' }}>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{ovList.length} flagged this week</span>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#c3b8a1' }} />
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>nothing older is kept for you to audit</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {ovList.map((o) => {
                  const m = OVERSIGHT_KIND_META[o.kind]
                  return (
                    <div key={o.id} style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: m.color }} />
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: m.color, background: m.bg, border: `1px solid ${m.bd}`, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{m.label}</span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#1a2129' }}>{o.title}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63' }}>{o.context}</span>
                      </div>
                      <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.55, color: '#5c6773', textWrap: 'pretty' }}>{o.body}</p>
                      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid #f0e9dc' }}>
                        <span style={monoCap()}>Your call</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#0e2a43' }}>{o.asks}</span>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => {
                              pushAddress({ student: o.student, context: o.context, note: o.title })
                              dismissOv(o.id)
                            }}
                            style={{ background: '#fff', border: '1px solid #eecab0', borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: '#b6531f', cursor: 'pointer' }}
                          >
                            + Address in person
                          </button>
                          <button
                            onClick={() =>
                              setState({
                                screen: 'logdetail',
                                ovDetail: o.detail,
                                selectedLog: null,
                                detailReturn: 'oversight',
                                selectedNode: null,
                                qOpen: null,
                                selectedStudentId: idForName(o.student),
                              })
                            }
                            style={{ background: '#fff', border: '1px solid #cdbfa6', borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: '#0e2a43', cursor: 'pointer' }}
                          >
                            Go to the question →
                          </button>
                          {/* Resolve = defer to the AI's judgement */}
                          <button
                            onClick={() => dismissOv(o.id)}
                            style={{ background: '#0e2a43', border: 'none', borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: '#fff', cursor: 'pointer' }}
                          >
                            Resolve
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {ovList.length === 0 && (
                  <div style={{ background: '#fff', border: '1px dashed #d8cfbb', borderRadius: 12, padding: '30px 20px', textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0e2a43' }}>All clear</p>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8a7c63', textWrap: 'pretty' }}>
                      Every flag has been resolved or moved to your address-in-person list. New ones will appear here as the AI raises them.
                    </p>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'flex-start', background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 10, padding: '14px 16px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f4e75', marginTop: 6, flex: 'none' }} />
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#2b4a63', textWrap: 'pretty' }}>
                  Deliberately not a full log. Research on AI oversight found unstructured monitoring makes reviewers measurably worse and more likely to burn out, so Anadromos triages for you and keeps this list short.
                </p>
              </div>
            </div>
          )}

          {/* ---------- CLASS SETUP ---------- */}
          {s.screen === 'setup' && (
            <div style={{ padding: '30px 40px 60px', maxWidth: 880 }}>
              <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Class setup</div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 28, margin: '6px 0 4px', color: '#0e2a43' }}>Set up a class</h1>
              <p style={{ margin: '0 0 24px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 620, textWrap: 'pretty' }}>
                A few minutes, once. Name the class, bring in the roster, and choose the topics you want this class to master this year, that basket is what builds each student's focused knowledge graph.
              </p>

              {/* 1. Basics */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: '#fff', background: '#0e2a43', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>1</span>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Class basics</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'start' }}>
                  <div>
                    <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Class name</label>
                    <input
                      value={s.suClass}
                      onChange={(e) => setState({ suClass: e.target.value })}
                      style={{ width: '100%', border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '10px 12px', fontSize: 14, color: '#1a2129', outline: 'none' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Grade band</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {yearBands().map((g) => {
                        const on = s.suGrade === g
                        return (
                          <button
                            key={g}
                            onClick={() => setState({ suGrade: g })}
                            style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, background: on ? '#0e2a43' : '#f2ece0', color: on ? '#fff' : '#5c6773', border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd' }}
                          >
                            {g}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Roster */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: '#fff', background: '#0e2a43', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>2</span>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Roster</h2>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{suRoster.length} students</span>
                </div>
                <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#8a7c63', maxWidth: 600, textWrap: 'pretty' }}>
                  Import from your school's MIS, or add students by hand. This is the real roster for{' '}
                  <strong>{s.suClass || 'this class'}</strong> — anyone added here appears on the dashboard, can be
                  drilled into, and is in range of homework you set.
                </p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <input
                    value={s.suDraft}
                    onChange={(e) => setState({ suDraft: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addStudentToClass(s.suDraft)
                    }}
                    placeholder="Add a student by name"
                    style={{ flex: 1, minWidth: 180, border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '10px 12px', fontSize: 14, color: '#1a2129', outline: 'none' }}
                  />
                  <button
                    onClick={() => addStudentToClass(s.suDraft)}
                    style={{ background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 8, padding: '0 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      for (const name of ['Maya Kumar', 'Finn Walsh', 'Zara Haq', 'Noah Pratt']) addStudentToClass(name)
                    }}
                    style={{ background: '#fff', color: '#0e2a43', border: '1px solid #cdbfa6', borderRadius: 8, padding: '10px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Import from MIS / CSV
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {suRoster.map((student) => (
                    <div key={student.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 20, padding: '5px 8px 5px 5px' }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#0e2a43', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flex: 'none' }}>
                        {student.name
                          .split(' ')
                          .map((w) => w[0])
                          .join('')
                          .slice(0, 2)}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#1a2129' }}>{student.name}</span>
                      {/* Only students enrolled here can be taken off the roster. A student the
                          content store puts in this class is not this screen's to remove. */}
                      {student.removable ? (
                        <button
                          onClick={() => unenrolStudent(student.id)}
                          title={`Remove ${student.name} from ${s.suClass}`}
                          style={{ border: 'none', background: 'transparent', color: '#b1a58c', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}
                        >
                          ×
                        </button>
                      ) : (
                        <span title="On this class from the school's records" style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: '#b1a58c', paddingRight: 4 }}>MIS</span>
                      )}
                    </div>
                  ))}
                  {suRoster.length === 0 && (
                    <p style={{ margin: 0, fontSize: 13, color: '#8a7c63' }}>
                      No students on {s.suClass || 'this class'} yet — add one above.
                    </p>
                  )}
                </div>
              </div>

              {/* 3. Basket of topics */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: '#fff', background: '#0e2a43', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>3</span>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Basket of topics for the year</h2>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#b6531f' }}>{basketCount} selected</span>
                </div>
                <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#8a7c63', maxWidth: 600, textWrap: 'pretty' }}>
                  We carry every maths topic Anadromos offers; you work with us to map which map to which year group. Pick what this class should master by year's end, Anadromos expands each choice into its prerequisite subtopics automatically, and that expanded set is the focused knowledge graph you'll use day to day.
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
                  {[{ k: 'all', l: 'All years' }, ...yearBands().map((g) => ({ k: g, l: g }))].map((o) => {
                    const on = s.suYear === o.k
                    return (
                      <button
                        key={o.k}
                        onClick={() => setState({ suYear: o.k })}
                        style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 8, background: on ? '#dd6a2f' : '#f2ece0', color: on ? '#fff' : '#5c6773', border: on ? '1px solid #dd6a2f' : '1px solid #e0d4bd' }}
                      >
                        {o.l}
                      </button>
                    )
                  })}
                  <input
                    value={s.suSearch}
                    onChange={(e) => setState({ suSearch: e.target.value })}
                    placeholder="Search topics…"
                    style={{ marginLeft: 'auto', minWidth: 180, border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '9px 12px', fontSize: 13.5, color: '#1a2129', outline: 'none' }}
                  />
                </div>
                {basketGroups.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {basketGroups.map((grp) => (
                      <div key={grp.group}>
                        <div style={monoCap({ marginBottom: 8 })}>{grp.group}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {grp.topics.map((t) => {
                            const on = !!s.suBasket[t.id]
                            return (
                              <button
                                key={t.id}
                                onClick={() => setState((st) => ({ suBasket: { ...st.suBasket, [t.id]: !st.suBasket[t.id] } }))}
                                style={{ cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 500, padding: '8px 13px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 7, background: on ? '#0e2a43' : '#f2ece0', color: on ? '#fff' : '#5c6773', border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd' }}
                              >
                                <span style={{ fontSize: 12, opacity: on ? 1 : 0.6 }}>{on ? '✓' : '+'}</span>
                                {t.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#8a7c63' }}>No topics match that filter. Try another year group or search term.</p>
                )}
              </div>

              {/* Suggested teaching order, derived from the prerequisite graph */}
              {(() => {
                const chosen = Object.keys(s.suBasket).filter((id) => s.suBasket[id])
                if (chosen.length === 0) return null
                const order = suggestedOrder(chosen)
                const warnings = orderWarnings(order)
                const missing = missingPrereqs(chosen)
                return (
                  <div style={{ marginTop: 22, background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 12, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: 0, color: '#0e2a43' }}>
                        Suggested teaching order
                      </h3>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#2b4a63' }}>
                        {order.length} topic{order.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <p style={{ margin: '7px 0 12px', fontSize: 13, lineHeight: 1.5, color: '#5c6773', maxWidth: 560, textWrap: 'pretty' }}>
                      Ordered so nothing is taught before what it depends on. Teach in your own
                      order if you prefer — this is a suggestion, never a constraint.
                    </p>
                    <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {order.map((id) => (
                        <li key={id} style={{ fontSize: 13.5, color: '#1a2129' }}>{topicLabel(id)}</li>
                      ))}
                    </ol>
                    {warnings.length > 0 && (
                      <div style={{ marginTop: 12, fontSize: 12.5, color: '#b6531f' }}>
                        {warnings.length} ordering conflict{warnings.length === 1 ? '' : 's'} in the graph.
                      </div>
                    )}
                    {missing.length > 0 && (
                      <div style={{ marginTop: 12, background: '#fdf0e6', border: '1px solid #f0d3bc', borderRadius: 9, padding: '11px 13px' }}>
                        <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.5px', textTransform: 'uppercase', color: '#b6531f', marginBottom: 5 }}>
                          Not in this basket
                        </div>
                        <div style={{ fontSize: 13, color: '#8a6b4f', lineHeight: 1.55 }}>
                          {[...new Set(missing.map((m) => m.prereqLabel))].join(' · ')} — assumed
                          already taught. Add them if this class hasn't covered them.
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 20 }}>
                <button style={{ background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 9, padding: '12px 22px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}>Create class</button>
                <span style={{ fontSize: 12.5, color: '#8a7c63' }}>You can change the roster and basket any time, the graph updates with them.</span>
              </div>
            </div>
          )}

          {/* ---------- HOMEWORK (teacher problem-set authoring) ---------- */}
          {s.screen === 'homework' && (
            <div style={{ padding: '30px 40px 60px', maxWidth: 880 }}>
              <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Homework</div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 28, margin: '6px 0 4px', color: '#0e2a43' }}>Set a problem set</h1>
              <p style={{ margin: '0 0 24px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 620, textWrap: 'pretty' }}>
                Name it, pick the topics it covers, and add questions one at a time, each with an optional hint. A manual
                form is the simplest real option for a prototype, scan/upload and AI-assisted authoring aren't built out
                here.
              </p>

              {/* 1. Basics */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: '#fff', background: '#0e2a43', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>1</span>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Set basics</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 20, alignItems: 'start' }}>
                  <div>
                    <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Title</label>
                    <input
                      value={s.hwTitle}
                      onChange={(e) => setState({ hwTitle: e.target.value })}
                      placeholder="e.g. Fractions & percentages"
                      style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '10px 12px', fontSize: 14, color: '#1a2129', outline: 'none' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Due date</label>
                    <input
                      value={s.hwDue}
                      onChange={(e) => setState({ hwDue: e.target.value })}
                      placeholder="e.g. Fri 25 Jul"
                      style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '10px 12px', fontSize: 14, color: '#1a2129', outline: 'none' }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => setState((st) => ({ hwRequireHandwriting: !st.hwRequireHandwriting }))}
                  style={{
                    marginTop: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    background: s.hwRequireHandwriting ? '#fdf0e6' : '#faf6ee',
                    border: `1px solid ${s.hwRequireHandwriting ? '#f0d3bc' : '#e4dccb'}`,
                    borderRadius: 9,
                    padding: '11px 14px',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      flex: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      background: s.hwRequireHandwriting ? '#dd6a2f' : '#fff',
                      border: `1px solid ${s.hwRequireHandwriting ? '#dd6a2f' : '#cdbfa6'}`,
                      color: '#fff',
                    }}
                  >
                    {s.hwRequireHandwriting ? '✓' : ''}
                  </span>
                  <span>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#0e2a43' }}>Require a photo of working</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8a7c63', marginTop: 1 }}>
                      Blocks submission until the student attaches a photo or PDF of their handwritten working for this whole set.
                    </span>
                  </span>
                </button>
              </div>

              {/* 2. Topics - same grouped topic-chip picker pattern as Class setup's basket of topics */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: '#fff', background: '#0e2a43', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>2</span>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Topics this set covers</h2>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#b6531f' }}>{hwBasketCount} selected</span>
                </div>
                <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#8a7c63', maxWidth: 600, textWrap: 'pretty' }}>
                  Every question you add below gets tagged with one of these.
                </p>
                <input
                  value={s.hwSearch}
                  onChange={(e) => setState({ hwSearch: e.target.value })}
                  placeholder="Search topics…"
                  style={{ marginBottom: 16, width: '100%', maxWidth: 280, border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '9px 12px', fontSize: 13.5, color: '#1a2129', outline: 'none' }}
                />
                {hwBasketGroups.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {hwBasketGroups.map((grp) => (
                      <div key={grp.group}>
                        <div style={monoCap({ marginBottom: 8 })}>{grp.group}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {grp.topics.map((t) => {
                            const on = !!s.hwBasket[t.id]
                            return (
                              <button
                                key={t.id}
                                onClick={() => toggleHwTopic(t.id)}
                                style={{ cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 500, padding: '8px 13px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 7, background: on ? '#0e2a43' : '#f2ece0', color: on ? '#fff' : '#5c6773', border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd' }}
                              >
                                <span style={{ fontSize: 12, opacity: on ? 1 : 0.6 }}>{on ? '✓' : '+'}</span>
                                {t.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#8a7c63' }}>No topics match that search.</p>
                )}
              </div>

              {/* 3. Questions, added one at a time */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: '#fff', background: '#0e2a43', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>3</span>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Questions</h2>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{s.hwQuestions.length} added</span>
                </div>
                {hwQuestionTopicOptions.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#8a7c63' }}>Pick at least one topic above first.</p>
                ) : (
                  <>
                    <div style={{ background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0e2a43', marginBottom: 4 }}>Pull from the question bank</div>
                      <p style={{ margin: '0 0 11px', fontSize: 12.5, lineHeight: 1.55, color: '#2b4a63', maxWidth: 560, textWrap: 'pretty' }}>
                        Balanced across the topics you ticked and across each one's difficulty tiers. These are marked
                        automatically when the student submits, so the set moves their mastery. Questions you type
                        yourself come back to you for marking instead.
                      </p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[4, 8, 12].map((n) => (
                          <button
                            key={n}
                            onClick={() => addHwFromBank(n)}
                            style={{ background: '#1f4e75', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 15px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                          >
                            + Add {n} questions
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ ...monoCap({ marginBottom: 10 }) }}>Or write your own</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, marginBottom: 10, alignItems: 'start' }}>
                      <div>
                        <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Topic</label>
                        <select
                          value={s.hwQTopic}
                          onChange={(e) => setState({ hwQTopic: e.target.value })}
                          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '10px 12px', fontSize: 13.5, color: '#1a2129', outline: 'none' }}
                        >
                          {hwQuestionTopicOptions.map((label) => (
                            <option key={label} value={label}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Question</label>
                        <input
                          value={s.hwQText}
                          onChange={(e) => setState({ hwQText: e.target.value })}
                          placeholder="e.g. Simplify 12⁄18 to its lowest terms."
                          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '10px 12px', fontSize: 14, color: '#1a2129', outline: 'none' }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'center' }}>
                      <input
                        value={s.hwQHint}
                        onChange={(e) => setState({ hwQHint: e.target.value })}
                        placeholder="Hint (optional)"
                        style={{ flex: 1, minWidth: 0, border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '10px 12px', fontSize: 13.5, color: '#1a2129', outline: 'none' }}
                      />
                      <button
                        onClick={addHwQuestion}
                        disabled={!s.hwQText.trim()}
                        style={{ background: s.hwQText.trim() ? '#0e2a43' : '#f2ece0', color: s.hwQText.trim() ? '#fff' : '#a99e88', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: s.hwQText.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}
                      >
                        + Add question
                      </button>
                    </div>
                  </>
                )}
                {s.hwQuestions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {s.hwQuestions.map((qq, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 9, padding: '10px 12px' }}>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.4px', textTransform: 'uppercase', fontWeight: 600, color: '#1f4e75', background: '#e4edf3', border: '1px solid #cddceb', padding: '3px 9px', borderRadius: 20, flex: 'none', marginTop: 1 }}>
                          {qq.topic}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, color: '#1a2129', textWrap: 'pretty' }}>{qq.q}</div>
                          {!!qq.hint && <div style={{ fontSize: 12, color: '#8a7c63', marginTop: 2, textWrap: 'pretty' }}>Hint: {qq.hint}</div>}
                          {/* Says plainly which questions will move mastery on their own and which are coming back to you - the difference decides whether this set counts for anything downstream. */}
                          <div style={{ fontSize: 11.5, color: gradable(qq) ? '#2f6b46' : '#8a7c63', marginTop: 3 }}>
                            {gradable(qq) ? '✓ Marked automatically' : 'You mark this one'}
                          </div>
                        </div>
                        <button
                          onClick={() => removeHwQuestion(i)}
                          style={{ border: 'none', background: 'transparent', color: '#a99e88', fontSize: 16, lineHeight: 1, cursor: 'pointer', flex: 'none' }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 20, marginBottom: 40 }}>
                <button
                  onClick={createHwSet}
                  disabled={!hwCanCreate}
                  style={{ background: hwCanCreate ? '#dd6a2f' : '#f2ece0', color: hwCanCreate ? '#fff' : '#a99e88', border: 'none', borderRadius: 9, padding: '12px 22px', fontSize: 14.5, fontWeight: 600, cursor: hwCanCreate ? 'pointer' : 'not-allowed' }}
                >
                  Create problem set →
                </button>
                <span style={{ fontSize: 12.5, color: '#8a7c63' }}>Needs a title, at least one topic, and at least one question.</span>
              </div>

              {/* Already-created */}
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Problem sets you've created</h2>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{createdProblemSets.length}</span>
                </div>
                <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: '#5c6773', maxWidth: 560, textWrap: 'pretty' }}>
                  Visible on {displayName('aisha')}'s Home screen the next time they open it - this list doesn't live-sync into an
                  already-open student view.
                </p>
                {createdProblemSets.length === 0 ? (
                  <div style={{ background: '#fff', border: '1px dashed #d8cfbb', borderRadius: 12, padding: '26px 20px', textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: 13, color: '#8a7c63', textWrap: 'pretty' }}>Nothing created yet - fill in the form above to set your first one.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {createdProblemSets.map((t) => {
                      const open = s.hwExpandedId === t.id
                      return (
                        <div key={t.id} style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, overflow: 'hidden' }}>
                          <div onClick={() => toggleHwExpanded(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 14.5, fontWeight: 600, color: '#1a2129' }}>{t.title}</div>
                              <div style={{ fontSize: 12, color: '#8a7c63', marginTop: 2 }}>
                                {t.topics} · {t.questions.length} question{t.questions.length === 1 ? '' : 's'}
                              </div>
                            </div>
                            {t.requireHandwriting && (
                              <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, color: '#b6531f', background: '#fbe7d8', border: '1px solid #eecab0', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                                📎 photo required
                              </span>
                            )}
                            <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, color: '#1f4e75', background: '#e4edf3', border: '1px solid #cddceb', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                              🗓 {t.due}
                            </span>
                            <span style={{ color: '#b1a58c', fontSize: 12, width: 14, flex: 'none', textAlign: 'center' }}>{open ? '▾' : '▸'}</span>
                          </div>
                          {open && (
                            <div style={{ padding: '0 18px 16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {t.questions.map((qq, i) => (
                                <div key={i} style={{ display: 'flex', gap: 9, fontSize: 12.5, lineHeight: 1.5, color: '#5c6773' }}>
                                  <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: '#a99e88', flex: 'none', width: 22 }}>Q{i + 1}</span>
                                  <span style={{ textWrap: 'pretty' }}>
                                    <strong style={{ color: '#1a2129', fontWeight: 600 }}>{qq.topic}:</strong> {qq.q}
                                    {!!qq.hint && <span style={{ color: '#8a7c63' }}> — Hint: {qq.hint}</span>}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
