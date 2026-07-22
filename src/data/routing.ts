/**
 * Reason-coded routing: what should happen next after a practice attempt.
 * Shared by the Lesson and Review session wrappers so they can't silently
 * interpret the same reason differently. Pure - no React/component imports.
 *
 * Only four reason keys are ever actually stored on an attempt ('other' is
 * coded to 'notlearned' by PracticeLoop before it reaches here). Severity,
 * ascending: slip < silly < {hard, notlearned} - hard and notlearned are
 * routing-equivalent because the design brief itself groups them in one
 * routing rule ("Too hard / 'I understood nothing'").
 */
const SEVERITY: Record<string, number> = { slip: 0, silly: 1, hard: 2, notlearned: 2 }

/** The most severe reason across every flagged line in a multi-select attempt. */
export function worstReason(reasons: Record<number, string>): string | undefined {
  const vals = Object.values(reasons)
  return vals.length ? vals.reduce((worst, r) => ((SEVERITY[r] ?? 0) > (SEVERITY[worst] ?? 0) ? r : worst)) : undefined
}

export type Route = 'next' | 'similarRetry' | 'redoLesson'

interface AttemptOutcome {
  correct: boolean
  flaggedLines: number[] | 'all'
  reasons: Record<number, string>
}

/**
 * `isEscalatedRetry`: this attempt was already a same-family "different
 * numbers" retry served after a `silly` miss - getting it wrong again
 * always escalates to `redoLesson`, regardless of which reason the student
 * picks this time (PracticeLoop's `forceReason` prop is what actually forces
 * the re-teach copy for that escalation).
 */
export function routeFor(outcome: AttemptOutcome, isEscalatedRetry: boolean): Route {
  if (outcome.correct) return 'next'
  if (outcome.flaggedLines === 'all') return 'redoLesson' // "I got it all wrong" / "I understood nothing"
  if (isEscalatedRetry) return 'redoLesson'
  const reason = worstReason(outcome.reasons)
  if (reason === 'silly') return 'similarRetry'
  if (reason === 'hard' || reason === 'notlearned') return 'redoLesson'
  return 'next' // slip, or no reason recorded
}
