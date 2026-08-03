import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FONT_MONO, FONT_SERIF } from '../theme'
import { PracticeLoop } from './PracticeLoop'
import type { AttemptResult } from './PracticeLoop'
import { TeachingCard } from './TeachingCard'
import { PreLessonBrief } from './PreLessonBrief'
import type { Lesson, LessonPrerequisite, NodeStatus, Question, TeachBlock, TopicId } from '../content'
import { lineTexts, questionsForSubtopic } from '../content'
import { routeFor } from '../data/routing'
import { MASTERY_PROMOTE_THRESHOLD } from '../data/engine'
import type { LogActivity, LogQuestion } from '../content'

/**
 * Lesson mechanic: [transfer in] -> teach a prerequisite -> check with a
 * question -> 2 consecutive correct masters it -> [transfer out] -> repeat.
 * Never ends the lesson for too many wrong answers - the business plan calls
 * this out by name as the one thing Math Academy does that Anadromos
 * explicitly will not. Instead, a per-prerequisite attempt cap auto-advances
 * (never blocks) and is honest about it in the summary rather than claiming
 * mastery it didn't see.
 *
 * Transfer in/out (optional per prerequisite, see the content store's
 * LessonPrerequisite type) are the plan's bookends on real understanding: a
 * real-world hook the student already believes, introduced before the
 * abstract rule, and a request for the student's own novel real-world
 * example once they've actually mastered it - "the single strongest
 * available test of whether real understanding, not pattern-matching,
 * occurred." Neither is scored; a prerequisite with neither authored skips
 * both phases silently.
 */
export interface LessonSessionProps {
  lesson: Lesson
  backLabel: string
  onExit: () => void
  /** Called once the whole lesson (all prerequisites) is done. */
  onComplete: (allMastered: boolean) => void
  /** Called on every individual PracticeLoop attempt within the lesson, right as it completes - in addition to (not instead of) this session's own advance/retry logic. */
  onAttempt?: (result: AttemptResult) => void
  /**
   * Fires once a student has just posted three consecutive attempts in this
   * lesson all marked "I got it all wrong" (`AttemptResult.flaggedLines ===
   * 'all'`) - the one gaming pattern ("repeatedly answering to skip a
   * diagnostic") this prototype's own mechanics can actually detect, per the
   * business plan. Scoped to the whole lesson (all prerequisites), not reset
   * when advancing between prerequisites - only a non-"all wrong" attempt
   * breaks the streak. Fires once per run of three, not on every attempt past it.
   */
  onGamingSignal?: () => void
  /**
   * Live per-topic mastery in [0,1] - the same foundations/core/stretch
   * tier average `data/engine.ts` already computes. Threaded into the teach
   * phase only (never the reteach cards inside PracticeLoop, which follow a
   * wrong answer and should stay fully scaffolded regardless of topic
   * mastery) to fade the worked example as demonstrated mastery rises, per
   * the plan's "scaffolding fades with rising mastery". Undefined (mastery
   * not available yet) always renders the fully-scaffolded version - never
   * a crash or a blank card. Also used on the summary screen (see
   * MASTERY_PROMOTE_THRESHOLD below) to caveat a "prerequisite covered"
   * result against a topic the engine doesn't yet call mastered.
   */
  masteryLevel?: number
  /** Fires once, when the lesson reaches its summary screen - lets the caller (StudentApp.tsx) record this as a real Sessions/Activity Log entry instead of it vanishing once the student leaves. */
  onSessionLogged?: (entry: LogActivity) => void
  /**
   * Per-topic status for this student, used only by the pre-lesson brief's
   * prerequisite checklist (build-plan §5.3). Omit to skip the brief entirely
   * and open straight into the lesson, which is what the teacher's preview and
   * any caller without a student context should do.
   */
  statusOf?: (topicId: TopicId) => NodeStatus
  /** When the student last worked this topic, e.g. '12 days ago'. Shown on the brief. */
  lastWorked?: string
}

const ATTEMPT_CAP = 4

type Phase = 'brief' | 'transferIn' | 'teach' | 'check' | 'transferOut' | 'summary'

interface PrerequisiteOutcome {
  prerequisiteId: string
  label: string
  mastered: boolean
}

