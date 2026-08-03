/**
 * The complete synchronous accessor surface — §5.6 of
 * `docs/content-schema-spec.md`. This list is exhaustive: there are no other
 * accessors, and no agent may add one.
 *
 * Every function here reads `requireStore()` and is SYNCHRONOUS. Components
 * call them exactly where they read a constant today, which is what lets
 * ~4,400 lines of component code keep their present shape while the loader
 * alone knows that content is fetched (constraint 2).
 *
 * ORDERING CONTRACT: everything returns authored file order. The single
 * exception in the entire store is `graphTopics()`, which returns graph topics
 * sorted ascending by `Topic.graph.order` (§3.3). No accessor dedupes, and none
 * filters beyond what its name says — in particular none filters on `status`
 * (§3.9 / §9.2 D3).
 *
 * MISSING KEYS: the fallbacks below are §5.6's table, verbatim. Note that
 * `tsconfig.app.json` sets no `strictNullChecks`, so a forgotten `?? []` is a
 * runtime crash the compiler will never mention — `engine.ts`'s
 * `prereqs.length === 0`, `ReviewSession`'s `pool[Math.min(...)]` and
 * `StudentApp`'s `pool[i % pool.length]` all index straight into these results.
 */
import type {
  DifficultyTier,
  CatalogueGroup,
  ClassDefaults,
  ContentMeta,
  EdgePair,
  GraphFilter,
  GraphTopic,
  Lesson,
  LogActivity,
  NodeStats,
  NodeStatus,
  OversightItem,
  Question,
  QuestionId,
  ReteachCardContent,
  SampleNodeState,
  SchoolClass,
  Strand,
  StrandId,
  StudentId,
  StudentProfile,
  Subtopic,
  SubtopicId,
  SubtopicPrereqEdge,
  Teacher,
  Topic,
  TopicId,
  TopicPrereqEdge,
  YearBand,
} from './schema'
import { requireStore } from './store'

// Stable empty results, so a miss never allocates and never hands React a new
// array identity on every render.
const NO_TOPIC_IDS: readonly TopicId[] = []
const NO_SUBTOPICS: readonly Subtopic[] = []
const NO_QUESTIONS: readonly Question[] = []
const NO_ACTIVITIES: readonly LogActivity[] = []
const NO_NODE_STATES: Readonly<Record<TopicId, SampleNodeState>> = {}
/** §5.6: `next` is '—', NOT 'when ready'. */
const FALLBACK_NODE_STATS: NodeStats = { last: '—', next: '—', reps: 0 }

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------
export function contentMeta(): ContentMeta {
  return requireStore().meta
}

/** Was GRADES. */
export function yearBands(): readonly YearBand[] {
  return requireStore().meta.yearBands ?? []
}

// ---------------------------------------------------------------------------
// strands & topics
// ---------------------------------------------------------------------------
export function strands(): readonly Strand[] {
  return requireStore().strands
}

export function strandById(id: StrandId): Strand | undefined {
  return requireStore().index.strandById.get(id)
}

export function topics(): readonly Topic[] {
  return requireStore().topics
}

/** Resolves live ids first, then aliases (§1.6). Never returns another entity type. */
export function topicById(id: TopicId): Topic | undefined {
  const { index } = requireStore()
  const live = index.topicById.get(id)
  if (live) return live
  const aliased = index.aliasTo.get(id)
  return aliased ? index.topicById.get(aliased) : undefined
}

/** Display label. Falls back to the id itself, matching today's topicLabel(). */
export function topicLabel(id: TopicId): string {
  const topic = topicById(id)
  return topic ? topic.label : id
}

/** Catalogue topics grouped by strand, in authored order. Was CURRIC. */
export function catalogueGroups(): readonly CatalogueGroup[] {
  return requireStore().index.catalogueGroups
}

// ---------------------------------------------------------------------------
// knowledge graph
// ---------------------------------------------------------------------------
/** Sorted by Topic.graph.order — the one sort in the store. Was NODES. */
export function graphTopics(): readonly GraphTopic[] {
  return requireStore().index.graphTopics
}

/** Was NODE_BY_ID. */
export function graphTopicById(id: TopicId): GraphTopic | undefined {
  return requireStore().index.graphTopicById.get(id)
}

