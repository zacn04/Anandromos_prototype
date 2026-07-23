import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FONT_MONO, FONT_SERIF } from '../theme'
import { PracticeLoop } from './PracticeLoop'
import type { AttemptResult } from './PracticeLoop'
import type { Problem } from '../data/problems'
import { problemsForTopic, similarProblem } from '../data/problems'
import { routeFor } from '../data/routing'
import type { LogActivity, LogQuestion } from '../data/activityLog'

/**
 * Review mechanic: up to 5 questions, first 3 correct auto-passes, 3 wrong
 * auto-fails - both thresholds are guaranteed to trigger by question 5
 * (pigeonhole: correct <= 2 and wrong <= 2 implies at most 4 questions), so
 * there's no "ran out of questions" case to design for.
 */
export interface ReviewSessionProps {
  topic: string
  subtopicLabel: string
  backLabel: string
  onExit: () => void
  onComplete: (passed: boolean) => void
  /** Present only when this topic has a Lesson defined - lets a failed/flagged review route straight to it. */
  onGoToLesson?: () => void
  /** Called on every individual PracticeLoop attempt within the review, right as it completes - in addition to (not instead of) this session's own pass/fail bookkeeping. */
  onAttempt?: (result: AttemptResult) => void
  /**
   * Fires once a student has just posted three consecutive attempts in this
   * review all marked "I got it all wrong" (`AttemptResult.flaggedLines ===
   * 'all'`) - the one gaming pattern ("repeatedly answering to skip a
   * diagnostic") this prototype's own mechanics can actually detect, per the
   * business plan. Fires once per run of three, not on every attempt past it.
   */
  onGamingSignal?: () => void
  /** Fires once, when the review reaches a pass/fail outcome - lets the caller (StudentApp.tsx) record this as a real Sessions/Activity Log entry instead of it vanishing once the student leaves. */
  onSessionLogged?: (entry: LogActivity) => void
}

type Outcome = 'inprogress' | 'passed' | 'failed'

interface RState {
  qIdx: number
  correct: number
  wrong: number
  attemptSeq: number
  retryActive: boolean
  lastProblemId: string | null
  redoFlagged: boolean
  outcome: Outcome
  /** Every attempt across the whole review, in order - accumulated purely to build the Sessions/Activity Log entry once the review reaches an outcome, see buildReviewLogEntry below. */
  attemptLog: { problem: Problem; result: AttemptResult }[]
}

const INITIAL: RState = {
  qIdx: 0,
  correct: 0,
  wrong: 0,
  attemptSeq: 0,
  retryActive: false,
  lastProblemId: null,
  redoFlagged: false,
  outcome: 'inprogress',
  attemptLog: [],
}

/**
 * Turns one finished review's counters + attempt history into a real
 * Sessions/Activity Log entry (data/activityLog.ts's LogActivity). A wrong
 * attempt's `wrong`/`why` point at the problem's own authored
 * errIdx/solNotes (the actual mistake) rather than whatever lines the
 * student self-flagged - same ground-truth-over-self-report convention the
 * rest of this app's diagnosis already follows.
 */
