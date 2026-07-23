/**
 * The computed mastery engine: turns individual practice attempts into a
 * session-scoped, in-memory picture of what a student knows. Pure logic
 * only - no React, no backend, no persistence. Like every other piece of
 * state in this prototype, it resets on reload; the "computed" part is
 * that it now derives from real attempts instead of being pre-baked
 * sample data.
 *
 * `initEngineState` seeds itself from the existing static per-student
 * overlays in knowledgeGraph.ts / studentProfiles.ts - read live, not
 * duplicated - so a freshly-loaded student starts from exactly the
 * numbers every POV already shows for them today. `recordAttempt` is the
 * only thing that moves the state forward from there; `deriveFrontier` is
 * the pure re-check that lets a newly-mastered node unlock what comes
 * after it.
 */
import { EDGES, NODE_STATS_BY_STUDENT, NODE_STATUS_BY_STUDENT } from './knowledgeGraph'
import type { NodeStatus } from './knowledgeGraph'
import { PROFILE_BY_ID } from './studentProfiles'
import { CURRIC } from './curriculum'

export type MasteryTier = 'foundations' | 'core' | 'stretch'

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
}

export interface EngineState {
  nodes: Record<string, EngineNodeState>
  masteryByTopic: Record<string, TierMastery>
}

export interface AttemptEvent {
  nodeId: string
  topic: string
  difficulty: MasteryTier
  correct: boolean
  /** A low-confidence signal - a guess or "I don't know" - not necessarily a wrong answer. Dampens whichever update applies rather than counting as full-strength evidence. */
  weak?: boolean
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Spaced-repetition interval cap - "around three weeks" per the brief. */
const MAX_INTERVAL_DAYS = 21
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Mastery-tier update: each attempt nudges masteryByTopic[topic][tier] a
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
 * Promote frontier/in-progress -> mastered once a topic's three tiers
 * average at least this. Exported so a session summary (e.g.
 * LessonSession.tsx) can compare a student's live topic mastery against the
 * same bar the engine itself promotes on, rather than duplicating the
 * number.
 */
export const MASTERY_PROMOTE_THRESHOLD = 0.75

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

// ---------------------------------------------------------------------------
// Topic-name matching for seeding: studentProfiles.ts's MasteryRow.name is a
// display label ('Fractions & %'), while AttemptEvent.topic and
// problems.ts use curriculum.ts's key ('fracpct') instead. Normalizing
// both to a bare lowercase word-list - turning '%' into the word 'pct'
// first so it isn't silently dropped and colliding "Fractions" with
// "Fractions -> %" - lets the two vocabularies line up without a
// hand-maintained alias table. Rows with no findable match (e.g. "Algebra
// basics", which has no equivalent curriculum key) are simply left
// unseeded - callers fall back to a zeroed tier, same as any other topic
// that's never been attempted.
// ---------------------------------------------------------------------------

function normalizeTopicName(label: string): string {
  return label
    .toLowerCase()
    .replace(/%/g, ' pct ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const TOPIC_KEY_BY_NORMALIZED_LABEL: Record<string, string> = Object.fromEntries(
  CURRIC.flatMap((group) => group.topics.map(([key, label]) => [normalizeTopicName(label), key])),
)

/**
 * Seeds a fresh EngineState for `studentId` from the existing static
 * overlays rather than duplicating their data. A student with no entry in
 * either source (e.g. a roster name beyond the three fleshed-out
 * profiles) simply starts from an empty, all-zero state - the same
 * honest "not built out yet" fallback the rest of the app already uses
 * for those names.
 */
export function initEngineState(studentId: string): EngineState {
  const statusMap = NODE_STATUS_BY_STUDENT[studentId] ?? {}
  const statsMap = NODE_STATS_BY_STUDENT[studentId] ?? {}
  const nodes: Record<string, EngineNodeState> = {}
  for (const nodeId of Object.keys(statusMap)) {
    const stats = statsMap[nodeId]
    nodes[nodeId] = {
      status: statusMap[nodeId],
      last: stats?.last ?? '—',
      next: stats?.next ?? 'when ready',
      reps: stats?.reps ?? 0,
    }
  }

  const masteryByTopic: Record<string, TierMastery> = {}
  for (const row of PROFILE_BY_ID[studentId]?.mastery ?? []) {
    const key = TOPIC_KEY_BY_NORMALIZED_LABEL[normalizeTopicName(row.name)]
    if (key) masteryByTopic[key] = { foundations: row.foundations, core: row.core, stretch: row.stretch }
  }

  return { nodes, masteryByTopic }
}

/**
 * Promotes 'notready'/'locked' nodes to 'frontier' once every one of
 * their prerequisites (via EDGES) is 'mastered'. Nodes with zero
 * prerequisites are left alone - `every()` over an empty list is
 * vacuously true, which would otherwise wrongly "unlock" root topics that
 * are meant to be seeded directly rather than derived. Never demotes.
 */
export function deriveFrontier(nodes: Record<string, EngineNodeState>): Record<string, EngineNodeState> {
  const updated: Record<string, EngineNodeState> = { ...nodes }
  for (const nodeId of Object.keys(nodes)) {
    const node = nodes[nodeId]
    if (node.status !== 'notready' && node.status !== 'locked') continue
    const prereqs = EDGES.filter(([, b]) => b === nodeId).map(([a]) => a)
    if (prereqs.length === 0) continue
    if (prereqs.every((p) => nodes[p]?.status === 'mastered')) {
      updated[nodeId] = { ...node, status: 'frontier' }
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

function intervalLabel(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

/**
 * Records one practice attempt and returns a NEW EngineState - `state` is
 * never mutated. Order of effects: reps + last on the attempted node, the
 * topic/tier mastery fraction, the spaced-repetition schedule, a possible
 * promotion to 'mastered', trickle-down recency credit to direct
 * prerequisites, then a frontier re-derivation so any newly-mastered node
 * can unlock what comes after it.
 */
export function recordAttempt(state: EngineState, event: AttemptEvent, now?: number): EngineState {
  const nowMs = now ?? Date.now()
  const prevNode: EngineNodeState = state.nodes[event.nodeId] ?? { status: 'notready', last: '—', next: 'when ready', reps: 0 }
  const prevTier: TierMastery = state.masteryByTopic[event.topic] ?? { foundations: 0, core: 0, stretch: 0 }

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

  const nodes: Record<string, EngineNodeState> = { ...state.nodes, [event.nodeId]: { status, last: 'today', next, reps } }

  // Trickle-down: direct prerequisites get partial recency credit - practising an
  // advanced topic also exercises what it's built on - but only `.last` moves; their
  // own next/reps/status are untouched, so it's credit, not a free rep.
  for (const [a, b] of EDGES) {
    if (b !== event.nodeId) continue
    const prereq = nodes[a]
    if (prereq) nodes[a] = { ...prereq, last: 'today · trickle-down' }
  }

  return {
    nodes: deriveFrontier(nodes),
    masteryByTopic: { ...state.masteryByTopic, [event.topic]: updatedTier },
  }
}