interface LState {
  prerequisiteIdx: number
  phase: Phase
  streak: number
  attempts: number
  attemptSeq: number
  problemIdx: number
  retryActive: boolean
  outcomes: PrerequisiteOutcome[]
  /** Controlled draft for the transferOut textarea - reset whenever a new transferOut phase starts. */
  transferDraft: string
  /** Captured transfer-out responses, keyed by prerequisite id - not scored, just kept locally per the brief. */
  transferOutResponses: Record<string, string>
  /** Every check-phase attempt across the whole lesson, in order - accumulated purely to build the Sessions/Activity Log entry once the lesson reaches its summary, see buildLessonLogEntry below. Never trimmed mid-lesson (unlike streak/attempts, which reset per prerequisite). */
  attemptLog: { problem: Question; result: AttemptResult }[]
}

const startPhase = (prereq: LessonPrerequisite | undefined): Phase => (prereq?.transferIn ? 'transferIn' : 'teach')

function initialState(lesson: Lesson, showBrief: boolean): LState {
  return {
    prerequisiteIdx: 0,
    phase: showBrief ? 'brief' : startPhase(lesson.prerequisites[0]),
    streak: 0,
    attempts: 0,
    attemptSeq: 0,
    problemIdx: 0,
    retryActive: false,
    outcomes: [],
    transferDraft: '',
    transferOutResponses: {},
    attemptLog: [],
  }
}

/**
 * Turns one finished lesson's outcomes + attempt history into a real
 * Sessions/Activity Log entry (the content store's LogActivity) - see
 * onSessionLogged. A wrong attempt's `wrong`/`why` point at the question's
 * own authored errorLineIndex/line notes (the actual mistake) rather than
 * whatever lines the student self-flagged, same ground-truth-over-self-report
 * convention the rest of this app's diagnosis already follows.
 */
function buildLessonLogEntry(lesson: Lesson, st: LState): LogActivity {
  const masteredCount = st.outcomes.filter((o) => o.mastered).length
  const allMastered = masteredCount === st.outcomes.length && st.outcomes.length > 0
  const items: LogQuestion[] = st.attemptLog.map(({ problem, result }, i) => {
    const explanation = problem.lines[problem.errorLineIndex]?.note || 'See the worked steps above.'
    // Anything the student typed under "Something else - let me explain". It was
    // collected by PracticeLoop and read by nobody; the teacher opening this
    // entry is exactly who it was written for.
    const inTheirWords = Object.values(result.notes)
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
    return {
      label: `Q${i + 1}`,
      q: `${problem.prompt}: ${problem.statement}`,
      hit: !result.correct,
      note: result.correct ? 'Correct.' : explanation,
      work: result.correct ? undefined : lineTexts(problem),
      wrong: result.correct ? undefined : [problem.errorLineIndex],
      why: result.correct
        ? undefined
        : [explanation, ...inTheirWords.map((n) => `In their words: “${n}”`)],
    }
  })
  return {
    kind: 'Lesson',
    date: 'Today',
    title: lesson.topicLabel,
    result: `${masteredCount} of ${st.outcomes.length} prerequisites covered`,
    flag: allMastered ? 'ok' : 'attention',
    summary: allMastered
      ? 'Worked through cleanly; every prerequisite covered today.'
      : 'Moved on before every prerequisite fully clicked - the rest are first in the next review.',
    detail: st.outcomes.map((o) => `${o.label}: ${o.mastered ? 'covered today, two in a row' : "moved on after four tries - didn't land yet"}`),
    upload: st.attemptLog.some(({ result }) => !!result.attach),
    items,
  }
}

const monoCap = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '.8px',
  textTransform: 'uppercase',
  color: '#8a7c63',
  ...extra,
})

/** Cycles through a prerequisite's question pool - a small static pool repeating is an accepted simplification for a prototype, flagged rather than hidden. */
function questionFor(prereq: LessonPrerequisite, questionIdx: number): Question {
  const pool = questionsForSubtopic(prereq.subtopicId)
  return pool[questionIdx % pool.length]
}

function advanceFrom(lesson: Lesson, st: LState, mastered: boolean): LState {
  const prereq = lesson.prerequisites[st.prerequisiteIdx]
  const outcomes = [...st.outcomes, { prerequisiteId: prereq.id, label: prereq.label, mastered }]
  const nextIdx = st.prerequisiteIdx + 1
  if (nextIdx >= lesson.prerequisites.length) {
    return { ...st, phase: 'summary', outcomes }
  }
  return {
    ...st,
    prerequisiteIdx: nextIdx,
    phase: startPhase(lesson.prerequisites[nextIdx]),
    streak: 0,
    attempts: 0,
    attemptSeq: st.attemptSeq + 1,
    problemIdx: 0,
    retryActive: false,
    outcomes,
    transferDraft: '',
  }
}