function buildReviewLogEntry(subtopicLabel: string, st: RState): LogActivity {
  const passed = st.outcome === 'passed'
  const items: LogQuestion[] = st.attemptLog.map(({ problem, result }, i) => {
    const explanation = problem.solNotes[problem.errIdx] || 'See the worked steps above.'
    return {
      label: `Q${i + 1}`,
      q: `${problem.prompt}: ${problem.statement}`,
      hit: !result.correct,
      note: result.correct ? 'Correct.' : explanation,
      work: result.correct ? undefined : problem.lines,
      wrong: result.correct ? undefined : [problem.errIdx],
      why: result.correct ? undefined : [explanation],
    }
  })
  return {
    kind: 'Review',
    date: 'Today',
    title: `${subtopicLabel} · review`,
    result: `${st.correct} of ${st.correct + st.wrong} correct`,
    flag: passed ? 'ok' : 'attention',
    summary: passed
      ? 'Three right settled it before the rest were needed.'
      : "Three missed - routed back to the lesson before the next review.",
    detail: [
      `${st.correct} of ${st.correct + st.wrong} correct this session.`,
      ...(st.redoFlagged ? ['At least one answer looked like it needed more than a quick review.'] : []),
    ],
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

export function ReviewSession({ topic, subtopicLabel, backLabel, onExit, onComplete, onGoToLesson, onAttempt, onGamingSignal, onSessionLogged }: ReviewSessionProps) {
  const [s, setS] = useState<RState>(INITIAL)
  const pool = problemsForTopic(topic)
  // Plain mutable counter, not state - see the matching comment in LessonSession.tsx for why
  // this deliberately sits outside setS's updater.
  const allWrongStreak = useRef(0)
  // Guards onSessionLogged against Strict Mode's double-invocation and against firing again on
  // any re-render that happens to still have a resolved outcome - see the effect below.
  const loggedRef = useRef(false)

  const currentProblem: Problem =
    (s.retryActive && s.lastProblemId && similarProblem(s.lastProblemId)) || pool[Math.min(s.qIdx, pool.length - 1)]

  // Re-runs on every state change, same as any exhaustive-deps effect, but loggedRef (not the
  // dependency array) is what actually prevents a duplicate log entry on a later re-render
  // that's still resolved - the guard clause below short-circuits every other case.
  useEffect(() => {
    if (s.outcome === 'inprogress' || loggedRef.current) return
    loggedRef.current = true
    onSessionLogged?.(buildReviewLogEntry(subtopicLabel, s))
  }, [s, subtopicLabel, onSessionLogged])

  const handleAnswer = (result: AttemptResult) => {
    onAttempt?.(result)
    setS((st) => ({ ...st, attemptLog: [...st.attemptLog, { problem: currentProblem, result }] }))
    if (result.flaggedLines === 'all') {
      allWrongStreak.current += 1
      if (allWrongStreak.current === 3) onGamingSignal?.()
    } else {
      allWrongStreak.current = 0
    }
    setS((st) => {
      const route = routeFor(result, st.retryActive)
      const redoFlagged = st.redoFlagged || route === 'redoLesson'
      const correct = st.correct + (result.correct ? 1 : 0)
      const wrong = st.wrong + (result.correct ? 0 : 1)
      // Not reachable at qIdx 5 in practice (3-of-3-of-5 pigeonholes a decision by question 4),
      // kept as a real branch rather than assumed so a content change can't silently break it.
      if (correct >= 3) return { ...st, correct, wrong, outcome: 'passed', redoFlagged, lastProblemId: result.problemId }
      if (wrong >= 3) return { ...st, correct, wrong, outcome: 'failed', redoFlagged, lastProblemId: result.problemId }
      return {
        ...st,
        correct,
        wrong,
        qIdx: st.qIdx + 1,
        attemptSeq: st.attemptSeq + 1,
        retryActive: route === 'similarRetry',
        redoFlagged,
        lastProblemId: result.problemId,
      }
    })
  }

  if (s.outcome === 'inprogress') {
    return (
      <PracticeLoop
        key={`${currentProblem.id}-${s.attemptSeq}`}
        variant="student"
        problem={currentProblem}
        forceReason={s.retryActive ? 'notlearned' : undefined}
        mcq={s.retryActive}
        backLabel={backLabel}
        title={`${subtopicLabel} · review`}
        onExit={onExit}
        onComplete={handleAnswer}
      />
    )
  }

  const passed = s.outcome === 'passed'

  return (
    <div style={{ minHeight: '100vh', background: '#f6f1e7', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div onClick={onExit} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>{backLabel}</div>
        <span style={{ fontSize: 13, color: '#dbe6ef', marginLeft: 'auto', fontFamily: FONT_SERIF }}>{subtopicLabel} · review</span>
      </div>
      <div style={{ width: '100%', maxWidth: 680, padding: '26px 24px 60px' }}>
        <div style={monoCap()}>{passed ? 'Review complete' : "Let's go back to the lesson first"}</div>
        <h1 style={{ fontFamily: FONT_SERIF, fontSize: 24, fontWeight: 600, color: '#0e2a43', margin: '8px 0 4px' }}>
          {s.correct} of {s.correct + s.wrong} correct{passed ? ' · stopped there' : ''}
        </h1>
        <div
          style={{
            marginTop: 14,
            background: passed ? '#eef3f7' : '#fdf0e6',
            border: `1px solid ${passed ? '#d3e0ea' : '#f0d3bc'}`,
            borderRadius: 10,
            padding: '16px 18px',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: passed ? '#1f4e75' : '#dd6a2f', marginTop: 5, flex: 'none' }} />
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: passed ? '#2b4a63' : '#5c3a24' }}>
            {passed
              ? `Three right settles it, so the rest weren't needed. ${subtopicLabel} stays in your regular review rotation.`
              : onGoToLesson
                ? `Three of these didn't land, so rather than push on, we'll bring you back to the ${subtopicLabel} lesson before the next review. That's what reviews are for - catching this early, not marking you down.`
                : `Three of these didn't land, so rather than push on, this has been flagged for your teacher to go over with you. That's what reviews are for - catching this early, not marking you down.`}
          </div>
        </div>
        {passed && s.redoFlagged && onGoToLesson && (
          <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e4dccb', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12.5, color: '#5c6773', flex: 1, minWidth: 200 }}>
              One of these looked like it needed more than a quick review.
            </div>
            <button
              onClick={onGoToLesson}
              style={{ background: '#fff', color: '#0e2a43', border: '1px solid #cdbfa6', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {subtopicLabel} lesson →
            </button>
          </div>
        )}
        <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {!passed && onGoToLesson && (
            <button
              onClick={onGoToLesson}
              style={{ flex: 1, background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}
            >
              Go to the {subtopicLabel} lesson →
            </button>
          )}
          <button
            onClick={() => onComplete(passed)}
            style={
              passed || !onGoToLesson
                ? { flex: 1, background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }
                : { background: '#fff', color: '#0e2a43', border: '1px solid #cdbfa6', borderRadius: 10, padding: '13px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }
            }
          >
            Back to Home
          </button>
        </div>
        <p style={{ margin: '18px 4px 0', fontSize: 11.5, color: '#a99e88', lineHeight: 1.5, textAlign: 'center' }}>
          No streaks, points, or class rankings - just your own progress.
        </p>
      </div>
    </div>
  )
}
