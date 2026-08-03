import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { GraphSvg } from '../components/GraphSvg'
import { NodeInfoCard } from '../components/NodeInfoCard'
import { PracticeLoop } from '../components/PracticeLoop'
import type { AttemptResult } from '../components/PracticeLoop'
import { LessonSession } from '../components/LessonSession'
import { ReviewSession } from '../components/ReviewSession'
import { DiagnosticTest } from '../components/DiagnosticTest'
import {
  activityLogFor,
  catalogueGroups,
  edgePairs,
  edgePath,
  graphFilters,
  graphTopics,
  isGraphTopic,
  lessonForTopic,
  prereqsOf,
  questionById,
  questionsForTopic,
  questionAt,
  subtopicById,
  subtopicsForTopic,
  topicById,
  topicLabel,
} from '../content'
import type { MasteryTier, NodeStatus, QuestionId, TopicId } from '../content'
import type { EngineNodeState, EngineState } from '../data/engine'
import type { LogActivity } from '../content'
import { recordFor, useEngine } from '../data/students'
import { buildQueue, dueLabel, DAILY_ITEM_CAP, PROBLEM_SET_URGENT_DAYS } from '../data/schedule'
import type { QueueItem } from '../data/schedule'
import { totalXp, masteryBand } from '../data/xp'
import type { SessionKind } from '../data/xp'
import { getProblemSets } from '../data/teacherProblemSets'
import type { AuthoredProblemSet, AuthoredQuestion } from '../data/teacherProblemSets'
import { pushLiveFlag } from '../data/liveOversight'
import { getLiveSessions, pushLiveSession } from '../data/liveSessions'
import { pushGap } from '../data/liveGaps'
import { load as loadSaved, save as saveState } from '../data/persist'
import { FONT_MONO, FONT_SERIF, NODE_STYLE } from '../theme'

/** StudentApp is always Aisha's own app — there's no "pick a student" concept here. */
const STUDENT_ID = 'aisha'

/**
 * Student POV — a calm home of mastery-path lessons/reviews plus teacher-set
 * problem sets, the diagnostic practice loop, Free play over the whole
 * curriculum, a personal map, sessions history, and progress.
 */

type Screen =
  | 'sdiagnostic'
  | 'shome'
  | 'sprogress'
  | 'ssessions'
  | 'ssessiondetail'
  | 'smap'
  | 'psolve'
  | 'freeplay'
  | 'fptopic'
  | 'practice'

type PracticeMode = 'lesson' | 'review' | 'freeplay' | 'unavailable'

interface StudentState {
  screen: Screen
  /**
   * Whether the one-time diagnostic/placement test (components/DiagnosticTest.tsx,
   * Appendix A) has been completed this session. Starts false, so `screen`
   * starts on 'sdiagnostic' instead of 'shome' - see INITIAL below - and
   * flips true (never back) the moment the student reaches its closing
   * summary screen and presses Continue. Nothing else in the app ever
   * routes back to 'sdiagnostic', so this is a one-way, one-time gate.
   */
  diagnosticDone: boolean
  smapView: 'focused' | 'full'
  /**
   * Indices into the derived path (see derivePath) that have actually been completed, in whatever
   * order they were done - not just a "how far in order" cursor, since
   * "Speed through lessons" (see speedMode) makes out-of-order completion
   * reachable. `pathPrefixDone()` derives the old-style "N of 6 done"
   * sequential count from this whenever that's what's wanted.
   */
  /** Queue-item ids already completed. Was positional indices, which broke
   * the moment the path became derived: a completed item leaves the queue, the
   * next one inherits its index, and rendered as 'Done' without being done. */
  pathCompleted: string[]
  /** "Speed through lessons" toggle (Home, near "Your path") - see isPathItemLocked(). */
  speedMode: boolean
  fpTopic: string | null
  fpLabel: string | null
  fpProblemIdx: number
  practiceMode: PracticeMode | null
  practiceTopic: string | null
  /** Which path index is in progress, so its completion callback knows what to mark done. */
  /** Queue-item id in progress, so its completion callback knows what to mark. */
  activePathId: string | null
  /** Which problem set (see buildProblemSets - school-set or teacher-authored) is open in `psolve`; null until a card is opened. */
  activePsId: string | null
  psIdx: number
  psAnswers: Record<number, string>
  psSubmitted: boolean
  psAttach: string | null
  selectedLog: number | null
  selectedNode: string | null
  graphFilter: string
}

/** Fallback for a topic the live engine has no entry for. Routine now that Free play covers the whole curriculum: the store seeds from content/samples/node-states.json, which carries the 15 graph topics, so every catalogue topic beyond them legitimately lands here and reads as 'not reached yet' rather than crashing. */
const FALLBACK_NODE_STATE: EngineNodeState = { status: 'notready', last: '—', next: 'when ready', reps: 0 }

const monoCap = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  color: '#8a7c63',
  ...extra,
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

/**
 * One row of "Your path". Derived per render from the live engine by
 * `derivePath` below — this used to be a hardcoded six-item array, which meant
 * the student's path never responded to anything they actually did.
 */
interface PathItem {
  /** The queue item's stable id — what completion is recorded against. */
  id: string
  kind: 'Lesson' | 'Review'
  subtopic: string
  detail: string
  /** null when nothing is authored for the topic yet. */
  topicId: TopicId | null
  dueInDays: number
}

/**
 * The student's path, straight from the scheduler (`data/schedule.ts`).
 *
 * Overdue reviews first, then reviews due today, then frontier lessons —
 * priority order, not authored order, and capped at a sitting's worth so a
 * student returning after a fortnight is never shown a wall of red.
 */
function derivePath(queue: readonly QueueItem[]): PathItem[] {
  return queue
    .filter((it) => it.kind !== 'problemSet')
    .map((it) => {
      const isReview = it.kind === 'review'
      const has = it.topicId ? questionsForTopic(it.topicId).length > 0 : false
      return {
        id: it.id,
        kind: isReview ? 'Review' : 'Lesson',
        subtopic: it.label,
        detail: isReview
          ? it.dueInDays < 0
            ? `Review · was due ${dueLabel(it)}`
            : 'Spaced review · due today'
          : 'New — ready to learn',
        topicId: has || (!isReview && it.topicId) ? it.topicId : null,
        dueInDays: it.dueInDays,
      } satisfies PathItem
    })
}

// ---------------------------------------------------------------------------
// Problem sets (homework)
// ---------------------------------------------------------------------------

type Urgency = 'urgent' | 'soon' | 'later'

/** One homework card, however it got here — school-set sample or teacher-authored. */
interface StudentProblemSet {
  id: string
  title: string
  /** Topic labels, ' · ' joined. Derived from the set's topics; verbatim from the teacher for authored ones. */
  topics: string
  due: string
  urgency: Urgency
  /** Live, from the knowledge graph — never a hardcoded flag. See `unmetPrereqs`. */
  locked: boolean
  lockNote: string
  questions: readonly AuthoredQuestion[]
  /**
   * Open and with questions behind it. A set can be unlocked and still have
   * nothing in it (a teacher-authored set whose questions were never added),
   * and a button into an empty set is worse than saying so.
   */
  openable: boolean
  requireHandwriting?: boolean
}

/**
 * The school's own problem sets — the ones that exist before any teacher has
 * authored anything in this session, so the Home screen is never an empty shelf.
 *
 * Only the title and the topic ids are authored, and the topic ids are real
 * ones from `content/curriculum/topics.json`. Everything a card actually shows
 * — the topic line, the question count, the due date, whether it is locked and
 * why — is derived in `buildProblemSets` from the curriculum graph and the
 * student's live engine state.
 *
 * `questions` is authored only where real authored homework text exists (the
 * fractions/percentages set, which is the one this prototype has always
 * shipped). Where it is absent, `mint` draws that many real questions out of
 * the question bank for the set's topics instead of inventing any.
 */
interface SampleSetSeed {
  id: string
  title: string
  topicIds: readonly TopicId[]
  /** Days from today. Rendered as a real date, and what the urgency styling reads. */
  dueInDays: number
  questions?: readonly AuthoredQuestion[]
  /** How many questions to draw from the bank when `questions` is absent. */
  mint?: number
}