// ---------------------------------------------------------------------------
// Scaffolding fade (teach phase only - see LessonSessionProps.masteryLevel)
// ---------------------------------------------------------------------------

/**
 * Below MASTERY_FADE_LOW: full worked example, as always. From there up to
 * MASTERY_FADE_HIGH: partially redacted - the middle step(s) replaced with
 * a fill-in-yourself placeholder. At/above MASTERY_FADE_HIGH: no worked
 * example at all, just the heading and body TeachingCard already renders.
 * Deliberately not finely calibrated - the plan only asks that guidance
 * visibly fade as demonstrated mastery rises, not for a precise curve.
 */
const MASTERY_FADE_LOW = 0.35
const MASTERY_FADE_HIGH = 0.7

const FILL_IN_PLACEHOLDER = '(you fill this in)'

/** Redacts everything between the first and last worked-example step behind a single fill-in-yourself placeholder. Every worked example in this prototype is short (2-4 lines); a 2-line example has no middle to redact, so it's returned unchanged. */
function redactMiddleSteps(steps: readonly string[]): readonly string[] {
  if (steps.length < 3) return steps
  return [steps[0], FILL_IN_PLACEHOLDER, steps[steps.length - 1]]
}

interface ScaffoldedExample {
  exampleTitle?: string
  exampleSteps?: readonly string[]
}

/** Chooses how much of the teach phase's worked example to show for the current mastery level - see the threshold comments above. */
function scaffoldExample(teach: TeachBlock, masteryLevel: number | undefined): ScaffoldedExample {
  if (masteryLevel === undefined || masteryLevel < MASTERY_FADE_LOW) {
    return { exampleTitle: teach.exampleTitle, exampleSteps: teach.exampleSteps }
  }
  if (masteryLevel < MASTERY_FADE_HIGH) {
    return { exampleTitle: teach.exampleTitle, exampleSteps: teach.exampleSteps ? redactMiddleSteps(teach.exampleSteps) : undefined }
  }
  return {}
}

