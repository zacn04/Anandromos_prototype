import { useRef, useState } from 'react'
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
import { BASKETS, EDGES, NODES, ST, edgePath } from '../data/knowledgeGraph'
import type { EngineNodeState, EngineState, MasteryTier } from '../data/engine'
import { initEngineState, recordAttempt } from '../data/engine'
import { LOG_RAW } from '../data/activityLog'
import { LESSONS } from '../data/lessons'
import { problemById, problemsForTopic } from '../data/problems'
import { topicLabel } from '../data/curriculum'
import { getProblemSets } from '../data/teacherProblemSets'
import type { AuthoredQuestion } from '../data/teacherProblemSets'
import { pushLiveFlag } from '../data/liveOversight'
import { getLiveSessions, pushLiveSession } from '../data/liveSessions'
import { FONT_MONO, FONT_SERIF } from '../theme'

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
   * Indices into PATH_RAW that have actually been completed, in whatever
   * order they were done - not just a "how far in order" cursor, since
   * "Speed through lessons" (see speedMode) makes out-of-order completion
   * reachable. `pathPrefixDone()` derives the old-style "N of 6 done"
   * sequential count from this whenever that's what's wanted.
   */
  pathCompleted: number[]
  /** "Speed through lessons" toggle (Home, near "Your path") - see isPathItemLocked(). */
  speedMode: boolean
  fpTopic: string | null
  fpLabel: string | null
  fpProblemIdx: number
  practiceMode: PracticeMode | null
  practiceTopic: string | null
  /** Which PATH_RAW index is in progress, so its completion callback knows what to mark done. */
  activePathIdx: number | null
  /** Which teacher-authored problem set (data/teacherProblemSets.ts) is open in `psolve`; null means the static PS_SET demo set. */
  activePsId: string | null
  psIdx: number
  psAnswers: Record<number, string>
  psSubmitted: boolean
  psAttach: string | null
  selectedLog: number | null
  selectedNode: string | null
  graphFilter: string
}

/** PATH_RAW / Free-play subtopic label -> problems.ts topic key. Only topics with an authored problem bank are listed; everything else gets an honest "not built out yet" placeholder rather than mismatched content. */
const PATH_TOPIC_KEY: Record<string, string> = {
  'Inverse operations': 'linear',
  'One-step equations': 'linear',
  'Two-step equations': 'linear',
  'Equations with brackets': 'linear',
  'Fractions → %': 'fracpct',
}
const FREEPLAY_TOPIC_KEY: Record<string, string> = {
  Substitution: 'substitution',
}

/**
 * problems.ts topic key -> knowledgeGraph.ts node id, so recording an
 * attempt knows which map node to update. Cross-checked against NODES'
 * labels: n11 'Linear equations' (linear), n9 'Substitution'
 * (substitution), n6 'Fractions → %' (fracpct) - the only three topics with
 * a real problem bank, matching PATH_TOPIC_KEY/FREEPLAY_TOPIC_KEY above.
 */
const TOPIC_TO_NODE_ID: Record<string, string> = {
  linear: 'n11',
  substitution: 'n9',
  fracpct: 'n6',
}

/** Defensive fallback for a node id the live engine hasn't seeded - shouldn't happen, since initEngineState seeds all 15 ids from the same static map this app always showed, but cheaper and more honest than a crash if a new node id is ever added to knowledgeGraph.ts without a matching status entry. */
const FALLBACK_NODE_STATE: EngineNodeState = { status: 'notready', last: '—', next: 'when ready', reps: 0 }

/**
 * Free-play subtopic label -> topic key, for the subset of FP_TOPICS whose
 * `unlocked` flag should read live off the engine instead of the static
 * sample data: Substitution (has a problem bank) and Linear equations
 * (topicLabel('linear') - the only topic with a real Lesson, so the only
 * other one worth a live "not just notready/locked" unlock signal). Every
 * other Free-play label has no problem bank behind it and is left exactly
 * as the static sample data has it - see FREEPLAY_TOPIC_KEY's comment.
 */
const FP_LIVE_UNLOCK_TOPIC_KEY: Record<string, string> = {
  Substitution: 'substitution',
  'Linear equations': 'linear',
}

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

