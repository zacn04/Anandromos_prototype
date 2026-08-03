/**
 * The computed mastery engine: turns individual practice attempts into a
 * session-scoped, in-memory picture of what a student knows. Pure logic
 * only - no React, no backend, no persistence. Like every other piece of
 * state in this prototype, it resets on reload; the "computed" part is
 * that it now derives from real attempts instead of being pre-baked
 * sample data.
 *
 * `initEngineState` seeds itself from the content store's sample overlays
 * (`sampleNodeStates` and `studentProfile`, backed by
 * `content/samples/node-states.json` and `content/samples/student-profiles.json`)
 * - read live, not duplicated - so a freshly-loaded student starts from
 * exactly the numbers every POV already shows for them today.
 * `recordAttempt` is the only thing that moves the state forward from
 * there; `deriveFrontier` is the pure re-check that lets a newly-mastered
 * topic unlock what comes after it.
 *
 * Everything here is keyed by `TopicId`. The two ID namespaces this engine
 * used to straddle - knowledge-graph node ids and curriculum topic keys -
 * are one namespace now, which is what let the fuzzy display-label matcher
 * that used to bridge them be deleted outright.
 */
import { edgePairs, prereqsOf, sampleNodeStates, studentProfile, subtopicById } from '../content'
import type { MasteryTier, NodeStatus, SubtopicId, TopicId } from '../content'

/**
 * Re-exported so `import type { MasteryTier } from '../data/engine'` keeps
 * resolving. The union itself lives in the content schema, where it is the
 * same three tiers as `DifficultyTier` - one naming the question, one
 * naming the mastery slot that question updates.
 */
export type { MasteryTier } from '../content'

export interface TierMastery {
  foundations: number
  core: number
  stretch: number
}

export interface EngineNodeState {
  status: NodeStatus
  last: string
  next: string
  reps: number
  /**
   * Absolute due time, ms since epoch. `recordAttempt` already computed this
   * to derive the `next` label and then discarded it; keeping it is what lets
   * the scheduler (`data/schedule.ts`) tell "due today" from "eleven days
   * overdue", which a relative label alone cannot express once the student
   * closes the tab and comes back.
   *
   * Absent on nodes seeded from sample content, which carry labels and no
   * timestamps. The scheduler falls back to parsing the label in that case,
   * so a seeded student still orders correctly - it just cannot show anything
   * as overdue until they have actually attempted something.
   */
  dueAt?: number
}

export interface EngineState {
  /**
   * Keyed by TopicId - the same key space as masteryByTopic. Phase 3's
   * cross-topic credit widens this to TopicId | SubtopicId; both are dotted
   * strings, so that is a documentation change, not a type change.
   */
  nodes: Record<TopicId, EngineNodeState>
  masteryByTopic: Record<TopicId, TierMastery>
}

export interface AttemptEvent {
  /** Was `{ nodeId, topic }` - two keys for one entity. Now one. */
  topicId: TopicId
  difficulty: MasteryTier
  correct: boolean
  /** A low-confidence signal - a guess or "I don't know" - not necessarily a wrong answer. Dampens whichever update applies rather than counting as full-strength evidence. */
  weak?: boolean
  /** The subtopic the attempted question belongs to, when known. */
  subtopicId?: SubtopicId
  /**
   * Per-line evidence, for cross-topic credit (build-plan §3.2). Populated
   * from the practice loop's line flagging: each line the student worked
   * carries the prerequisite subtopics that line tests, and whether they got
   * that step right.
   *
   * This is the mechanism the product's diagnostic claim rests on. A student
   * who reliably fails the line tagged `num.fractions.to-decimal` inside a
   * *percentage* question has a fractions gap, and the engine can bank that
   * evidence without ever serving a fractions question.
   */
  lineOutcomes?: readonly LineOutcome[]
}