/** Reads Topic.onGraph — NOT `graph !== null`. See §3.2. */
export function isGraphTopic(id: TopicId): boolean {
  const topic = topicById(id)
  return topic ? topic.onGraph : false
}

/** Was EDGES. */
export function edgePairs(): readonly EdgePair[] {
  return requireStore().index.edgePairs
}

/** Direct prerequisites of `id`, in edge-file order. `[]` for a root topic. */
export function prereqsOf(id: TopicId): readonly TopicId[] {
  return requireStore().index.prereqsByTopic.get(id) ?? NO_TOPIC_IDS
}

/** The rich edge form, with strength / source / confidence. */
export function topicEdges(): readonly TopicPrereqEdge[] {
  return requireStore().topicEdges
}

/** Was BASKETS. */
export function graphFilters(): readonly GraphFilter[] {
  return requireStore().graphFilters
}

// ---------------------------------------------------------------------------
// subtopics
// ---------------------------------------------------------------------------
export function subtopics(): readonly Subtopic[] {
  return requireStore().subtopics
}

/** Resolves live ids first, then aliases (§1.6). Never returns another entity type. */
export function subtopicById(id: SubtopicId): Subtopic | undefined {
  const { index } = requireStore()
  const live = index.subtopicById.get(id)
  if (live) return live
  const aliased = index.aliasTo.get(id)
  return aliased ? index.subtopicById.get(aliased) : undefined
}

export function subtopicsForTopic(topicId: TopicId): readonly Subtopic[] {
  return requireStore().index.subtopicsByTopic.get(topicId) ?? NO_SUBTOPICS
}

export function subtopicEdges(): readonly SubtopicPrereqEdge[] {
  return requireStore().subtopicEdges
}

// ---------------------------------------------------------------------------
// questions — the BANK tier (§3.12)
// ---------------------------------------------------------------------------
// There is deliberately no `questions()` accessor: "give me every question" is
// the one operation a lazy bank cannot serve, and nothing in the app asks.

/** Resolves live ids first, then aliases (§1.6). Was problemById. */
export function questionById(id: QuestionId): Question | undefined {
  return requireStore().bank.byId(id)
}

/** Was problemsForTopic. */
export function questionsForTopic(topicId: TopicId): readonly Question[] {
  return requireStore().bank.forTopic(topicId) ?? NO_QUESTIONS
}

/**
 * The difficulty tiers a topic actually has questions for.
 *
 * Mastery is an average across tiers, and averaging in a tier the topic never
 * asks about makes mastery unreachable by construction: a topic whose bank is
 * all `core` would need `foundations` and `stretch` evidence it can never give
 * a student the chance to produce. Judging against what the topic offers is the
 * difference between a demanding bar and an impossible one.
 *
 * Order is fixed (not draw order) so callers can rely on it.
 */
export function tiersOfferedForTopic(topicId: TopicId): readonly DifficultyTier[] {
  const offered = new Set(questionsForTopic(topicId).map((q) => q.difficulty))
  return (['foundations', 'core', 'stretch'] as const).filter((t) => offered.has(t))
}

/**
 * Draws `count` questions for a topic, spread evenly across the tiers it offers.
 *
 * Homework and any other bulk draw wants a ramp, not a prefix: the bank is
 * grouped by tier, so `questionAt(topic, 0..n)` can hand back a dozen questions
 * at a single difficulty. Beyond being poor homework, that makes the set
 * unable to demonstrate mastery — mastery averages over the tiers a topic
 * offers, and a tier the set never asks about stays at zero however much work
 * the student does, wedging anything gated behind that topic shut.
 *
 * Round-robins the tiers so each is represented before any repeats, and returns
 * fewer than `count` when the topic simply hasn't got that many questions.
 */
export function drawBalanced(topicId: TopicId, count: number): readonly Question[] {
  const all = questionsForTopic(topicId)
  const byTier = tiersOfferedForTopic(topicId)
    .map((tier) => all.filter((q) => q.difficulty === tier))
    .filter((qs) => qs.length > 0)
  const drawn: Question[] = []
  for (let round = 0; drawn.length < count; round++) {
    // Every tier exhausted means the topic has nothing left to give.
    if (byTier.every((qs) => round >= qs.length)) break
    for (const questions of byTier) {
      if (drawn.length >= count) break
      const question = questions[round]
      if (question) drawn.push(question)
    }
  }
  return drawn
}

