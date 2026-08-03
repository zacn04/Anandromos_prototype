/**
 * XP: the student-facing measure of effort.
 *
 * **XP is not mastery, and nothing in the engine should branch on it.**
 * build-plan §0 records the reasoning: XP is a volume measure, and a volume
 * measure is farmable - a student can bank a lot of it on foundations items
 * while never touching the hard ones. `engine.ts` already computes
 * difficulty-weighted mastery across three tiers, and the design brief is
 * explicit that a student must not look "done" with a topic by avoiding its
 * hardest questions. So:
 *
 * - **XP** answers "how much work have I put in?" and is shown to the student.
 * - **Mastery** answers "what do they actually know?" and is what the
 *   re-lesson trigger, the review schedule and the teacher dashboard read.
 *
 * `needsRelesson` below therefore takes `TierMastery`, not XP, even though
 * build-plan §3.3 framed the trigger in terms of an XP threshold. That is a
 * deliberate, recorded deviation.
 *
 * Nothing here is ever displayed comparatively. No leaderboards, no class
 * ranking, no streaks - the research basis in the design brief found that
 * competitive framing measurably demoralises exactly the students this product
 * exists to serve.
 */
import { MASTERY_PROMOTE_THRESHOLD } from './engine'
import type { TierMastery } from './engine'

export type SessionKind = 'review' | 'lesson' | 'problemSet' | 'freeplay'

/**
 * Base XP per completed session, by kind.
 *
 * Reviews pay most because spaced retrieval is the thing that actually builds
 * durable recall and is the one mode the student does not choose. Free play
 * pays least, per build-plan §3.3: it is practice toward automaticity and a
 * genuinely useful tool, but it is self-selected, so paying it like a review
 * would let a student farm the easy end of the graph. It is not zero - work is
 * work, and zeroing it would just make free play feel punished.
 */
export const SESSION_XP_BASE: Record<SessionKind, number> = {
  review: 100,
  lesson: 80,
  problemSet: 70,
  freeplay: 40,
}

/**
 * A session always pays something for turning up. Accuracy scales the rest.
 * The floor matters: a student who struggled through a hard review earned
 * more than a student who did nothing, and the interface should say so.
 */
const PARTICIPATION_FLOOR = 0.3

export interface SessionResult {
  kind: SessionKind
  correct: number
  total: number
}

/**
 * XP awarded for one completed session. Scales with the proportion answered
 * correctly, over a participation floor.
 */
export function sessionXp(result: SessionResult): number {
  const base = SESSION_XP_BASE[result.kind]
  if (result.total <= 0) return 0
  const accuracy = Math.min(1, Math.max(0, result.correct / result.total))
  return Math.round(base * (PARTICIPATION_FLOOR + (1 - PARTICIPATION_FLOOR) * accuracy))
}

/** Running total across a set of sessions. */
export function totalXp(results: readonly SessionResult[]): number {
  return results.reduce((sum, r) => sum + sessionXp(r), 0)
}

/**
 * Mastery has decayed far enough that the student should retake the lesson
 * rather than keep reviewing.
 *
 * Reads mastery, not XP, for the reason at the top of this file. Set below the
 * promotion threshold so a topic cannot oscillate between "mastered" and
 * "retake the lesson" on a single miss - there is deliberate hysteresis
 * between the two bars.
 */
export const RELESSON_THRESHOLD = 0.4

export function needsRelesson(mastery: TierMastery | undefined): boolean {
  if (!mastery) return false
  const average = (mastery.foundations + mastery.core + mastery.stretch) / 3
  return average < RELESSON_THRESHOLD
}

/**
 * The gap between the two bars, exposed so a UI can explain itself ("you're
 * close to mastering this") without hardcoding either number.
 */
export function masteryBand(mastery: TierMastery | undefined): 'relearn' | 'building' | 'mastered' {
  if (!mastery) return 'relearn'
  const average = (mastery.foundations + mastery.core + mastery.stretch) / 3
  if (average < RELESSON_THRESHOLD) return 'relearn'
  if (average < MASTERY_PROMOTE_THRESHOLD) return 'building'
  return 'mastered'
}