export interface LineOutcome {
  lineIndex: number
  correct: boolean
  /** Tags from `QuestionLine.prereqSubtopicIds`. Empty is normal - most seed lines are untagged. */
  prereqSubtopicIds: readonly SubtopicId[]
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Spaced-repetition interval cap - "around three weeks" per the brief. */
const MAX_INTERVAL_DAYS = 21
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Mastery-tier update: each attempt nudges masteryByTopic[topicId][tier] a
 * fraction of the way towards 1 (correct) or 0 (wrong), proportional to
 * the remaining distance so it decelerates near the ends instead of a
 * fixed step. A few correct reps in a row climbs visibly (0 -> .35 -> .58
 * -> .72 -> .82); a run of wrong ones visibly bites (.8 -> .56 -> .39)
 * without ever cliffing straight to 0 on one miss. `weak` halves whichever
 * rate applies - a guess is real signal, just weaker signal than a
 * confident attempt.
 */
const MASTERY_UP_RATE = 0.35
const MASTERY_DOWN_RATE = 0.3
const WEAK_DAMPING = 0.5

/**
 * Cross-topic credit is deliberately weaker than a direct attempt: getting one
 * line right inside a larger question is real evidence about the prerequisite,
 * but not as much as answering a question aimed at it. At 0.4 it takes roughly
 * six observed lines to move a prerequisite as far as two direct attempts -
 * enough to surface a persistent gap to the teacher, not enough for a lucky
 * line to mark a topic mastered.
 */
const CROSS_TOPIC_DAMPING = 0.4

/**
 * Promote frontier/in-progress -> mastered once a topic's three tiers
 * average at least this. Exported so a session summary (e.g.
 * LessonSession.tsx) can compare a student's live topic mastery against the
 * same bar the engine itself promotes on, rather than duplicating the
 * number.
 */
export const MASTERY_PROMOTE_THRESHOLD = 0.75

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/**
 * Seeds a fresh EngineState for `studentId` from the store's sample
 * overlays rather than duplicating their data. A student with no entry in
 * either source (e.g. a roster name beyond the three fleshed-out
 * profiles) simply starts from an empty, all-zero state - the same
 * honest "not built out yet" fallback the rest of the app already uses
 * for those names.
 *
 * Mastery rows carry an explicit `topicId` join, so seeding is a direct
 * lookup. A row whose display label names no topic (`'Ratio & proportion'`
 * is a graph-filter label, not a topic) has `topicId: null` and is skipped
 * - the same outcome the old fuzzy label matcher reached, but stated in the
 * data rather than discovered by string mangling.
 */
export function initEngineState(studentId: string): EngineState {
  const states = sampleNodeStates(studentId)
  const nodes: Record<TopicId, EngineNodeState> = {}
  for (const topicId of Object.keys(states)) {
    const st = states[topicId]
    nodes[topicId] = {
      status: st.status,
      last: st.last ?? '—',
      next: st.next ?? 'when ready',
      reps: st.reps ?? 0,
    }
  }

  const masteryByTopic: Record<TopicId, TierMastery> = {}
  for (const row of studentProfile(studentId)?.mastery ?? []) {
    if (!row.topicId) continue
    masteryByTopic[row.topicId] = { foundations: row.foundations, core: row.core, stretch: row.stretch }
  }

  return { nodes, masteryByTopic }
}

/**
 * Promotes 'notready'/'locked' topics to 'frontier' once every one of
 * their prerequisites is 'mastered'. Topics with zero prerequisites are
 * left alone - `every()` over an empty list is vacuously true, which would
 * otherwise wrongly "unlock" root topics that are meant to be seeded
 * directly rather than derived. Never demotes.
 */
export function deriveFrontier(nodes: Record<TopicId, EngineNodeState>): Record<TopicId, EngineNodeState> {
  const updated: Record<TopicId, EngineNodeState> = { ...nodes }
  for (const topicId of Object.keys(nodes)) {
    const node = nodes[topicId]
    if (node.status !== 'notready' && node.status !== 'locked') continue
    const prereqs = prereqsOf(topicId)
    if (prereqs.length === 0) continue
    if (prereqs.every((p) => nodes[p]?.status === 'mastered')) {
      updated[topicId] = { ...node, status: 'frontier' }
    }
  }
  return updated
}

/**
 * Recovers the current spacing interval (in days) from a `next` label
 * this same scheme produced, so the doubling schedule doesn't need a
 * numeric field of its own beyond what EngineNodeState already declares.
 * Labels this can't parse - seed placeholders like 'when ready' or '—' -
 * start from a short 1-day interval rather than guessing at a long one.
 */
function parseIntervalDays(next: string): number {
  if (next === 'today') return 0
  if (next === 'tomorrow') return 1
  const match = /^in (\d+) days?$/.exec(next)
  return match ? Number(match[1]) : 1
}

/**
 * How many days until this topic is due. Negative means overdue.
 *
 * Prefers the absolute `dueAt` stamped by `recordAttempt`; falls back to
 * parsing the relative label for nodes seeded from sample content, which have
 * no timestamp. The fallback can never report a negative number - a label says
 * "in 5 days" without saying when it was written - so a student who has only
 * ever been seeded reads as due-or-later, never overdue. That is a limitation
 * of label-only seed data, not of the schedule.
 */
export function dueInDays(node: EngineNodeState, now?: number): number {
  if (node.dueAt !== undefined) {
    return Math.round((node.dueAt - (now ?? Date.now())) / MS_PER_DAY)
  }
  return parseIntervalDays(node.next)
}

function intervalLabel(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

/**
 * Records one practice attempt and returns a NEW EngineState - `state` is
 * never mutated. Order of effects: reps + last on the attempted topic, the
 * topic/tier mastery fraction, the spaced-repetition schedule, a possible
 * promotion to 'mastered', trickle-down recency credit to direct
 * prerequisites, then a frontier re-derivation so any newly-mastered topic
 * can unlock what comes after it.
 */
export function recordAttempt(state: EngineState, event: AttemptEvent, now?: number): EngineState {
  const nowMs = now ?? Date.now()
  const prevNode: EngineNodeState = state.nodes[event.topicId] ?? { status: 'notready', last: '—', next: 'when ready', reps: 0 }
  const prevTier: TierMastery = state.masteryByTopic[event.topicId] ?? { foundations: 0, core: 0, stretch: 0 }

  // A guess/"I don't know" isn't real retrieval practice, so it doesn't bank a rep.
  const reps = event.weak ? prevNode.reps : prevNode.reps + 1

  const rate = (event.correct ? MASTERY_UP_RATE : MASTERY_DOWN_RATE) * (event.weak ? WEAK_DAMPING : 1)
  const target = event.correct ? 1 : 0
  const prevTierValue = prevTier[event.difficulty]
  const updatedTier: TierMastery = {
    ...prevTier,
    [event.difficulty]: clamp01(prevTierValue + (target - prevTierValue) * rate),
  }

  // Correct doubles the interval (capped at three weeks); wrong pulls it back to tomorrow.
  const priorIntervalDays = parseIntervalDays(prevNode.next)
  const nextIntervalDays = event.correct ? Math.min(MAX_INTERVAL_DAYS, Math.max(1, priorIntervalDays) * 2) : 1
  const dueAtMs = nowMs + nextIntervalDays * MS_PER_DAY
  const next = intervalLabel(Math.round((dueAtMs - nowMs) / MS_PER_DAY))

  // Promote on a correct answer once the topic is strong on average across all three
  // tiers - never demote on a miss, which would be punitive and out of step with the
  // rest of this app's tone.
  const tierAverage = (updatedTier.foundations + updatedTier.core + updatedTier.stretch) / 3
  const promotes =
    event.correct && (prevNode.status === 'frontier' || prevNode.status === 'inprogress') && tierAverage >= MASTERY_PROMOTE_THRESHOLD
  const status: NodeStatus = promotes ? 'mastered' : prevNode.status

  const nodes: Record<TopicId, EngineNodeState> = {
    ...state.nodes,
    [event.topicId]: { status, last: 'today', next, reps, dueAt: dueAtMs },
  }

  // Trickle-down: direct prerequisites get partial recency credit - practising an
  // advanced topic also exercises what it's built on - but only `.last` moves; their
  // own next/reps/status are untouched, so it's credit, not a free rep.
  for (const [a, b] of edgePairs()) {
    if (b !== event.topicId) continue
    const prereq = nodes[a]
    if (prereq) nodes[a] = { ...prereq, last: 'today · trickle-down' }
  }

  const masteryByTopic: Record<TopicId, TierMastery> = {
    ...state.masteryByTopic,
    [event.topicId]: updatedTier,
  }

  // Cross-topic credit (build-plan §3.2). Trickle-down above says "you touched
  // this area" and moves recency only. This says "you demonstrably did this
  // step, right or wrong" and moves mastery - the difference between inferring
  // from adjacency and observing from evidence.
  //
  // Damped, because a single line inside a larger question is weaker evidence
  // than a whole attempt, and credited to `foundations`: a prerequisite
  // exercised inside a harder question is by definition foundational relative
  // to that question. `.last` moves so the topic reads as recently practised;
  // reps and the review schedule do not, for the same reason trickle-down
  // doesn't - this is credit, not a free rep, and it must not push a genuine
  // review further out.
  for (const line of event.lineOutcomes ?? []) {
    for (const subtopicId of line.prereqSubtopicIds) {
      const ownerTopic = subtopicById(subtopicId)?.topicId
      // Skip the question's own topic: recordAttempt already scored it above at
      // full strength, and crediting it again would double-count one attempt.
      if (!ownerTopic || ownerTopic === event.topicId) continue

      const prev: TierMastery = masteryByTopic[ownerTopic] ?? { foundations: 0, core: 0, stretch: 0 }
      const lineRate = (line.correct ? MASTERY_UP_RATE : MASTERY_DOWN_RATE) * CROSS_TOPIC_DAMPING
      const lineTarget = line.correct ? 1 : 0
      masteryByTopic[ownerTopic] = {
        ...prev,
        foundations: clamp01(prev.foundations + (lineTarget - prev.foundations) * lineRate),
      }

      const node = nodes[ownerTopic]
      if (node) nodes[ownerTopic] = { ...node, last: 'today · cross-topic' }
    }
  }

  return { nodes: deriveFrontier(nodes), masteryByTopic }
}