const SAMPLE_SET_SEEDS: readonly SampleSetSeed[] = [
  {
    id: 'sample.linear-mixed',
    title: 'Linear equations mixed set',
    topicIds: ['alg.linear'],
    dueInDays: 2,
    mint: 12,
  },
  {
    id: 'sample.fractions-percentages',
    title: 'Fractions & percentages',
    topicIds: ['num.fractions', 'num.fractions-to-percent'],
    dueInDays: 5,
    questions: [
      { topic: 'Fractions', q: 'Simplify 12⁄18 to its lowest terms.', hint: 'Divide top and bottom by their highest common factor.' },
      { topic: 'Fractions', q: 'Work out 2⁄3 + 1⁄6.', hint: 'Use a common denominator first.' },
      { topic: 'Percentages', q: 'Find 15% of 240.', hint: '' },
      { topic: 'Percentages', q: 'Write 0.45 as a percentage.', hint: '' },
      { topic: 'Fractions → %', q: 'Write 3⁄8 as a percentage.', hint: 'Divide, then multiply by 100.' },
      { topic: 'Percentages', q: 'A £60 coat is reduced by 20%. What is the new price?', hint: '' },
    ],
  },
  {
    id: 'sample.percent-change',
    title: 'Percentage change',
    topicIds: ['num.percent-change'],
    dueInDays: 0,
    mint: 8,
  },
]

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 'Due today' / 'Due tomorrow' / 'Due Fri 25 Jul' — a real date off the clock, not a frozen string. */
function dueDateLabel(dueInDays: number, now: number): string {
  if (dueInDays <= 0) return 'Due today'
  if (dueInDays === 1) return 'Due tomorrow'
  const on = new Date(now + dueInDays * MS_PER_DAY)
  return `Due ${on.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
}

/** Same threshold the scheduler promotes homework on (data/schedule.ts), so the badge and the queue can't disagree. */
const urgencyOf = (dueInDays: number): Urgency =>
  dueInDays <= 0 ? 'urgent' : dueInDays <= PROBLEM_SET_URGENT_DAYS ? 'soon' : 'later'

/** 'A', 'A and B', 'A, B and C' — the shape the authored lock notes were written in. */
function joinLabels(labels: readonly string[]): string {
  if (labels.length < 2) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/**
 * The prerequisite topics behind this set that the student has not mastered —
 * real edges from the knowledge graph (`prereqsOf`), deduped, in edge order.
 * Empty means the set is open.
 *
 * This replaces a hardcoded `locked` flag with a lock that can actually come
 * off: the same "every prerequisite mastered" rule `deriveFrontier` promotes
 * topics on, so finishing the prerequisite unlocks the homework in front of the
 * student rather than at the next content release. A topic the student has
 * already started or mastered is skipped — its prerequisites are moot, and a
 * set on work they are visibly doing must never read as locked. A topic with no
 * prerequisites on the graph can never lock: a missing gate is better than an
 * invented one.
 */
function unmetPrereqs(topicIds: readonly TopicId[], statusOf: (id: TopicId) => NodeStatus): TopicId[] {
  const unmet: TopicId[] = []
  for (const topicId of topicIds) {
    const own = statusOf(topicId)
    if (own === 'mastered' || own === 'inprogress') continue
    for (const prereq of prereqsOf(topicId)) {
      if (statusOf(prereq) === 'mastered') continue
      if (unmet.indexOf(prereq) < 0) unmet.push(prereq)
    }
  }
  return unmet
}

/**
 * Real questions for a sample set, drawn out of the question bank for its
 * topics. `questionAt` past the end of a topic's authored pool mints a fresh
 * template instance, so a templated topic can always fill a set.
 */
function mintQuestions(topicIds: readonly TopicId[], count: number): AuthoredQuestion[] {
  const drawn: AuthoredQuestion[] = []
  const perTopic = Math.ceil(count / Math.max(1, topicIds.length))
  for (const topicId of topicIds) {
    for (let i = 0; i < perTopic && drawn.length < count; i++) {
      const question = questionAt(topicId, i)
      if (!question) break
      // No hint: the bank's per-line notes are the worked solution, and a
      // homework hint invented here would be exactly the fabricated detail
      // the data can't support.
      drawn.push({ topic: topicLabel(topicId), q: `${question.prompt}: ${question.statement}`, hint: '' })
    }
  }
  return drawn
}

/**
 * Topic ids behind a teacher-authored set. `AuthoredProblemSet.topics` is the
 * labels of the catalogue topics the teacher ticked, ' · ' joined (see
 * TeacherApp's createHwSet), so this reads them straight back rather than
 * guessing at them. A label naming no topic is dropped — a set with one
 * resolvable topic still gates on that topic, and a wrong prerequisite would be
 * worse than a missing one.
 */
function topicIdsFromLabels(topics: string): TopicId[] {
  const byLabel = new Map<string, TopicId>()
  for (const group of catalogueGroups()) for (const topic of group.topics) byLabel.set(topic.label, topic.id)
  const ids: TopicId[] = []
  for (const label of topics.split('·')) {
    const id = byLabel.get(label.trim())
    if (id && ids.indexOf(id) < 0) ids.push(id)
  }
  return ids
}

/**
 * Every problem set the student can see, school-set ones first then whatever
 * the teacher has authored this session (data/teacherProblemSets.ts) — one
 * list, one shape, one set of rules, so an authored set gets the same real
 * prerequisite gating a sample one does instead of being unconditionally open.
 *
 * Authored due dates stay exactly as the teacher typed them (free text, never
 * parsed) and carry the neutral 'later' styling, which is how they have always
 * rendered; only the sample sets have a machine-readable deadline to colour.
 */
function buildProblemSets(
  authored: readonly AuthoredProblemSet[],
  engine: EngineState,
  now: number,
): StudentProblemSet[] {
  const statusOf = (id: TopicId): NodeStatus => engine.nodes[id]?.status ?? FALLBACK_NODE_STATE.status
  const gate = (topicIds: readonly TopicId[]) => {
    const unmet = unmetPrereqs(topicIds, statusOf)
    return {
      locked: unmet.length > 0,
      lockNote: unmet.length > 0 ? `Unlocks when you finish ${joinLabels(unmet.map((id) => `“${topicLabel(id)}”`))}.` : '',
    }
  }

  const sets: StudentProblemSet[] = []

  for (const seed of SAMPLE_SET_SEEDS) {
    const questions = seed.questions ?? mintQuestions(seed.topicIds, seed.mint ?? 0)
    const gated = gate(seed.topicIds)
    sets.push({
      id: seed.id,
      title: seed.title,
      topics: seed.topicIds.map(topicLabel).join(' · '),
      due: dueDateLabel(seed.dueInDays, now),
      urgency: urgencyOf(seed.dueInDays),
      questions,
      openable: !gated.locked && questions.length > 0,
      ...gated,
    })
  }

  for (const set of authored) {
    const gated = gate(topicIdsFromLabels(set.topics))
    sets.push({
      id: set.id,
      title: set.title,
      topics: set.topics,
      due: set.due,
      urgency: 'later',
      questions: set.questions,
      openable: !gated.locked && set.questions.length > 0,
      requireHandwriting: set.requireHandwriting,
      ...gated,
    })
  }

  return sets
}

// ---------------------------------------------------------------------------
// Free play
// ---------------------------------------------------------------------------

/**
 * One free-play row: a curriculum topic, with everything about it read live.
 * Was a hand-listed `{ name, unlocked, last }` object whose recency was a stale
 * copy of the sample node states and whose unlock flag was frozen.
 */
interface FpTopic {
  id: TopicId
  name: string
  /** The lesson-gate: free play is not a way round the taught path. */
  unlocked: boolean
  /** Recency straight off the engine — free play moves this, as the copy promises. */
  last: string
  /** Size of the free-play pool. 0 means no questions are authored for this topic yet. */
  questions: number
  /** A template backs the pool, so it never runs out — what the "unlimited questions" badge reads. */
  templated: boolean
  /** How many subtopics the curriculum lists here. Honest content signal for a topic with no questions yet. */
  subtopics: number
}

/** One free-play card: a curriculum strand and the topics under it. */
interface FpGroup {
  key: string
  label: string
  subs: readonly FpTopic[]
}

/**
 * The free-play map, derived from the curriculum rather than hand-listed.
 *
 * Strands (`catalogueGroups`) are the cards; the catalogue topics in each are
 * the rows, with any graph topic that is not in the teacher-facing catalogue
 * (`alg.basics`, `num.negatives-arithmetic`) appended to its strand so the map
 * still covers the whole graph. That is the whole curriculum — every topic
 * another agent adds shows up here the moment it lands in content, including
 * the geometry and statistics topics the hand-listed version never mentioned.
 *
 * Rows are topics, not subtopics, for two reasons that are not stylistic: the
 * engine records recency per topic, so a subtopic row could only ever repeat
 * its parent's "last studied"; and the free-play draw is `questionAt(topicId,
 * n)`, so a subtopic row would hand the student a question from a sibling
 * subtopic. The subtopic count is surfaced on the row instead.
 */
function buildFreePlay(engine: EngineState): FpGroup[] {
  const statusOf = (id: TopicId): NodeStatus => engine.nodes[id]?.status ?? FALLBACK_NODE_STATE.status

  const groups = catalogueGroups().map((group) => ({
    key: group.strandId as string,
    label: group.label,
    topicIds: group.topics.map((topic) => topic.id),
  }))
  const byStrand = new Map(groups.map((group) => [group.key, group]))
  const listed = new Set<TopicId>(groups.flatMap((group) => group.topicIds))
  for (const node of graphTopics()) {
    if (listed.has(node.id)) continue
    const strandId = topicById(node.id)?.strandId
    const group = strandId ? byStrand.get(strandId) : undefined
    if (!group) continue
    group.topicIds.push(node.id)
    listed.add(node.id)
  }

  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    subs: group.topicIds.map((topicId) => {
      const pool = questionsForTopic(topicId)
      const status = statusOf(topicId)
      return {
        id: topicId,
        name: topicLabel(topicId),
        // Same rule the live unlock always used: anything the student has
        // actually reached on the graph. 'notready' and 'locked' are the two
        // statuses that mean the taught path hasn't got here yet.
        unlocked: status !== 'notready' && status !== 'locked',
        last: engine.nodes[topicId]?.last ?? FALLBACK_NODE_STATE.last,
        questions: pool.length,
        templated: pool.some((q) => q.id.includes('#')),
        subtopics: subtopicsForTopic(topicId).length,
      } satisfies FpTopic
    }),
  }))
}

const NAV_ITEMS: Array<[string, Screen]> = [
  ['Home', 'shome'],
  ['Free play', 'freeplay'],
  ['Sessions', 'ssessions'],
  ['My map', 'smap'],
  ['Progress', 'sprogress'],
]

const INITIAL: StudentState = {
  screen: 'sdiagnostic',
  diagnosticDone: false,
  smapView: 'focused',
  pathCompleted: [],
  speedMode: false,
  fpTopic: null,
  fpLabel: null,
  fpProblemIdx: 0,
  practiceMode: null,
  practiceTopic: null,
  activePathId: null,
  activePsId: null,
  psIdx: 0,
  psAnswers: {},
  psSubmitted: false,
  psAttach: null,
  selectedLog: null,
  selectedNode: null,
  graphFilter: 'all',
}

export default function StudentApp() {
  const [s, setS] = useState<StudentState>(() => {
    // Only the durable bits of the screen state are restored: how far through
    // the path they are, and whether the placement test is done. Transient
    // navigation (which screen, which practice session) always starts clean, so
    // a reload never drops you back inside a half-finished question.
    const saved = loadSaved(`progress.${STUDENT_ID}`, {
      pathCompleted: INITIAL.pathCompleted,
      diagnosticDone: INITIAL.diagnosticDone,
    })
    return {
      ...INITIAL,
      pathCompleted: saved.pathCompleted ?? INITIAL.pathCompleted,
      diagnosticDone: saved.diagnosticDone ?? INITIAL.diagnosticDone,
      screen: saved.diagnosticDone ? 'shome' : INITIAL.screen,
    }
  })
  const psFileRef = useRef<HTMLInputElement>(null)
  const setState = (patch: Partial<StudentState> | ((st: StudentState) => Partial<StudentState>)) =>
    setS((st) => ({ ...st, ...(typeof patch === 'function' ? patch(st) : patch) }))

  /**
   * Live computed mastery, from the shared multi-student store
   * (data/students.ts) rather than a `useState` private to this component.
   *
   * That store is the single owner of every student's `EngineState`: it seeds
   * from the same sample overlays this file used to seed from, write-throughs
   * to the same `engine.aisha` key this file used to persist to, and notifies
   * every subscriber on a write. `useEngine` subscribes, so this component
   * re-renders when a different POV moves Aisha's state — and, the direction
   * that matters for the demo, the teacher's dashboard sees a gap the moment
   * the student flags the line that produced it.
   */
  const engine = useEngine(STUDENT_ID)
  const engineNode = (topicId: TopicId): EngineNodeState => engine.nodes[topicId] ?? FALLBACK_NODE_STATE

  /**
   * The live scheduler output. Recomputed whenever the engine moves, so
   * finishing a review genuinely reorders what comes next instead of ticking
   * off a fixed list.
   */
  // Write-through persistence for the screen state this component still owns.
  // The engine persists itself inside the shared store.
  useEffect(() => {
    saveState(`progress.${STUDENT_ID}`, { pathCompleted: s.pathCompleted, diagnosticDone: s.diagnosticDone })
  }, [s.pathCompleted, s.diagnosticDone])

  const queue = useMemo(() => buildQueue(engine, { cap: DAILY_ITEM_CAP }), [engine])
  const path = useMemo(() => derivePath(queue.items), [queue])

  /**
   * The whole curriculum, free-play-shaped. Recomputed when the engine moves so
   * mastering a topic genuinely opens its free play, and so a topic added to
   * `content/curriculum/` shows up without touching this file.
   */
  const fpGroups = useMemo(() => buildFreePlay(engine), [engine])

  /**
   * School-set problem sets and teacher-authored ones (data/teacherProblemSets.ts)
   * as one derived list. Memoised because a locked sample set still mints its
   * questions out of the bank, and re-instantiating those on every keystroke in
   * the homework screen would be wasteful.
   *
   * Up here with the other hooks, not down beside the homework screen it feeds:
   * the practice and diagnostic screens return early, so a hook below them would
   * be called conditionally.
   *
   * See data/teacherProblemSets.ts for the cross-route caveat, which is why the
   * dependency list watches the array's length as well as its identity: it is
   * mutated in place, so adding a set never changes the reference.
   */
  const authoredSets = getProblemSets()
  const problemSets = useMemo(
    () => buildProblemSets(authoredSets, engine, Date.now()),
    [authoredSets, engine],
  )

  /**
   * Every topic the student has actually touched, strongest first, straight
   * from the engine's difficulty-weighted mastery. Was a hardcoded four-row
   * array with fixed percentages.
   */
  const progressRows = useMemo(() => {
    const rows = Object.keys(engine.masteryByTopic).map((topicId) => {
      const tier = engine.masteryByTopic[topicId]
      const pct = Math.round(((tier.foundations + tier.core + tier.stretch) / 3) * 100)
      const band = masteryBand(tier)
      return {
        topicId,
        name: topicLabel(topicId),
        pct,
        label: band === 'mastered' ? 'Mastered' : band === 'building' ? 'Building' : 'Needs another look',
        tier,
      }
    })
    return rows.sort((a, b) => b.pct - a.pct)
  }, [engine])

  /**
   * XP is effort, never mastery — `data/xp.ts` explains why the two are kept
   * apart. Accumulated from sessions completed this run.
   */
  const [sessionResults, setSessionResults] = useState<{ kind: SessionKind; correct: number; total: number }[]>(
    () => loadSaved(`xp.${STUDENT_ID}`, [] as { kind: SessionKind; correct: number; total: number }[]),
  )
  const xp = useMemo(() => totalXp(sessionResults), [sessionResults])
  useEffect(() => { saveState(`xp.${STUDENT_ID}`, sessionResults) }, [sessionResults])

  /** What the student is on right now: the first frontier topic in the queue. */
  const workingOn = useMemo(
    () => queue.items.find((it) => it.kind === 'lesson') ?? queue.items[0],
    [queue],
  )

  /**
   * Logs a finished session and banks its XP. `LogActivity.items[].hit` is
   * per-question correctness, so the accuracy scaling in `sessionXp` comes
   * from the same record the Sessions screen renders — one source, so the two
   * can never disagree.
   */
  const logSession = (entry: LogActivity) => {
    pushLiveSession(entry)
    const total = entry.items.length
    if (total === 0) return
    const correct = entry.items.filter((q: { hit: boolean }) => q.hit).length
    const kind: SessionKind =
      entry.kind === 'Review' ? 'review'
        : entry.kind === 'Lesson' ? 'lesson'
        : entry.kind === 'Problem set' ? 'problemSet'
        : 'freeplay'
    setSessionResults((prev) => [...prev, { kind, correct, total }])
  }

  /**
   * Records one real attempt on the live engine. Difficulty comes from the
   * question bank (falls back to 'core' if a question id somehow isn't
   * found); weak is always false here - this is all confident practice
   * attempts from PracticeLoop/LessonSession/ReviewSession. weak is for
   * the diagnostic test's guesses instead (recordDiagnosticAttempt below).
   * No-ops for a topic that is not on the knowledge graph (`isGraphTopic`);
   * nothing outside the three topics with a question bank currently reaches
   * this.
   */
  /**
   * Records one attempt, INCLUDING per-line evidence.
   *
   * This is the chain the whole product rests on: the student flags a line,
   * that line carries the prerequisite subtopics it tests, and the engine
   * credits (or debits) the topic that owns them. A student failing the
   * fraction-to-decimal line inside a *percentage* question banks a fractions
   * gap without ever being served a fractions question.
   */
  const recordTopicAttempt = (topicId: TopicId, result: AttemptResult) => {
    if (!isGraphTopic(topicId)) return
    const question = questionById(result.problemId)
    const difficulty: MasteryTier = question?.difficulty ?? 'core'

    const flagged = (i: number): boolean =>
      result.flaggedLines === 'all' ? true : result.flaggedLines.includes(i)

    const lineOutcomes = (question?.lines ?? [])
      .map((line, i) => ({
        lineIndex: i,
        correct: !flagged(i),
        prereqSubtopicIds: line.prereqSubtopicIds ?? [],
      }))
      .filter((l) => l.prereqSubtopicIds.length > 0)

    recordFor(STUDENT_ID, {
      topicId,
      difficulty,
      correct: result.correct,
      weak: false,
      subtopicId: question?.subtopicId,
      lineOutcomes,
    })

    // Surface a wrong, tagged line to the teacher when the prerequisite lives
    // in a different topic — that difference is the diagnostic insight.
    for (const outcome of lineOutcomes) {
      if (outcome.correct) continue
      for (const subtopicId of outcome.prereqSubtopicIds) {
        const sub = subtopicById(subtopicId)
        if (!sub || sub.topicId === topicId) continue
        pushGap({
          subtopicId,
          subtopicLabel: sub.label,
          prereqTopicId: sub.topicId,
          prereqTopicLabel: topicLabel(sub.topicId),
          seenInTopicId: topicId,
          seenInTopicLabel: topicLabel(topicId),
          lineText: question?.lines[outcome.lineIndex]?.text ?? '',
          reason: result.reasons[outcome.lineIndex],
          at: 'just now',
        })
      }
    }
  }

  /**
   * Records one diagnostic-test answer on the live engine - same
   * `isGraphTopic` guard, same `questionById` difficulty lookup, and the
   * same `recordFor` call as recordTopicAttempt above, just with `weak` and
   * `correct` passed straight through instead of hardcoded, since
   * DiagnosticTest's onAnswer already computed them (see that component: "I
   * guessed" always passes correct: false, weak: true; "I don't know" never
   * calls onAnswer at all, so never reaches here).
   */
  const recordDiagnosticAttempt = (topicId: TopicId, questionId: QuestionId, correct: boolean, weak: boolean) => {
    if (!isGraphTopic(topicId)) return
    const difficulty: MasteryTier = questionById(questionId)?.difficulty ?? 'core'
    recordFor(STUDENT_ID, { topicId, difficulty, correct, weak })
  }

  /**
   * LessonSession/ReviewSession's onGamingSignal - fires once three
   * consecutive attempts in one session were all marked "I got it all
   * wrong". Builds a live Oversight card (data/liveOversight.ts) styled the
   * same as the static gaming-pattern sample in content/samples/oversight.json,
   * honest about what was actually observed rather than inventing per-line
   * detail this app doesn't have for a live-detected pattern.
   */
  const reportGamingSignal = (topicId: TopicId, sessionKind: 'Lesson' | 'Review') => {
    const subtopic = topicLabel(topicId)
    const kindLower = sessionKind.toLowerCase()
    pushLiveFlag({
      kind: 'gaming',
      student: 'Aisha Bello',
      context: `${subtopic} · ${kindLower}, today`,
      title: 'Three "all wrong" answers in a row',
      body: `Aisha marked three attempts in a row as "I got it all wrong" in this ${kindLower}, without narrowing down which lines were right or wrong first. That can be a genuine stuck point, or a way to skip straight past the diagnostic to the worked solution. Flagged for your judgement rather than assumed either way.`,
      asks: 'Genuine stuck point, or skipping the diagnostic?',
      detail: {
        kind: sessionKind,
        title: `${subtopic} · ${kindLower}, live-detected`,
        date: 'Today',
        result: 'flagged',
        flag: 'attention',
        upload: false,
        items: [
          {
            label: 'Pattern',
            q: 'Three consecutive "I got it all wrong" answers',
            hit: true,
            note: `Marked "I got it all wrong" three times running in this ${kindLower}, without picking out specific lines first.`,
          },
        ],
      },
    })
  }

  /**
   * Live mastery level in [0,1] for a topic - the same foundations/core/
   * stretch tier average `progressPct` below computes, just left as a raw
   * fraction instead of rounded to a percentage. Threaded into
   * LessonSession's teach-phase scaffolding fade; undefined when the engine
   * has no tier data yet for this topic, matching LessonSession's own
   * "unavailable -> fully scaffolded" default.
   */
  const masteryLevelFor = (topicId: TopicId): number | undefined => {
    const tier = engine.masteryByTopic[topicId]
    return tier ? (tier.foundations + tier.core + tier.stretch) / 3 : undefined
  }

  const openPathItem = (i: number) => {
    const it = path[i]
    const topicId = it.topicId
    const mode: PracticeMode = !topicId ? 'unavailable' : it.kind === 'Review' ? 'review' : 'lesson'
    setState({
      screen: 'practice',
      activePathId: it.id,
      practiceMode: mode,
      practiceTopic: topicId ?? null,
      fpLabel: null,
    })
  }

  /**
   * Topics carry their own ids now, so there is nothing to look a name up in.
   * A topic with an empty pool still routes to the honest "not built out yet"
   * placeholder rather than into a draw with nothing to draw from.
   */
  const openFreePlay = (topic: FpTopic) => {
    const playable = topic.questions > 0
    setState({
      screen: 'practice',
      activePathId: null,
      practiceMode: playable ? 'freeplay' : 'unavailable',
      practiceTopic: playable ? topic.id : null,
      fpLabel: topic.name,
      fpProblemIdx: 0,
    })
  }

  // A path item only counts as "done" if it was actually completed (session outcome, win or
  // lose) - not just opened. A failed review still marks the item done (the work was done; the
  // consequence is the redo-lesson flag, not lost progress), matching the non-punitive framing
  // used throughout the practice loop itself. Marks whichever item was active regardless of
  // order - with "Speed through lessons" on, that can be a Lesson further down the path than
  // pathPrefixDone() has reached; see isPathItemLocked() for the gate this gets recorded against.
  const completePathItem = () =>
    setState((st) => ({
      screen: 'shome',
      pathCompleted: st.activePathId !== null && !st.pathCompleted.includes(st.activePathId)
        ? [...st.pathCompleted, st.activePathId]
        : st.pathCompleted,
      activePathId: null,
      practiceMode: null,
      practiceTopic: null,
    }))

  /** The old-style "N of 6 done" sequential count: the length of the unbroken done-prefix from index 0, so speed-running a later item never inflates this past the earliest still-undone one. */
  const pathPrefixDone = (items: PathItem[], completed: string[]): number => {
    let n = 0
    while (n < items.length && completed.includes(items[n].id)) n++
    return n
  }

  /**
   * A path Review counts as a gate only if it actually has content behind
   * it (see PATH_TOPIC_ID) - a Review with none (e.g. 'Negatives', which has
   * no question bank) can never be completed through openPathItem/completePathItem,
   * so treating it as a gate would permanently lock every item after it with
   * no way out short of Speed mode. Lessons never gate at all, matching
   * isPathItemLocked's original contract.
   */
  const isGatingReview = (it: PathItem): boolean => it.kind === 'Review' && !!it.topicId

  /**
   * True when an earlier path item is a (completable) Review that hasn't
   * been done yet - Reviews are the only gate (Lessons never block each other
   * or get blocked by an earlier Lesson), matching Appendix A: "freedom to
   * speed through lessons" but progress "capped" until reviews are done.
   * Speed mode lifts the gate entirely; the honest "N reviews pending"
   * indicator (see pendingReviews below) is what keeps that from silently
   * reading as full completion once it's lifted.
   */
  const isPathItemLocked = (i: number): boolean =>
    !s.speedMode && path.some((it, j) => j < i && isGatingReview(it) && !s.pathCompleted.includes(it.id))

  /**
   * Reviews that got jumped over via speed mode: incomplete, but earlier
   * than the furthest item actually completed. Zero whenever nothing's been
   * completed out of order (including with speed mode off, since locking
   * makes that unreachable) - this is what keeps a later Lesson's "Done"
   * from silently reading as full completion of everything before it. Scoped
   * to the same gating Reviews as isPathItemLocked, so a content-less Review
   * like 'Negatives' can't sit here forever as a pending count that can never
   * be cleared.
   */
  // Reviews jumped over via speed mode: still in the queue, still incomplete,
  // but sitting above something already done.
  const highestDoneIdx = path.reduce((m, it, i) => (s.pathCompleted.includes(it.id) ? i : m), -1)
  const pendingReviews = path.filter(
    (it, i) => isGatingReview(it) && i < highestDoneIdx && !s.pathCompleted.includes(it.id),
  )

  // One-time diagnostic/placement test, shown in place of Home until it's done - see
  // diagnosticDone's comment on StudentState. Guarded on both the screen and the flag (rather
  // than just the screen) so this stays correct even if something later ever routes back to
  // 'sdiagnostic' by mistake; nothing currently does, since NAV_ITEMS has no entry for it.
  if (s.screen === 'sdiagnostic' && !s.diagnosticDone) {
    return (
      <DiagnosticTest
        onAnswer={recordDiagnosticAttempt}
        onDone={() => setState({ screen: 'shome', diagnosticDone: true })}
      />
    )
  }

  if (s.screen === 'practice') {
    const exitPractice = () =>
      setState({
        screen: s.fpLabel ? 'fptopic' : 'shome',
        fpLabel: null,
        activePathId: null,
        practiceMode: null,
        practiceTopic: null,
      })

    /**
     * The honest "not built out yet" placeholder, shown instead of mismatched
     * content. Extracted so the free-play branch can fall back to it too.
     */
    const renderUnavailable = () => {
          const unavailableLabel = s.fpLabel || (s.activePathId != null ? (path.find((it) => it.id === s.activePathId)?.subtopic ?? 'this subtopic') : 'this subtopic')
        return (
          <div style={{ minHeight: '100vh', background: '#f6f1e7', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '100%', background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px' }}>
              <div style={{ maxWidth: 680, margin: '0 auto' }}>
                <div onClick={exitPractice} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>
                  {s.fpLabel ? '← Free play' : '← Home'}
                </div>
              </div>
            </div>
            <div style={{ width: '100%', maxWidth: 560, padding: '70px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#8a7c63', lineHeight: 1.6, textWrap: 'pretty' }}>
                Practice content for {unavailableLabel} isn't built out in this prototype yet.
              </p>
              <button
                onClick={exitPractice}
                style={{ marginTop: 14, background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                {s.fpLabel ? '← Back to Free play' : '← Back to Home'}
              </button>
            </div>
          </div>
        )
    }

    const practiceLesson = s.practiceTopic ? lessonForTopic(s.practiceTopic) : undefined

    if (s.practiceMode === 'lesson' && s.practiceTopic && practiceLesson) {
      const topic = s.practiceTopic
      return (
        <LessonSession
          lesson={practiceLesson}
          backLabel="← Home"
          onExit={exitPractice}
          onComplete={completePathItem}
          onAttempt={(result) => recordTopicAttempt(topic, result)}
          onGamingSignal={() => reportGamingSignal(topic, 'Lesson')}
          masteryLevel={masteryLevelFor(topic)}
          onSessionLogged={logSession}
          statusOf={(id) => (engine.nodes[id] ?? FALLBACK_NODE_STATE).status}
          lastWorked={engine.nodes[topic]?.last}
        />
      )
    }

    if (s.practiceMode === 'review' && s.practiceTopic) {
      const topic = s.practiceTopic
      const lesson = practiceLesson
      return (
        <ReviewSession
          topic={topic}
          subtopicLabel={topicLabel(topic)}
          backLabel="← Home"
          onExit={exitPractice}
          onComplete={completePathItem}
          onGoToLesson={lesson ? () => setState({ practiceMode: 'lesson' }) : undefined}
          onAttempt={(result) => recordTopicAttempt(topic, result)}
          onGamingSignal={() => reportGamingSignal(topic, 'Review')}
          onSessionLogged={logSession}
        />
      )
    }

    if (s.practiceMode === 'freeplay' && s.practiceTopic) {
      const topic = s.practiceTopic
      // `questionAt` past the end of the authored pool mints a fresh instance
      // from a template rather than wrapping, so free play genuinely never
      // repeats on a templated topic. The modulo fallback covers topics that
      // have questions but no template yet.
      const pool = questionsForTopic(topic)
      const problem = questionAt(topic, s.fpProblemIdx) ?? pool[s.fpProblemIdx % pool.length]
      // `openFreePlay` already refuses to enter a topic with no questions, so
      // this should be unreachable. Guarded anyway because PracticeLoop takes a
      // non-optional problem: an undefined here would be a blank crash rather
      // than the honest placeholder two branches below.
      if (!problem) return renderUnavailable()
      return (
        <PracticeLoop
          key={`${problem.id}-${s.fpProblemIdx}`}
          variant="student"
          problem={problem}
          fpLabel={s.fpLabel}
          backLabel="← Free play"
          title={s.fpLabel || undefined}
          onExit={exitPractice}
          onComplete={(result) => {
            recordTopicAttempt(topic, result)
            setState((st) => ({ fpProblemIdx: st.fpProblemIdx + 1 }))
          }}
        />
      )
    }

    return renderUnavailable()
  }

  // top nav — the tab that stays lit for each screen
  const cur: string =
    (
      {
        shome: 'shome',
        freeplay: 'freeplay',
        fptopic: 'freeplay',
        ssessions: 'ssessions',
        ssessiondetail: 'ssessions',
        smap: 'smap',
        sprogress: 'sprogress',
        psolve: 'shome',
      } as Record<string, string>
    )[s.screen] || 'shome'

  const topBar = (maxWidth: number): ReactNode => (
    <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '0 22px' }}>
      <div style={{ maxWidth, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, height: 56 }}>
        <Link
          to="/"
          style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}
        >
          <Logo size={26} />
          <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 17, color: '#fff' }}>Anadromos</span>
        </Link>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {NAV_ITEMS.map(([label, scr]) => {
            const on = cur === scr
            return (
              <div
                key={scr}
                onClick={() => setState({ screen: scr })}
                style={{ fontSize: 13, fontWeight: on ? 600 : 500, color: on ? '#fff' : '#9fb4c7', background: on ? 'rgba(221,106,47,.16)' : 'transparent', padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}
              >
                {label}
              </div>
            )
          })}
        </div>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#dd6a2f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
          AB
        </div>
      </div>
    </div>
  )

  // ---- knowledge graph (My map) ----
  const graphNodes = graphTopics().map((n) => {
    const st = NODE_STYLE[engineNode(n.id).status]
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
    const frontier = engineNode(b).status === 'frontier'
    return { d: edgePath(a, b), stroke: frontier ? '#e8a06a' : '#d3c6ab', sw: frontier ? 2 : 1.4 }
  })
  const gf = s.graphFilter
  const activeBasket = gf === 'all' ? null : graphFilters().find((f) => f.id === gf)
  const inFocus = (id: TopicId) => !activeBasket || activeBasket.topicIds.indexOf(id) > -1
  const focusedNodes = graphNodes.map((n) => ({ ...n, op: inFocus(n.id) ? 1 : 0.14 }))
  const focusedEdges = graphEdges.map((e, idx) => {
    const [a, b] = edgePairs()[idx]
    return { ...e, op: inFocus(a) && inFocus(b) ? 1 : 0.1 }
  })
  const selNode = s.selectedNode ? graphTopics().find((n) => n.id === s.selectedNode) : null

  // ---- problem set (homework) ----
  // Falls back to a set that can actually be opened, never to an empty or locked one - the psolve
  // screen indexes straight into `questions` and there is no honest screen to show for a set with
  // nothing in it. The cards below only open an openable set, so this is belt and braces.
  const curPS: StudentProblemSet =
    problemSets.find((p) => p.id === s.activePsId && p.questions.length > 0) ??
    problemSets.find((p) => p.openable) ??
    problemSets.find((p) => p.questions.length > 0) ??
    problemSets[0]
  const psIdx = s.psIdx
  const psAns = s.psAnswers
  const psAnsweredCount = curPS.questions.filter((_, i) => (psAns[i] || '').trim()).length
  const psCur = curPS.questions[psIdx] || curPS.questions[0]
  const psIsLast = psIdx === curPS.questions.length - 1
  /** Teacher-set "require handwriting" gate (data/teacherProblemSets.ts's AuthoredProblemSet.requireHandwriting) - mirrors PracticeLoop's own `blocked` pattern, applied at the whole-set level since Problem Sets don't render PracticeLoop at all. */
  const psBlocked = !!curPS.requireHandwriting && !s.psAttach

  const mapToggleStyle = (on: boolean): CSSProperties => ({
    cursor: 'pointer',
    fontSize: 12.5,
    fontWeight: 600,
    padding: '8px 15px',
    borderRadius: 8,
    background: on ? '#0e2a43' : '#efe7d9',
    color: on ? '#fff' : '#5c6773',
    border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd',
  })

  // Live Lesson/Review sessions Aisha has actually completed this tab (data/liveSessions.ts),
  // shown ahead of the static sample history - same merge-live-in pattern as authoredSets above
  // and TeacherApp.tsx's ovList. selectedLog indexes into this combined list, not the sample
  // activity log alone.
  const allSessions = [...getLiveSessions(), ...activityLogFor(STUDENT_ID)]
  const selectedLog = s.selectedLog != null ? allSessions[s.selectedLog] : null

  return (
    <>
      {/* ============ STUDENT HOME ============ */}
      {s.screen === 'shome' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(680)}
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>Friday · week 9</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 28, margin: '6px 0 22px', color: '#0e2a43' }}>Good afternoon, Aisha</h1>

            {/* your path: lessons + reviews */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
              <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Your path</h2>
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{pathPrefixDone(path, s.pathCompleted)} of {path.length} done</span>
              {pendingReviews.length > 0 && (
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#b6531f' }}>
                  · {pendingReviews.length} review{pendingReviews.length === 1 ? '' : 's'} pending
                </span>
              )}
              <button
                onClick={() => setState((st) => ({ speedMode: !st.speedMode }))}
                style={{ ...mapToggleStyle(s.speedMode), marginLeft: 'auto', padding: '7px 13px', fontSize: 12 }}
              >
                {s.speedMode ? '⚡ Speed through lessons: on' : 'Speed through lessons'}
              </button>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: '#5c6773', maxWidth: 560, textWrap: 'pretty' }}>
              Lessons and reviews on the subtopics next on your learning path. Finish all six and a fresh set unlocks. A
              pending review locks what comes after it — turn on "Speed through lessons" to push ahead through later
              lessons anyway and catch up on the review later.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {path.map((it, i) => {
                const complete = s.pathCompleted.includes(it.id)
                const locked = isPathItemLocked(i)
                const isNext = !complete && i === pathPrefixDone(path, s.pathCompleted)
                const isReview = it.kind === 'Review'
                return (
                  <div
                    key={i}
                    onClick={() => {
                      if (!locked) openPathItem(i)
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: `1px solid ${isNext ? '#f0d3bc' : '#e4dccb'}`, borderRadius: 11, padding: '14px 16px', cursor: locked ? 'not-allowed' : 'pointer', opacity: complete ? 0.6 : locked ? 0.55 : 1 }}
                  >
                    <span
                      style={{ width: 26, height: 26, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: complete ? '#1f4e75' : isNext ? '#dd6a2f' : '#efe7d9', color: complete || isNext ? '#fff' : '#a99e88' }}
                    >
                      {complete ? '✓' : locked ? '🔒' : i + 1}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase', fontWeight: 600, padding: '2px 8px', borderRadius: 5, flex: 'none', background: isReview ? '#e4edf3' : '#fdf0e6', color: isReview ? '#1f4e75' : '#b6531f' }}>
                          {it.kind}
                        </span>
                        <span style={{ fontSize: 14.5, fontWeight: 600, color: '#1a2129' }}>{it.subtopic}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: '#8a7c63', marginTop: 2 }}>
                        {it.detail} · {isReview ? '~4 min' : '~10 min'}
                      </div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', color: complete ? '#8a7c63' : locked ? '#a99e88' : '#dd6a2f' }}>
                      {complete ? 'Done' : locked ? '🔒 Locked' : isNext ? 'Start →' : 'Open'}
                    </span>
                  </div>
                )
              })}
            </div>
            {path.length > 0 && s.pathCompleted.length >= path.length && (
              <div style={{ marginTop: 12, background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 11, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13.5, color: '#2b4a63', textWrap: 'pretty' }}>
                  Nice work — you've cleared this set. A fresh batch of lessons and reviews is ready.
                </div>
                <button
                  onClick={() => setState({ pathCompleted: [] })}
                  style={{ marginLeft: 'auto', background: '#1f4e75', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  Load the next six →
                </button>
              </div>
            )}

            {/* problem sets: teacher-set homework */}
            <div style={{ marginTop: 30 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Problem sets</h2>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>homework from Ms. Okafor</span>
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: '#5c6773', maxWidth: 520, textWrap: 'pretty' }}>
                Set by your teacher, on their own deadlines. Some unlock only once you've finished the lessons they build on.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {problemSets.map((p) => (
                  <div key={p.id} style={{ background: '#fff', border: `1px solid ${p.locked ? '#e4dccb' : '#d3e0ea'}`, borderRadius: 12, padding: '16px 18px', opacity: p.locked ? 0.92 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2129' }}>{p.title}</div>
                        <div style={{ fontSize: 12.5, color: '#8a7c63', marginTop: 3 }}>
                          {p.topics} · {p.questions.length} question{p.questions.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontFamily: FONT_MONO,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '4px 10px',
                          borderRadius: 20,
                          whiteSpace: 'nowrap',
                          background: p.urgency === 'urgent' ? '#fbe7d8' : p.urgency === 'soon' ? '#fdf0e6' : '#eef3f7',
                          color: p.urgency === 'urgent' || p.urgency === 'soon' ? '#b6531f' : '#1f4e75',
                          border: `1px solid ${p.urgency === 'urgent' ? '#eecab0' : p.urgency === 'soon' ? '#f0d3bc' : '#d3e0ea'}`,
                        }}
                      >
                        🗓 {p.due}
                      </span>
                    </div>
                    {p.locked && (
                      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start', background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 9, padding: '10px 12px' }}>
                        <span style={{ fontSize: 13, flex: 'none' }}>🔒</span>
                        <div style={{ fontSize: 12.5, color: '#5c6773', lineHeight: 1.5, textWrap: 'pretty' }}>{p.lockNote}</div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (p.openable) setState({ screen: 'psolve', psIdx: 0, psAnswers: {}, psSubmitted: false, activePsId: p.id })
                      }}
                      style={{ marginTop: 12, background: p.openable ? '#dd6a2f' : '#f2ece0', color: p.openable ? '#fff' : '#a99e88', border: 'none', borderRadius: 9, padding: '11px 16px', fontSize: 13.5, fontWeight: 600, cursor: p.openable ? 'pointer' : 'not-allowed' }}
                    >
                      {p.locked ? '🔒 Locked' : p.openable ? 'Start homework →' : 'Not built out yet'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ margin: '24px 4px 0', fontSize: 11.5, lineHeight: 1.5, color: '#a99e88', textAlign: 'center', textWrap: 'pretty' }}>
              No streaks, points, or rankings. Just the next right thing to work on, and your own progress over time.
            </p>
          </div>
        </div>
      )}

      {/* ============ STUDENT PROGRESS ============ */}
      {s.screen === 'sprogress' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(680)}
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>My progress</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>How you're doing</h1>
            <p style={{ margin: '0 0 22px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 520, textWrap: 'pretty' }}>
              This is only ever about you, then and now. It's never a comparison to anyone else in your class.
            </p>

            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 150px', background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '16px 18px' }}>
                <div style={monoCap({ fontSize: 10.5, color: '#8a7c63' })}>Effort this session</div>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: 600, color: '#0e2a43', marginTop: 4 }}>{xp} XP</div>
                <div style={{ fontSize: 12, color: '#8a7c63', marginTop: 2 }}>
                  {sessionResults.length} session{sessionResults.length === 1 ? '' : 's'} · effort, not a score
                </div>
              </div>
              <div style={{ flex: '1 1 150px', background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '16px 18px' }}>
                <div style={monoCap({ fontSize: 10.5, color: '#8a7c63' })}>Topics touched</div>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: 600, color: '#0e2a43', marginTop: 4 }}>{progressRows.length}</div>
                <div style={{ fontSize: 12, color: '#8a7c63', marginTop: 2 }}>
                  {progressRows.filter((r) => r.label === 'Mastered').length} mastered
                </div>
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px' }}>
              <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 16px', color: '#0e2a43' }}>What you've built up</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {progressRows.length === 0 && (
                  <p style={{ margin: 0, fontSize: 13.5, color: '#8a7c63' }}>
                    Nothing yet — finish a lesson or a review and it will show up here.
                  </p>
                )}
                {progressRows.map((t) => {
                  const pct = t.pct
                  return (
                    <div key={t.topicId}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 500, color: '#1a2129' }}>{t.name}</span>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63' }}>{t.label}</span>
                      </div>
                      <div style={{ height: 12, background: '#f0e9dc', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 85 ? '#1f4e75' : pct >= 60 ? '#4a86ad' : '#dd6a2f', borderRadius: 6 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ marginTop: 16, background: '#fdf0e6', border: '1px solid #f0d3bc', borderRadius: 12, padding: '18px 20px' }}>
              <div style={monoCap({ fontSize: 10.5, letterSpacing: '.6px', color: '#b6531f' })}>Working on now</div>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 600, color: '#0e2a43', margin: '6px 0 4px' }}>
                {workingOn ? workingOn.label : 'All caught up'}
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#8a6b4f', textWrap: 'pretty' }}>
                {workingOn
                  ? workingOn.kind === 'lesson'
                    ? "You're most of the way through the ideas this builds on. Keep going — it gets less hand-held as you get stronger."
                    : `Due ${dueLabel(workingOn)}. Reviews are what make it stick.`
                  : 'Nothing is due right now. Free play is there whenever you want more practice.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ============ STUDENT SESSIONS ============ */}
      {s.screen === 'ssessions' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(680)}
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>Past sessions</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>What you've worked on</h1>
            <p style={{ margin: '0 0 20px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 520, textWrap: 'pretty' }}>
              Every lesson, problem set and review you've done. Open one to see exactly where things clicked and where they didn't.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {allSessions.map((a, i) => (
                <div
                  key={i}
                  onClick={() => setState({ screen: 'ssessiondetail', selectedLog: i })}
                  style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 11, padding: '15px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: a.flag === 'attention' ? '#dd6a2f' : '#1f4e75' }} />
                  <span style={kindStyle}>{a.kind}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2129', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                    <div style={{ fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>{a.summary}</div>
                  </div>
                  <span style={{ ...logFlag(a.flag), fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{a.result}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#a99e88', whiteSpace: 'nowrap' }}>{a.date}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============ STUDENT SESSION DETAIL ============ */}
      {s.screen === 'ssessiondetail' && selectedLog && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px' }}>
            <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div onClick={() => setState({ screen: 'ssessions' })} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>
                ← Past sessions
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 13, color: '#dbe6ef', fontFamily: FONT_SERIF }}>{selectedLog.title}</span>
            </div>
          </div>
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '26px 24px 60px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={kindStyle}>{selectedLog.kind}</span>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 23, margin: 0, color: '#0e2a43' }}>{selectedLog.title}</h1>
              <span style={{ ...logFlag(selectedLog.flag), fontSize: 12, fontWeight: 600, padding: '3px 11px', borderRadius: 20, whiteSpace: 'nowrap' }}>{selectedLog.result}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63' }}>{selectedLog.date}</span>
            </div>
            <p style={{ margin: '10px 0 18px', fontSize: 13, color: '#5c6773' }}>Where it went right, and the steps worth another look.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {selectedLog.items.map((it, qi) => (
                  <div
                    key={qi}
                    style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 14, padding: '13px 14px', borderRadius: 9, background: it.hit ? '#fdf0e6' : '#faf6ee', border: `1px solid ${it.hit ? '#f0d3bc' : '#ece3d2'}` }}
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
                      </div>
                      <div style={{ fontSize: 12.5, color: '#5c6773', marginTop: 4, textWrap: 'pretty' }}>{it.note}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px' }}>
                <div style={monoCap({ fontSize: 10.5, letterSpacing: '.5px', marginBottom: 10 })}>Your handwritten working</div>
                {selectedLog.upload ? (
                  <>
                    <div style={{ border: '1px solid #e4dccb', borderRadius: 10, height: 220, background: 'repeating-linear-gradient(#fffdf8,#fffdf8 30px,#eef0f2 31px)', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 14, left: 16, fontFamily: FONT_SERIF, fontSize: 17, color: '#33404b', transform: 'rotate(-1.5deg)' }}>3x − 7 = 11</div>
                      <div style={{ position: 'absolute', top: 44, left: 22, fontFamily: FONT_SERIF, fontSize: 17, color: '#33404b', transform: 'rotate(-1deg)' }}>3x = 11 − 7  ✗</div>
                      <div style={{ position: 'absolute', bottom: 0, width: '100%', padding: 7, background: 'rgba(14,42,67,.82)', color: '#dbe6ef', fontSize: 11, textAlign: 'center', fontFamily: FONT_MONO }}>
                        you uploaded this
                      </div>
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.5, color: '#8a7c63', textWrap: 'pretty' }}>
                      Only your teacher sees this. It isn't read by the AI.
                    </p>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#8a7c63' }}>You didn't upload handwriting for this one.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ STUDENT MAP ============ */}
      {s.screen === 'smap' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(840)}
          <div style={{ maxWidth: 840, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>My map</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 12px', color: '#0e2a43' }}>What you know, and what's next</h1>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setState({ smapView: 'focused' })} style={mapToggleStyle(s.smapView !== 'full')}>
                This year's topics
              </button>
              <button onClick={() => setState({ smapView: 'full' })} style={mapToggleStyle(s.smapView === 'full')}>
                All of maths
              </button>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: '#8a7c63', marginBottom: 6 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#1f4e75', display: 'inline-block' }} />
                Mastered
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#7fb0cd', display: 'inline-block' }} />
                Getting there
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#fdf0e6', border: '2px solid #dd6a2f', display: 'inline-block' }} />
                Working on now
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#efe7d9', border: '1px solid #d8cbb2', display: 'inline-block' }} />
                Not yet
              </span>
            </div>

            {s.smapView !== 'full' ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '10px 0 4px' }}>
                  <span style={monoCap({ fontSize: 10.5, letterSpacing: '.6px', marginRight: 2 })}>Filter</span>
                  {[{ key: 'all', label: 'All basket topics' }, ...graphFilters().map((f) => ({ key: f.id, label: f.label }))].map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setState({ graphFilter: c.key })}
                      style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 8, background: gf === c.key ? '#0e2a43' : '#efe7d9', color: gf === c.key ? '#fff' : '#5c6773' }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#8a7c63', margin: '6px 0 8px' }}>
                  Tap a topic to see when you last worked on it. Free play sessions count towards recency.
                </div>
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
                  <GraphSvg edges={focusedEdges} nodes={focusedNodes} width="100%" style={{ minWidth: 760 }} />
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#8a7c63', margin: '10px 0 8px' }}>
                  The whole curriculum, across all years. Tap a topic to see when you last worked on it.
                </div>
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: 16, overflow: 'auto', maxHeight: '66vh' }}>
                  <GraphSvg edges={graphEdges} nodes={graphNodes} width={1120} />
                </div>
              </>
            )}

            {selNode && (
              <NodeInfoCard
                topicId={selNode.id}
                heading="Topic"
                title={selNode.label}
                fields={[
                  { label: 'Last worked', value: engineNode(selNode.id).last },
                  { label: 'Next review', value: engineNode(selNode.id).next },
                  { label: 'Times practised', value: engineNode(selNode.id).reps },
                ]}
                onClose={() => setState({ selectedNode: null })}
              />
            )}
          </div>
        </div>
      )}

      {/* ============ STUDENT PROBLEM SET (homework) ============ */}
      {s.screen === 'psolve' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div onClick={() => setState({ screen: 'shome', psSubmitted: false })} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>
                ← Today
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 13, color: '#dbe6ef', fontFamily: FONT_SERIF }}>{curPS.title}</span>
            </div>
          </div>

          {s.psSubmitted ? (
            <div style={{ maxWidth: 560, margin: '0 auto', padding: '60px 24px' }}>
              <div style={{ background: '#fff', border: '1px solid #d3e0ea', borderRadius: 16, padding: '34px 30px', textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#e4edf3', color: '#1f4e75', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 16px' }}>✓</div>
                <h1 style={{ fontFamily: FONT_SERIF, fontSize: 24, fontWeight: 600, color: '#0e2a43', margin: '0 0 6px' }}>Homework submitted</h1>
                <p style={{ margin: '0 0 4px', fontSize: 14, color: '#5c6773', textWrap: 'pretty' }}>
                  Sent to Ms. Okafor · {psAnsweredCount} of {curPS.questions.length} answered
                </p>
                <p style={{ margin: '0 0 22px', fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>
                  You'll see it marked in Sessions once your teacher has reviewed it.
                </p>
                <button
                  onClick={() => setState({ screen: 'shome', psSubmitted: false })}
                  style={{ background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 26px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  Back to Today
                </button>
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: '0 auto', padding: '26px 24px 60px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={monoCap()}>Problem set · homework</div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, color: '#b6531f', background: '#fdf0e6', border: '1px solid #f0d3bc', padding: '4px 10px', borderRadius: 20 }}>
                  🗓 {curPS.due}
                </span>
              </div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 25, margin: '0 0 4px', color: '#0e2a43' }}>{curPS.title}</h1>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#5c6773' }}>
                {curPS.topics} · {psAnsweredCount} of {curPS.questions.length} answered
              </p>

              {/* question navigator: answered = blue, current = navy, unanswered = sand */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                {curPS.questions.map((_, i) => {
                  const answered = (psAns[i] || '').trim()
                  const on = i === psIdx
                  return (
                    <button
                      key={i}
                      onClick={() => setState({ psIdx: i })}
                      style={{ width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: on ? '#0e2a43' : answered ? '#dbe6ef' : '#efe7d9', color: on ? '#fff' : answered ? '#1f4e75' : '#a99e88' }}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>

              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '24px 26px', boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '.6px', textTransform: 'uppercase', color: '#1f4e75', background: '#e4edf3', border: '1px solid #cddceb', padding: '2px 9px', borderRadius: 20 }}>
                    {psCur.topic}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 12, color: '#a99e88' }}>
                    Q{psIdx + 1} / {curPS.questions.length}
                  </span>
                </div>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 600, color: '#0e2a43', lineHeight: 1.4, textWrap: 'pretty' }}>{psCur.q}</div>
                {!!psCur.hint && <div style={{ marginTop: 8, fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>Hint: {psCur.hint}</div>}

                <div style={{ marginTop: 18, fontSize: 12.5, color: '#8a7c63', marginBottom: 8 }}>
                  Type your final answer. Use the palette for notation a keyboard can't produce.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: '#f6f1e7', border: '1px solid #e4dccb', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  {(
                    [
                      ['x²', '²'],
                      ['xⁿ', '^'],
                      ['√', '√'],
                      ['a⁄b', '⁄'],
                      ['( )', '()'],
                      ['π', 'π'],
                      ['×', '×'],
                      ['÷', '÷'],
                      ['%', '%'],
                    ] as const
                  ).map(([label, ins]) => (
                    <button
                      key={label}
                      onClick={() => setState((st) => ({ psAnswers: { ...st.psAnswers, [psIdx]: (st.psAnswers[psIdx] || '') + ins } }))}
                      style={{ minWidth: 38, height: 36, background: '#fff', border: '1px solid #ddd2bd', borderRadius: 8, fontFamily: FONT_SERIF, fontSize: 15, color: '#1a2129', cursor: 'pointer' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  value={psAns[psIdx] || ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setState((st) => ({ psAnswers: { ...st.psAnswers, [psIdx]: v } }))
                  }}
                  placeholder="Your answer…"
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8cbb2', borderRadius: 10, padding: '14px 15px', fontSize: 18, fontFamily: FONT_SERIF, color: '#1a2129', background: '#fff' }}
                />

                <div style={{ marginTop: 16, border: '1px dashed #cdbfa6', borderRadius: 11, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0e2a43' }}>Handwritten working</span>
                    <span
                      style={
                        curPS.requireHandwriting
                          ? { fontSize: 10.5, fontWeight: 600, color: '#b6531f', background: '#fbe7d8', border: '1px solid #eecab0', padding: '2px 9px', borderRadius: 20 }
                          : { fontSize: 10.5, fontWeight: 600, color: '#5c6773', background: '#eef0f2', border: '1px solid #dfe3e7', padding: '2px 9px', borderRadius: 20 }
                      }
                    >
                      {curPS.requireHandwriting ? 'Required for this assignment' : 'Optional'}
                    </span>
                  </div>
                  {s.psAttach ? (
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, background: '#f6f1e7', border: '1px solid #e4dccb', borderRadius: 8, padding: '8px 12px' }}>
                      <span style={{ fontSize: 13 }}>📎</span>
                      <span style={{ fontSize: 13, color: '#1a2129', flex: 1 }}>{s.psAttach}</span>
                      <button onClick={() => setState({ psAttach: null })} style={{ border: 'none', background: 'transparent', color: '#8a7c63', fontSize: 12, cursor: 'pointer' }}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => psFileRef.current?.click()}
                      style={{ marginTop: 10, background: '#fff', border: '1px solid #cdbfa6', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, color: '#0e2a43', cursor: 'pointer' }}
                    >
                      📎 Add a photo or PDF
                    </button>
                  )}
                  <input
                    ref={psFileRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0]
                      if (f) setState({ psAttach: f.name })
                    }}
                    style={{ display: 'none' }}
                  />
                  <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.5, color: '#8a7c63', textWrap: 'pretty' }}>
                    {curPS.requireHandwriting
                      ? 'Your teacher has asked for a photo of your written working across this whole set - attach it before submitting.'
                      : 'Optional across the whole set — attach a photo of your written working so your teacher can see your method.'}
                  </p>
                </div>
              </div>

              <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setState((st) => ({ psIdx: Math.max(0, st.psIdx - 1) }))}
                  disabled={psIdx === 0}
                  style={{ background: '#fff', color: '#0e2a43', border: '1px solid #cdbfa6', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  ← Previous
                </button>
                {psIsLast ? (
                  <button
                    onClick={() => {
                      if (psBlocked) return
                      setState({ psSubmitted: true })
                    }}
                    disabled={psBlocked}
                    style={{ marginLeft: 'auto', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 28px', fontSize: 14.5, fontWeight: 600, background: psBlocked ? '#e7c3ab' : '#dd6a2f', cursor: psBlocked ? 'not-allowed' : 'pointer' }}
                  >
                    Submit homework →
                  </button>
                ) : (
                  <button
                    onClick={() => setState((st) => ({ psIdx: Math.min(curPS.questions.length - 1, st.psIdx + 1) }))}
                    style={{ marginLeft: 'auto', background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 28px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Next question →
                  </button>
                )}
              </div>
              {psIsLast && psBlocked && (
                <p style={{ margin: '10px 4px 0', fontSize: 12, color: '#b6531f', textAlign: 'center' }}>
                  Your teacher has asked for a photo of your handwritten working before this set can be submitted.
                </p>
              )}
              <p style={{ margin: '16px 4px 0', fontSize: 11.5, lineHeight: 1.5, color: '#a99e88', textAlign: 'center', textWrap: 'pretty' }}>
                Homework is submitted to your teacher as a whole set — you can move between questions freely before submitting.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ============ FREE PLAY: complete knowledge graph ============ */}
      {s.screen === 'freeplay' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(840)}
          <div style={{ maxWidth: 840, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>Free play</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>Practise anything you like</h1>
            <p style={{ margin: '0 0 20px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 560, textWrap: 'pretty' }}>
              The complete map of maths. Pick a topic to see its subtopics — you can free-play any subtopic whose lesson you've already done. Free play counts towards how recently you've studied a subtopic.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
              {fpGroups.map((t) => {
                const unlocked = t.subs.filter((su) => su.unlocked).length
                return (
                  <div
                    key={t.key}
                    onClick={() => setState({ screen: 'fptopic', fpTopic: t.key, selectedNode: null })}
                    style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px', cursor: 'pointer' }}
                  >
                    <div style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 600, color: '#0e2a43' }}>{t.label}</div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63', margin: '8px 0 8px' }}>
                      {unlocked} of {t.subs.length} unlocked
                    </div>
                    <div style={{ height: 6, background: '#efe7d9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${(unlocked / Math.max(1, t.subs.length)) * 100}%`, height: '100%', background: '#1f4e75', borderRadius: 4 }} />
                    </div>
                    <div style={{ marginTop: 12, fontSize: 12.5, color: '#dd6a2f', fontWeight: 600 }}>Open topic →</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ============ FREE PLAY: subtopics for a topic ============ */}
      {s.screen === 'fptopic' &&
        (() => {
          const curT = fpGroups.find((t) => t.key === s.fpTopic) ?? fpGroups[0]
          if (!curT) return null
          return (
            <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
              <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px' }}>
                <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div onClick={() => setState({ screen: 'freeplay', fpTopic: null })} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>
                    ← All topics
                  </div>
                  <span style={{ marginLeft: 'auto', fontSize: 13, color: '#dbe6ef', fontFamily: FONT_SERIF }}>Free play</span>
                </div>
              </div>
              <div style={{ maxWidth: 720, margin: '0 auto', padding: '26px 24px 60px' }}>
                <div style={monoCap()}>Free play · subtopics</div>
                <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 25, margin: '6px 0 4px', color: '#0e2a43' }}>{curT.label}</h1>
                <p style={{ margin: '0 0 18px', fontSize: 13, lineHeight: 1.5, color: '#5c6773', maxWidth: 520, textWrap: 'pretty' }}>
                  Each subtopic with practice built has unlimited problems. Locked subtopics open once you've done their lesson on Home — free play never gives you a lesson you haven't reached yet.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {curT.subs.map((su) => {
                    const unlocked = su.unlocked
                    // Unlocked is the lesson gate; playable also needs questions to exist. The two
                    // used to be the same thing only because four subtopics were hand-listed with a
                    // topic behind them - across the whole curriculum most topics have no bank yet,
                    // and a "Free play →" button into an empty pool is worse than saying so.
                    const playable = unlocked && su.questions > 0
                    return (
                      <div
                        key={su.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: `1px solid ${unlocked ? '#d3e0ea' : '#e4dccb'}`, borderRadius: 11, padding: '15px 17px', opacity: unlocked ? 1 : 0.85 }}
                      >
                        <span style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: unlocked ? '#1f4e75' : '#cdbfa6' }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 600, color: '#1a2129' }}>{su.name}</div>
                          {unlocked ? (
                            <div style={{ fontSize: 12, color: '#8a7c63', marginTop: 2 }}>
                              Last studied: {su.last}
                              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: su.templated ? '#b6531f' : '#8a7c63', marginLeft: 8 }}>
                                {su.questions > 0
                                  ? `· ${su.templated ? 'unlimited questions' : `${su.questions} questions`}`
                                  : su.subtopics > 0
                                    ? `· ${su.subtopics} subtopics · no questions yet`
                                    : '· no questions yet'}
                              </span>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: '#a99e88', marginTop: 2 }}>
                              Lesson not done yet
                              {su.subtopics > 0 && (
                                <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#a99e88', marginLeft: 8 }}>· {su.subtopics} subtopics</span>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (playable) openFreePlay(su)
                          }}
                          style={{ marginLeft: 'auto', border: 'none', borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: playable ? 'pointer' : 'not-allowed', background: playable ? '#dd6a2f' : '#f2ece0', color: playable ? '#fff' : '#a99e88' }}
                        >
                          {playable ? 'Free play →' : unlocked ? 'Not built out yet' : '🔒 Do the lesson first'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}
    </>
  )
}