const PATH_RAW = [
  { kind: 'Lesson', subtopic: 'Inverse operations', detail: 'Moving a term across the =' },
  { kind: 'Lesson', subtopic: 'One-step equations', detail: 'Undoing + and −' },
  { kind: 'Review', subtopic: 'Negatives', detail: 'Spaced review' },
  { kind: 'Lesson', subtopic: 'Two-step equations', detail: 'Undo in the right order' },
  { kind: 'Review', subtopic: 'Fractions → %', detail: 'Spaced review' },
  { kind: 'Lesson', subtopic: 'Equations with brackets', detail: 'Expand, then solve' },
]

const PROBLEM_SETS = [
  {
    title: 'Linear equations mixed set',
    topics: 'Linear equations · Substitution',
    qs: '12 questions',
    due: 'Due Mon 21 Jul',
    urgency: 'soon',
    locked: true,
    lockNote: 'Unlocks when you finish “Inverse operations” and “Two-step equations”.',
  },
  {
    title: 'Fractions & percentages',
    topics: 'Fractions · Percentages',
    qs: '10 questions',
    due: 'Due Fri 25 Jul',
    urgency: 'later',
    locked: false,
    lockNote: '',
  },
  {
    title: 'Ratio recap',
    topics: 'Ratio & proportion',
    qs: '8 questions',
    due: 'Due today',
    urgency: 'urgent',
    locked: true,
    lockNote: 'Unlocks when you finish “Ratio basics”.',
  },
]

const PS_SET = {
  title: 'Fractions & percentages',
  topics: 'Fractions · Percentages',
  due: 'Due Fri 25 Jul',
  questions: [
    { topic: 'Fractions', q: 'Simplify 12⁄18 to its lowest terms.', hint: 'Divide top and bottom by their highest common factor.' },
    { topic: 'Fractions', q: 'Work out 2⁄3 + 1⁄6.', hint: 'Use a common denominator first.' },
    { topic: 'Percentages', q: 'Find 15% of 240.', hint: '' },
    { topic: 'Percentages', q: 'Write 0.45 as a percentage.', hint: '' },
    { topic: 'Fractions → %', q: 'Write 3⁄8 as a percentage.', hint: 'Divide, then multiply by 100.' },
    { topic: 'Percentages', q: 'A £60 coat is reduced by 20%. What is the new price?', hint: '' },
  ],
}

const FP_TOPICS = [
  {
    key: 'number',
    label: 'Number',
    subs: [
      { name: 'Negatives', unlocked: true, last: 'today · free play' },
      { name: 'Fractions', unlocked: true, last: '12 days ago' },
      { name: 'Decimals', unlocked: true, last: '15 days ago' },
      { name: 'Percentages', unlocked: false, last: '' },
    ],
  },
  {
    key: 'algebra',
    label: 'Algebra',
    subs: [
      { name: 'Algebra basics', unlocked: true, last: '8 days ago' },
      { name: 'Inverse operations', unlocked: true, last: 'today' },
      { name: 'One-step equations', unlocked: true, last: 'today' },
      { name: 'Substitution', unlocked: true, last: '2 days ago · free play' },
      { name: 'Linear equations', unlocked: false, last: '' },
      { name: 'Expanding brackets', unlocked: false, last: '' },
    ],
  },
  {
    key: 'ratio',
    label: 'Ratio & proportion',
    subs: [
      { name: 'Ratio', unlocked: true, last: '7 days ago' },
      { name: 'Proportion', unlocked: true, last: '10 days ago' },
      { name: 'Percentage change', unlocked: false, last: '' },
    ],
  },
  {
    key: 'geometry',
    label: 'Geometry & measures',
    subs: [
      { name: 'Area & perimeter', unlocked: true, last: '20 days ago' },
      { name: 'Angles', unlocked: false, last: '' },
      { name: 'Coordinates', unlocked: false, last: '' },
    ],
  },
  {
    key: 'stats',
    label: 'Statistics',
    subs: [
      { name: 'Averages', unlocked: true, last: '18 days ago' },
      { name: 'Charts & tables', unlocked: false, last: '' },
    ],
  },
  {
    key: 'probability',
    label: 'Probability',
    subs: [{ name: 'Basic probability', unlocked: false, last: '' }],
  },
]

