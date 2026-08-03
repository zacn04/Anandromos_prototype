/**
 * The due queue: what the student is shown next, and in what order.
 *
 * `engine.ts` knows when each topic is due; it does not know what to do about
 * forty of them being due at once. That is this module's job. Pure logic - no
 * React, no persistence - so the ordering can be reasoned about and tested
 * independently of the screens that render it.
 *
 * Two rules from build-plan §3.1 shape everything here:
 *
 * 1. **Priority, not chronology.** Overdue reviews outrank due-today reviews,
 *    which outrank new frontier lessons, which outrank teacher problem sets
 *    that are not yet near their due date. Free play is never queued - it is
 *    opt-in practice by definition, and queueing it would make it homework.
 *
 * 2. **A daily cap, and the schedule slips.** A student returning after two
 *    weeks must not be shown a wall of red. We surface a day's worth and let
 *    the rest wait. The research basis in the design brief is explicit that
 *    demoralising the lower-performing student is the failure mode this
 *    product exists to avoid, and an unpayable backlog is exactly that.
 */
import type { TopicId } from '../content'
import { lessonForTopic, topicLabel } from '../content'
import { dueInDays } from './engine'
import { needsRelesson } from './xp'
import type { EngineState } from './engine'

/** How many items a student is shown in one sitting. The rest wait for tomorrow. */
export const DAILY_ITEM_CAP = 12

/**
 * A problem set is promoted above frontier lessons once it is within this many
 * days of its due date - homework with a deadline beats optional progress, but
 * only when the deadline is actually close.
 */
export const PROBLEM_SET_URGENT_DAYS = 3

export type QueueItemKind = 'review' | 'lesson' | 'problemSet'

export interface QueueItem {
  kind: QueueItemKind
  /** Present on reviews and lessons; problem sets span several topics. */
  topicId: TopicId | null
  label: string
  /** Days until due. Negative is overdue. */
  dueInDays: number
  /** Lower sorts first. */
  priority: number
  /** Stable id for React keys and for the caller to route on. */
  id: string
}

export interface PendingProblemSet {
  id: string
  title: string
  dueInDays: number
  /** True once every prerequisite topic is mastered; locked sets are not queued. */
  unlocked: boolean
}

export interface Queue {
  /** What to show now, already ordered and capped. */
  items: readonly QueueItem[]
  /**
   * How many further items were due but held back by the cap. Render this as a
   * quiet "N more waiting", never as a backlog count with urgency styling.
   */
  deferred: number
  /** True when nothing at all is due - the honest "you're up to date" state. */
  clear: boolean
}

/**
 * Priority bands. Gaps between bands are deliberate: within a band items are
 * ordered by how overdue they are, and the gap guarantees no amount of
 * overdueness lets a lower band jump a higher one.
 */
const BAND = {
  overdueReview: 0,
  urgentProblemSet: 1000,
  dueReview: 2000,
  frontierLesson: 3000,
  problemSet: 4000,
} as const

export interface BuildQueueOptions {
  problemSets?: readonly PendingProblemSet[]
  cap?: number
  now?: number
}

/**
 * Builds the ordered, capped queue for one student from their live engine
 * state. Deterministic: same state in, same queue out, so a re-render cannot
 * reshuffle what the student is looking at.
 */
export function buildQueue(state: EngineState, opts: BuildQueueOptions = {}): Queue {
  const { problemSets = [], cap = DAILY_ITEM_CAP, now } = opts
  const items: QueueItem[] = []

  for (const topicId of Object.keys(state.nodes)) {
    const node = state.nodes[topicId]
    const due = dueInDays(node, now)

    // A frontier topic is the ready-to-learn edge of the graph — but only
    // counts as a LESSON until the student has actually attempted it. After
    // that there is something to review, so it falls through to the review
    // branch and obeys the spaced-repetition schedule like everything else.
    //
    // Without the `reps === 0` guard this branch queued a lesson
    // unconditionally: `status` stays 'frontier' until mastery crosses the
    // promotion threshold, and the branch ignored the due date, so finishing a
    // lesson put the identical row straight back at the top of the student's
    // path. From the student's side that reads as "I finished it and nothing
    // changed", which is exactly the demoralising dead end the design brief
    // says to avoid.
    // The second half of the rule is build-plan §3.3: a student whose mastery
    // has decayed past the re-lesson threshold is sent back to the lesson
    // rather than made to keep failing reviews. `needsRelesson` reads
    // difficulty-weighted mastery, never XP, for the reason given in xp.ts.
    const relearn = needsRelesson(state.masteryByTopic[topicId])
    if (node.status === 'frontier' && (node.reps === 0 || relearn)) {
      // Only queue a lesson we can actually deliver.
      if (!lessonForTopic(topicId)) continue
      items.push({
        kind: 'lesson',
        topicId,
        label: topicLabel(topicId),
        dueInDays: due,
        priority: BAND.frontierLesson,
        id: `lesson:${topicId}`,
      })
      continue
    }

    // Reviews are for material already met. Nothing not-yet-started is due.
    if (node.status === 'notready' || node.status === 'locked') continue
    if (due > 0) continue

    items.push({
      kind: 'review',
      topicId,
      label: topicLabel(topicId),
      dueInDays: due,
      // Within the overdue band, the most overdue sorts first.
      priority: due < 0 ? BAND.overdueReview + due : BAND.dueReview,
      id: `review:${topicId}`,
    })
  }

  for (const ps of problemSets) {
    if (!ps.unlocked) continue
    const urgent = ps.dueInDays <= PROBLEM_SET_URGENT_DAYS
    items.push({
      kind: 'problemSet',
      topicId: null,
      label: ps.title,
      dueInDays: ps.dueInDays,
      priority: (urgent ? BAND.urgentProblemSet : BAND.problemSet) + ps.dueInDays,
      id: `problemSet:${ps.id}`,
    })
  }

  // Sort by priority, then by label so equal-priority items have a stable,
  // non-arbitrary order rather than whatever key iteration happened to give.
  items.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))

  return {
    items: items.slice(0, cap),
    deferred: Math.max(0, items.length - cap),
    clear: items.length === 0,
  }
}

/**
 * A plain-language due label for a queue item. Deliberately undramatic: an
 * eleven-day-overdue review reads "11 days ago", not "OVERDUE — 11 DAYS".
 */
export function dueLabel(item: QueueItem): string {
  const d = item.dueInDays
  if (d < -1) return `${Math.abs(d)} days ago`
  if (d === -1) return 'yesterday'
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  return `in ${d} days`
}