export function LessonSession({ lesson, backLabel, onExit, onComplete, onAttempt, onGamingSignal, masteryLevel, onSessionLogged, statusOf, lastWorked }: LessonSessionProps) {
  const [s, setS] = useState<LState>(() => initialState(lesson, statusOf !== undefined))
  const prereq = lesson.prerequisites[s.prerequisiteIdx]
  const scaffolded = scaffoldExample(prereq.teach, masteryLevel)
  // Session-scoped (not per-prerequisite), plain mutable counter rather than state - it never
  // drives a render, only a side effect, so it deliberately sits outside setS/its updater
  // (which React's Strict Mode double-invokes in dev - a side effect in there would double-fire).
  const allWrongStreak = useRef(0)
  // Guards onSessionLogged against Strict Mode's double-invocation and against firing again on
  // any re-render that happens to still be in the 'summary' phase - see the effect below.
  const loggedRef = useRef(false)

  // Re-runs on every state change, same as any exhaustive-deps effect, but loggedRef (not the
  // dependency array) is what actually prevents a duplicate log entry on a later re-render
  // that's still in 'summary' - the guard clause below short-circuits every other case.
  useEffect(() => {
    if (s.phase !== 'summary' || loggedRef.current) return
    loggedRef.current = true
    onSessionLogged?.(buildLessonLogEntry(lesson, s))
  }, [s, lesson, onSessionLogged])

  const handleCheck = (result: AttemptResult) => {
    onAttempt?.(result)
    const attemptedProblem = questionFor(prereq, s.problemIdx)
    setS((st) => ({ ...st, attemptLog: [...st.attemptLog, { problem: attemptedProblem, result }] }))
    if (result.flaggedLines === 'all') {
      allWrongStreak.current += 1
      if (allWrongStreak.current === 3) onGamingSignal?.()
    } else {
      allWrongStreak.current = 0
    }
    setS((st) => {
      if (result.correct) {
        const streak = st.streak + 1
        if (streak >= 2) {
          const cur = lesson.prerequisites[st.prerequisiteIdx]
          if (cur.transferOut) return { ...st, phase: 'transferOut', transferDraft: '' }
          return advanceFrom(lesson, st, true)
        }
        return { ...st, streak, attempts: st.attempts + 1, attemptSeq: st.attemptSeq + 1, problemIdx: st.problemIdx + 1, retryActive: false }
      }
      const attempts = st.attempts + 1
      if (attempts >= ATTEMPT_CAP) return advanceFrom(lesson, st, false)
      const route = routeFor(result, st.retryActive)
      if (route === 'similarRetry') {
        return { ...st, streak: 0, attempts, attemptSeq: st.attemptSeq + 1, problemIdx: st.problemIdx + 1, retryActive: true }
      }
      // 'redoLesson' (hard / not-learned / "all wrong") and 'next' (slip)
      // both continue on the same prerequisite: jumping back to prerequisite 1 here
      // would itself be the frustrating thrash-loop this design avoids -
      // the re-teach-and-retry that already just happened *is* the response.
      return { ...st, streak: 0, attempts, attemptSeq: st.attemptSeq + 1, problemIdx: st.problemIdx + 1, retryActive: false }
    })
  }

  const continueTransferIn = () => setS((st) => ({ ...st, phase: 'teach' }))

  const continueTransferOut = () =>
    setS((st) => {
      const cur = lesson.prerequisites[st.prerequisiteIdx]
      const txt = st.transferDraft.trim()
      const transferOutResponses = txt ? { ...st.transferOutResponses, [cur.id]: txt } : st.transferOutResponses
      return advanceFrom(lesson, { ...st, transferOutResponses }, true)
    })

  // A restart replays the lesson itself, not the brief - the student has just
  // read it, and re-showing it would read as a gate rather than an orientation.
  const restart = () => setS(initialState(lesson, false))

  if (s.phase === 'brief' && statusOf) {
    return (
      <PreLessonBrief
        lesson={lesson}
        statusOf={statusOf}
        lastWorked={lastWorked}
        backLabel={backLabel}
        onExit={onExit}
        onStart={() => setS((st) => ({ ...st, phase: startPhase(lesson.prerequisites[0]) }))}
      />
    )
  }

  const topBar = (
    <div style={{ width: '100%', background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div onClick={onExit} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>{backLabel}</div>
      <span style={{ fontSize: 13, color: '#dbe6ef', marginLeft: 'auto', fontFamily: FONT_SERIF }}>{lesson.topicLabel}</span>
    </div>
  )

  if (s.phase === 'check') {
    return (
      <PracticeLoop
        key={`${prereq.id}-${s.problemIdx}-${s.attemptSeq}`}
        variant="student"
        problem={questionFor(prereq, s.problemIdx)}
        forceReason={s.retryActive ? 'notlearned' : undefined}
        mcq={s.retryActive}
        backLabel={backLabel}
        title={lesson.topicLabel}
        onExit={onExit}
        onComplete={handleCheck}
      />
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f6f1e7', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {topBar}
      <div style={{ width: '100%', maxWidth: 680, padding: '26px 24px 60px' }}>
        {s.phase === 'transferIn' && !!prereq.transferIn && (
          <>
            <div style={monoCap()}>
              Prerequisite {s.prerequisiteIdx + 1} of {lesson.prerequisites.length} · {lesson.topicLabel}
            </div>
            <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '26px 28px', marginTop: 12, boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}>
              <TeachingCard heading={prereq.transferIn.hook} body={prereq.transferIn.body} />
              <button
                onClick={continueTransferIn}
                style={{ marginTop: 18, width: '100%', background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 600, fontSize: 15, cursor: 'pointer' }}
              >
                Continue →
              </button>
            </div>
            <p style={{ margin: '16px 4px 0', fontSize: 12, color: '#a99e88', textAlign: 'center' }}>
              Something you already know, before the maths that formalises it.
            </p>
          </>
        )}

        {s.phase === 'teach' && (
          <>
            <div style={monoCap()}>
              Prerequisite {s.prerequisiteIdx + 1} of {lesson.prerequisites.length} · {lesson.topicLabel}
            </div>
            <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '26px 28px', marginTop: 12, boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}>
              <TeachingCard
                heading={prereq.teach.heading}
                body={prereq.teach.body}
                exampleTitle={scaffolded.exampleTitle}
                exampleSteps={scaffolded.exampleSteps}
              />
              <button
                onClick={() => setS((st) => ({ ...st, phase: 'check' }))}
                style={{ marginTop: 18, width: '100%', background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 600, fontSize: 15, cursor: 'pointer' }}
              >
                Try a question →
              </button>
            </div>
            <p style={{ margin: '16px 4px 0', fontSize: 12, color: '#a99e88', textAlign: 'center' }}>
              Two correct in a row moves you on. Getting one wrong just means another go - a lesson never ends because of it.
            </p>
          </>
        )}

        {s.phase === 'transferOut' && !!prereq.transferOut && (
          <>
            <div style={monoCap()}>
              Prerequisite {s.prerequisiteIdx + 1} of {lesson.prerequisites.length} · {lesson.topicLabel}
            </div>
            <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '26px 28px', marginTop: 12, boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}>
              <div style={{ background: '#faf6ee', border: '1px solid #e4dccb', borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0e2a43', marginBottom: 8, fontFamily: FONT_SERIF }}>
                  {prereq.transferOut.prompt}
                </div>
                <textarea
                  value={s.transferDraft}
                  onChange={(e) => setS((st) => ({ ...st, transferDraft: e.target.value }))}
                  placeholder={prereq.transferOut.placeholder ?? 'Describe your own example…'}
                  style={{ width: '100%', boxSizing: 'border-box', minHeight: 88, resize: 'vertical', border: '1px solid #d8cbb2', borderRadius: 9, padding: '12px 13px', fontSize: 14, color: '#1a2129', background: '#fff', lineHeight: 1.5 }}
                />
                <div style={{ fontSize: 11.5, color: '#8a7c63', margin: '8px 0 0', textWrap: 'pretty' }}>
                  Not marked or scored - just for you, to check the idea has actually clicked.
                </div>
              </div>
              <button
                onClick={continueTransferOut}
                style={{ marginTop: 18, width: '100%', background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 600, fontSize: 15, cursor: 'pointer' }}
              >
                Continue →
              </button>
            </div>
            <p style={{ margin: '16px 4px 0', fontSize: 12, color: '#a99e88', textAlign: 'center' }}>
              Your own example - the best sign the idea is really yours now.
            </p>
          </>
        )}

        {s.phase === 'summary' && (
          <>
            <div style={monoCap()}>Lesson complete · {lesson.topicLabel}</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontSize: 24, fontWeight: 600, color: '#0e2a43', margin: '8px 0 4px' }}>
              {s.outcomes.filter((o) => o.mastered).length} of {s.outcomes.length} prerequisites covered
            </h1>
            <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {s.outcomes.map((o) => (
                <div key={o.prerequisiteId} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span style={{ color: o.mastered ? '#1f4e75' : '#dd6a2f', flex: 'none' }}>{o.mastered ? '✓' : '·'}</span>
                  <div style={{ fontSize: 13.5, color: '#1a2129', lineHeight: 1.5 }}>
                    {o.label}
                    {!o.mastered && (
                      <span style={{ color: '#8a7c63', fontWeight: 400 }}> - we moved on before this one fully clicked; it's first in your next review.</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {masteryLevel !== undefined && masteryLevel < MASTERY_PROMOTE_THRESHOLD && s.outcomes.some((o) => o.mastered) && (
              <div style={{ marginTop: 14, background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1f4e75', marginTop: 5, flex: 'none' }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#2b4a63', textWrap: 'pretty' }}>
                  "Covered" means today's two-in-a-row landed. Your knowledge map is more cautious about {lesson.topicLabel}: it only marks a topic mastered once that holds up across harder questions and repeat reviews, not just one good pass - so don't be surprised if the map doesn't turn blue yet.
                </div>
              </div>
            )}
            <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => onComplete(s.outcomes.every((o) => o.mastered))}
                style={{ flex: 1, background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}
              >
                Continue your path →
              </button>
              {s.outcomes.some((o) => !o.mastered) && (
                <button
                  onClick={restart}
                  style={{ background: '#fff', color: '#0e2a43', border: '1.5px dashed #b9a888', borderRadius: 10, padding: '13px 18px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}
                >
                  Go through it again now →
                </button>
              )}
            </div>
            <p style={{ margin: '18px 4px 0', fontSize: 11.5, color: '#a99e88', lineHeight: 1.5, textAlign: 'center' }}>
              No streaks, points, or class rankings - just your own progress.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