/**
 * PROGRESS_TOPICS' name -> problems.ts/curriculum topic key, wired up only
 * because the match to a live masteryByTopic entry is clean and exact here
 * - all four names below match a studentProfiles.ts mastery row verbatim,
 * which is itself how initEngineState seeds masteryByTopic. Not a
 * general-purpose alias table - if PROGRESS_TOPICS ever grows a row without
 * an equally clean match, leave it out rather than guessing.
 */
const PROGRESS_TOPIC_KEY: Record<string, string> = {
  Negatives: 'negatives',
  'Fractions & %': 'fracpct',
  Substitution: 'substitution',
  'Linear equations': 'linear',
}

const PROGRESS_TOPICS = [
  { name: 'Negatives', pct: 96, label: 'Mastered' },
  { name: 'Fractions & %', pct: 78, label: 'Strong' },
  { name: 'Substitution', pct: 52, label: 'Building' },
  { name: 'Linear equations', pct: 34, label: 'Learning now' },
]

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
  pathCompleted: [0, 1],
  speedMode: false,
  fpTopic: null,
  fpLabel: null,
  fpProblemIdx: 0,
  practiceMode: null,
  practiceTopic: null,
  activePathIdx: null,
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
  const [s, setS] = useState<StudentState>(INITIAL)
  const psFileRef = useRef<HTMLInputElement>(null)
  const setState = (patch: Partial<StudentState> | ((st: StudentState) => Partial<StudentState>)) =>
    setS((st) => ({ ...st, ...(typeof patch === 'function' ? patch(st) : patch) }))

  // Live computed mastery (data/engine.ts) - seeded once from exactly the same static
  // overlays every POV already shows for this student, then moved forward only by real
  // recordAttempt calls as Aisha actually practises.
  const [engine, setEngine] = useState<EngineState>(() => initEngineState(STUDENT_ID))
  const engineNode = (nodeId: string): EngineNodeState => engine.nodes[nodeId] ?? FALLBACK_NODE_STATE

  /**
   * Records one real attempt on the live engine. Difficulty comes from the
   * problem bank (falls back to 'core' if a problem id somehow isn't
   * found); weak is always false here - this is all confident practice
   * attempts from PracticeLoop/LessonSession/ReviewSession. weak is for
   * the diagnostic test's guesses instead (recordDiagnosticAttempt below).
   * No-ops for a topic with no knowledge-graph node behind it (nothing
   * outside TOPIC_TO_NODE_ID's three topics currently reaches this).
   */
  const recordTopicAttempt = (topic: string, result: AttemptResult) => {
    const nodeId = TOPIC_TO_NODE_ID[topic]
    if (!nodeId) return
    const difficulty: MasteryTier = problemById(result.problemId)?.difficulty ?? 'core'
    setEngine((prev) => recordAttempt(prev, { nodeId, topic, difficulty, correct: result.correct, weak: false }))
  }

  /**
   * Records one diagnostic-test answer on the live engine - same
   * TOPIC_TO_NODE_ID mapping, same problemById difficulty lookup, and the
   * same setEngine(recordAttempt(...)) call as recordTopicAttempt above,
   * just with `weak` and `correct` passed straight through instead of
   * hardcoded, since DiagnosticTest's onAnswer already computed them (see
   * that component: "I guessed" always passes correct: false, weak: true;
   * "I don't know" never calls onAnswer at all, so never reaches here).
   */
  const recordDiagnosticAttempt = (topic: string, problemId: string, correct: boolean, weak: boolean) => {
    const nodeId = TOPIC_TO_NODE_ID[topic]
    if (!nodeId) return
    const difficulty: MasteryTier = problemById(problemId)?.difficulty ?? 'core'
    setEngine((prev) => recordAttempt(prev, { nodeId, topic, difficulty, correct, weak }))
  }

  /**
   * LessonSession/ReviewSession's onGamingSignal - fires once three
   * consecutive attempts in one session were all marked "I got it all
   * wrong". Builds a live Oversight card (data/liveOversight.ts) styled the
   * same as the static gaming-pattern sample in data/oversight.ts, honest
   * about what was actually observed rather than inventing per-line detail
   * this app doesn't have for a live-detected pattern.
   */
  const reportGamingSignal = (topic: string, sessionKind: 'Lesson' | 'Review') => {
    const subtopic = topicLabel(topic)
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
  const masteryLevelFor = (topic: string): number | undefined => {
    const tier = engine.masteryByTopic[topic]
    return tier ? (tier.foundations + tier.core + tier.stretch) / 3 : undefined
  }

  /** Live unlock for the handful of Free-play subtopics with a topic mapping (see FP_LIVE_UNLOCK_TOPIC_KEY); everything else keeps its static sample-data flag untouched. */
  const isSubUnlocked = (su: { name: string; unlocked: boolean }): boolean => {
    const topicKey = FP_LIVE_UNLOCK_TOPIC_KEY[su.name]
    const nodeId = topicKey ? TOPIC_TO_NODE_ID[topicKey] : undefined
    if (!nodeId) return su.unlocked
    const status = engineNode(nodeId).status
    return status !== 'notready' && status !== 'locked'
  }

  /** Live mastery % for the handful of Progress rows with a clean topic mapping (see PROGRESS_TOPIC_KEY); falls back to the static sample pct otherwise. */
  const progressPct = (t: { name: string; pct: number }): number => {
    const key = PROGRESS_TOPIC_KEY[t.name]
    const tier = key ? engine.masteryByTopic[key] : undefined
    return tier ? Math.round(((tier.foundations + tier.core + tier.stretch) / 3) * 100) : t.pct
  }

  const openPathItem = (i: number) => {
    const it = PATH_RAW[i]
    const topicKey = PATH_TOPIC_KEY[it.subtopic]
    const mode: PracticeMode = !topicKey ? 'unavailable' : it.kind === 'Review' ? 'review' : 'lesson'
    setState({
      screen: 'practice',
      activePathIdx: i,
      practiceMode: mode,
      practiceTopic: topicKey ?? null,
      fpLabel: null,
    })
  }

  const openFreePlay = (subtopicName: string) => {
    const topicKey = FREEPLAY_TOPIC_KEY[subtopicName]
    setState({
      screen: 'practice',
      activePathIdx: null,
      practiceMode: topicKey ? 'freeplay' : 'unavailable',
      practiceTopic: topicKey ?? null,
      fpLabel: subtopicName,
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
      pathCompleted: st.activePathIdx !== null && !st.pathCompleted.includes(st.activePathIdx)
        ? [...st.pathCompleted, st.activePathIdx]
        : st.pathCompleted,
      activePathIdx: null,
      practiceMode: null,
      practiceTopic: null,
    }))

  /** The old-style "N of 6 done" sequential count: the length of the unbroken done-prefix from index 0, so speed-running a later item never inflates this past the earliest still-undone one. */
  const pathPrefixDone = (completed: number[]): number => {
    let n = 0
    while (completed.includes(n)) n++
    return n
  }

  /**
   * A PATH_RAW Review counts as a gate only if it actually has content behind
   * it (see PATH_TOPIC_KEY) - a Review with none (e.g. 'Negatives', which has
   * no problem bank) can never be completed through openPathItem/completePathItem,
   * so treating it as a gate would permanently lock every item after it with
   * no way out short of Speed mode. Lessons never gate at all, matching
   * isPathItemLocked's original contract.
   */
  const isGatingReview = (it: { kind: string; subtopic: string }): boolean =>
    it.kind === 'Review' && !!PATH_TOPIC_KEY[it.subtopic]

  /**
   * True when an earlier PATH_RAW item is a (completable) Review that hasn't
   * been done yet - Reviews are the only gate (Lessons never block each other
   * or get blocked by an earlier Lesson), matching Appendix A: "freedom to
   * speed through lessons" but progress "capped" until reviews are done.
   * Speed mode lifts the gate entirely; the honest "N reviews pending"
   * indicator (see pendingReviews below) is what keeps that from silently
   * reading as full completion once it's lifted.
   */
  const isPathItemLocked = (i: number): boolean =>
    !s.speedMode && PATH_RAW.some((it, j) => j < i && isGatingReview(it) && !s.pathCompleted.includes(j))

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
  const highestPathCompletedIdx = s.pathCompleted.length ? Math.max(...s.pathCompleted) : -1
  const pendingReviews = PATH_RAW.filter(
    (it, i) => isGatingReview(it) && i < highestPathCompletedIdx && !s.pathCompleted.includes(i),
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
        activePathIdx: null,
        practiceMode: null,
        practiceTopic: null,
      })

    if (s.practiceMode === 'lesson' && s.practiceTopic && LESSONS[s.practiceTopic]) {
      const topic = s.practiceTopic
      return (
        <LessonSession
          lesson={LESSONS[topic]}
          backLabel="← Home"
          onExit={exitPractice}
          onComplete={completePathItem}
          onAttempt={(result) => recordTopicAttempt(topic, result)}
          onGamingSignal={() => reportGamingSignal(topic, 'Lesson')}
          masteryLevel={masteryLevelFor(topic)}
          onSessionLogged={pushLiveSession}
        />
      )
    }

    if (s.practiceMode === 'review' && s.practiceTopic) {
      const topic = s.practiceTopic
      const lesson = LESSONS[topic]
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
          onSessionLogged={pushLiveSession}
        />
      )
    }

    if (s.practiceMode === 'freeplay' && s.practiceTopic) {
      const topic = s.practiceTopic
      const pool = problemsForTopic(topic)
      const problem = pool[s.fpProblemIdx % pool.length]
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

    // practiceMode === 'unavailable' - honest placeholder rather than mismatched content
    const unavailableLabel = s.fpLabel || (s.activePathIdx != null ? PATH_RAW[s.activePathIdx].subtopic : 'this subtopic')
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
  const graphNodes = NODES.map((n) => {
    const st = ST[engineNode(n.id).status]
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
  const graphEdges = EDGES.map(([a, b]) => {
    const frontier = engineNode(b).status === 'frontier'
    return { d: edgePath(a, b), stroke: frontier ? '#e8a06a' : '#d3c6ab', sw: frontier ? 2 : 1.4 }
  })
  const gf = s.graphFilter
  const activeBasket = gf === 'all' ? null : BASKETS.find((b) => b.key === gf)
  const inFocus = (id: string) => !activeBasket || activeBasket.ids.indexOf(id) > -1
  const focusedNodes = graphNodes.map((n) => ({ ...n, op: inFocus(n.id) ? 1 : 0.14 }))
  const focusedEdges = graphEdges.map((e, idx) => {
    const [a, b] = EDGES[idx]
    return { ...e, op: inFocus(a) && inFocus(b) ? 1 : 0.1 }
  })
  const selNode = s.selectedNode ? NODES.find((n) => n.id === s.selectedNode) : null

  // ---- problem set (homework) ----
  // Teacher-authored sets (data/teacherProblemSets.ts) alongside the static PS_SET/PROBLEM_SETS
  // demo data - see that module's comment for the cross-route caveat. activePsId is null for the
  // static demo set (PS_SET) and an authored set's id once one of its cards is opened.
  const authoredSets = getProblemSets()
  const activeAuthoredSet = s.activePsId ? authoredSets.find((p) => p.id === s.activePsId) : undefined
  const curPS: { title: string; topics: string; due: string; questions: AuthoredQuestion[]; requireHandwriting?: boolean } = activeAuthoredSet ?? PS_SET
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
  // and TeacherApp.tsx's ovList. selectedLog indexes into this combined list, not LOG_RAW alone.
  const allSessions = [...getLiveSessions(), ...LOG_RAW]
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
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{pathPrefixDone(s.pathCompleted)} of 6 done</span>
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
              {PATH_RAW.map((it, i) => {
                const complete = s.pathCompleted.includes(i)
                const locked = isPathItemLocked(i)
                const isNext = !complete && i === pathPrefixDone(s.pathCompleted)
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
            {s.pathCompleted.length >= 6 && (
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
                {PROBLEM_SETS.map((p) => (
                  <div key={p.title} style={{ background: '#fff', border: `1px solid ${p.locked ? '#e4dccb' : '#d3e0ea'}`, borderRadius: 12, padding: '16px 18px', opacity: p.locked ? 0.92 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2129' }}>{p.title}</div>
                        <div style={{ fontSize: 12.5, color: '#8a7c63', marginTop: 3 }}>
                          {p.topics} · {p.qs}
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
                        if (!p.locked) setState({ screen: 'psolve', psIdx: 0, psAnswers: {}, psSubmitted: false, activePsId: null })
                      }}
                      style={{ marginTop: 12, background: p.locked ? '#f2ece0' : '#dd6a2f', color: p.locked ? '#a99e88' : '#fff', border: 'none', borderRadius: 9, padding: '11px 16px', fontSize: 13.5, fontWeight: 600, cursor: p.locked ? 'not-allowed' : 'pointer' }}
                    >
                      {p.locked ? '🔒 Locked' : 'Start homework →'}
                    </button>
                  </div>
                ))}
                {/* Teacher-authored sets (data/teacherProblemSets.ts) - always unlocked, since this
                    prototype's authoring form has no prerequisite/lock concept of its own. */}
                {authoredSets.map((t) => (
                  <div key={t.id} style={{ background: '#fff', border: '1px solid #d3e0ea', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2129' }}>{t.title}</div>
                        <div style={{ fontSize: 12.5, color: '#8a7c63', marginTop: 3 }}>
                          {t.topics} · {t.questions.length} question{t.questions.length === 1 ? '' : 's'}
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
                          background: '#eef3f7',
                          color: '#1f4e75',
                          border: '1px solid #d3e0ea',
                        }}
                      >
                        🗓 {t.due}
                      </span>
                    </div>
                    <button
                      onClick={() => setState({ screen: 'psolve', psIdx: 0, psAnswers: {}, psSubmitted: false, activePsId: t.id })}
                      style={{ marginTop: 12, background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Start homework →
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

            <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px' }}>
              <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 16px', color: '#0e2a43' }}>What you've built up</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {PROGRESS_TOPICS.map((t) => {
                  const pct = progressPct(t)
                  return (
                    <div key={t.name}>
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
              <div style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 600, color: '#0e2a43', margin: '6px 0 4px' }}>Linear equations</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#8a6b4f', textWrap: 'pretty' }}>
                You're most of the way through the ideas this builds on. Keep going, it gets less hand-held as you get stronger.
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
                  {[{ key: 'all', label: 'All basket topics' }, ...BASKETS.map((b) => ({ key: b.key, label: b.label }))].map((c) => (
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
              {FP_TOPICS.map((t) => {
                const unlocked = t.subs.filter(isSubUnlocked).length
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
                      <div style={{ width: `${(unlocked / t.subs.length) * 100}%`, height: '100%', background: '#1f4e75', borderRadius: 4 }} />
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
          const curT = FP_TOPICS.find((t) => t.key === s.fpTopic) || FP_TOPICS[0]
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
                  Each subtopic has unlimited practice problems. Locked subtopics open once you've done their lesson on Home — free play never gives you a lesson you haven't reached yet.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {curT.subs.map((su) => {
                    const unlocked = isSubUnlocked(su)
                    return (
                      <div
                        key={su.name}
                        style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: `1px solid ${unlocked ? '#d3e0ea' : '#e4dccb'}`, borderRadius: 11, padding: '15px 17px', opacity: unlocked ? 1 : 0.85 }}
                      >
                        <span style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: unlocked ? '#1f4e75' : '#cdbfa6' }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 600, color: '#1a2129' }}>{su.name}</div>
                          {unlocked ? (
                            <div style={{ fontSize: 12, color: '#8a7c63', marginTop: 2 }}>Last studied: {su.last}</div>
                          ) : (
                            <div style={{ fontSize: 12, color: '#a99e88', marginTop: 2 }}>Lesson not done yet</div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (unlocked) openFreePlay(su.name)
                          }}
                          style={{ marginLeft: 'auto', border: 'none', borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: unlocked ? 'pointer' : 'not-allowed', background: unlocked ? '#dd6a2f' : '#f2ece0', color: unlocked ? '#fff' : '#a99e88' }}
                        >
                          {unlocked ? 'Free play →' : '🔒 Do the lesson first'}
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