export function questionsForSubtopic(id: SubtopicId): readonly Question[] {
  return requireStore().bank.forSubtopic(id) ?? NO_QUESTIONS
}

/**
 * "Question N for a topic" = its 0-indexed position in questionsForTopic.
 * Positional addressing is why no accessor may ever filter on `status`
 * (§9.2 D3): retiring one question would silently re-point this. Was problemAt.
 */
export function questionAt(topicId: TopicId, n: number): Question | undefined {
  return requireStore().bank.at(topicId, n)
}

/**
 * A same-(subtopic, family) "different numbers" variant, for the silly-mistake
 * retry. Deterministic first match in authored order — not random. Excludes the
 * question itself and anything in `exclude`. Was similarProblem.
 */
export function similarQuestion(
  id: QuestionId,
  exclude?: readonly QuestionId[],
): Question | undefined {
  return requireStore().bank.similar(id, exclude)
}

/** Convenience: the `text` of every line, in order. Replaces reads of `problem.lines`. */
export function lineTexts(q: Question): string[] {
  return (q.lines ?? []).map((line) => line.text)
}

// ---------------------------------------------------------------------------
// re-teach (BANK tier)
// ---------------------------------------------------------------------------
export function reteachCardFor(
  questionId: QuestionId,
  lineIndex: number | 'all',
): ReteachCardContent | undefined {
  return requireStore().bank.reteachCardFor(questionId, lineIndex)
}

// ---------------------------------------------------------------------------
// lessons
// ---------------------------------------------------------------------------
/** Hydrated: topicLabel + per-prerequisite id/label filled in. Was LESSONS[key]. */
export function lessonForTopic(topicId: TopicId): Lesson | undefined {
  return requireStore().index.lessonByTopic.get(topicId)
}

// ---------------------------------------------------------------------------
// school
// ---------------------------------------------------------------------------
/** Was TEACHERS. */
export function teachers(): readonly Teacher[] {
  return requireStore().teachers
}

/** Was SCHOOL_CLASSES. */
export function schoolClasses(): readonly SchoolClass[] {
  return requireStore().classes
}

/** Was DEFAULT_ROSTER. */
export function defaultRoster(): readonly string[] {
  const classDefaults: ClassDefaults = requireStore().classDefaults
  return classDefaults.roster ?? []
}

/** Rebuilt from ClassDefaults.basket; every listed topic maps to `true`. Was DEFAULT_BASKET. */
export function defaultBasket(): Readonly<Record<TopicId, boolean>> {
  return requireStore().index.defaultBasket
}

// ---------------------------------------------------------------------------
// samples
// ---------------------------------------------------------------------------
/** The studentIds in samples/node-states.json, in authored order: aisha, daniel, reuben. */
export function sampleStudentIds(): readonly StudentId[] {
  return Object.keys(requireStore().sampleNodeStates)
}

export function sampleNodeStates(studentId: StudentId): Readonly<Record<TopicId, SampleNodeState>> {
  return requireStore().sampleNodeStates[studentId] ?? NO_NODE_STATES
}

/** Falls back to 'notready'. Was statusFor(). */
export function sampleNodeStatus(studentId: StudentId, topicId: TopicId): NodeStatus {
  return sampleNodeStates(studentId)[topicId]?.status ?? 'notready'
}

/**
 * Falls back to `{ last: '—', next: '—', reps: 0 }`. Was statsFor().
 * A SampleNodeState IS a NodeStats (it extends it), so the stored object is
 * returned as-is: same values, stable identity, no per-call allocation.
 */
export function sampleNodeStats(studentId: StudentId, topicId: TopicId): NodeStats {
  return sampleNodeStates(studentId)[topicId] ?? FALLBACK_NODE_STATS
}

/** Was PROFILE_BY_ID[id]. */
export function studentProfile(studentId: StudentId): StudentProfile | undefined {
  return requireStore().sampleProfiles[studentId]
}

/** Was LOG_BY_STUDENT[id] / LOG_RAW. */
export function activityLogFor(studentId: StudentId): readonly LogActivity[] {
  return requireStore().sampleActivityLog[studentId] ?? NO_ACTIVITIES
}

/** Was OVERSIGHT_RAW. */
export function oversightItems(): readonly OversightItem[] {
  return requireStore().sampleOversight
}
