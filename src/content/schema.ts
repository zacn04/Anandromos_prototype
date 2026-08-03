/**
 * Entity and id types for the Anadromos content store.
 *
 * Implements §5.3 of `docs/content-schema-spec.md`, which is normative: where
 * this file and any other document disagree, the spec wins.
 *
 * This module has NO imports — not even type imports from elsewhere in `src/`.
 * It is compiled by BOTH `tsconfig.app.json` and `tsconfig.node.json` (the
 * offline validation CLI imports it), so any import it ever gains must carry an
 * explicit `.ts` extension to resolve under `moduleResolution: "nodenext"`.
 */

// ---------------------------------------------------------------------------
// ID aliases. Aliases, not brands: components pass plain strings today and
// branding them would add casts to ~40 call sites for no runtime benefit.
// ---------------------------------------------------------------------------
export type StrandId = string
export type TopicId = string
export type SubtopicId = string
export type QuestionId = string
export type GraphFilterId = string
export type TeacherId = string
export type ClassId = string
export type StudentId = string
export type FamilyId = string
/** Open on purpose: `meta.yearBands` is authored and grows past Year 9. */
export type YearBand = string

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------
/**
 * Six values, not two. build-plan §2.6's own exit criterion ("≥85% usable
 * without edit") implies ~48,000 questions that are neither draft nor
 * verified; a rejected question is data, not a deletion. See §3.9.
 * NOTE: no accessor filters on this field in Phase 0. See §3.9 and §9.2 D3.
 */
export type ContentStatus =
  | 'draft' | 'generated' | 'in-review' | 'verified' | 'rejected' | 'retired'
/** Provenance of an authored entity. Mirrors PrereqEdgeSource. */
export type ContentSource = 'ai' | 'teacher' | 'imported'
export type DifficultyTier = 'foundations' | 'core' | 'stretch'
export type NodeStatus = 'mastered' | 'inprogress' | 'frontier' | 'notready' | 'locked'
export type PrereqEdgeSource = 'ai' | 'teacher' | 'empirical'
export type ExamBoard = 'aqa' | 'edexcel' | 'ocr' | 'wjec'
export type ExamTier = 'foundation' | 'higher' | 'both'

// `MasteryTier` was declared in engine.ts and is structurally identical to
// DifficultyTier — the same three tiers, one naming the question and one naming
// the mastery slot it updates. Keep the alias so engine.ts's public type name
// survives; do not declare a second union.
export type MasteryTier = DifficultyTier

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------
export interface ContentMeta {
  schemaVersion: number
  contentVersion: string
  /** build-plan §0.2. Bumped by hand when prereq-edges.topic.json changes. */
  topicGraphVersion: string
  /** Bumped by hand when prereq-edges.subtopic.json changes. */
  subtopicGraphVersion: string
  /** SHA-256 hex of each edge file's `items`. '' = not yet computed. §4.3. */
  graphHashes: { topic: string; subtopic: string }
  yearBands: readonly YearBand[]
}

export interface Strand {
  id: StrandId
  label: string
}

/**
 * Hand-authored layout for a topic drawn on the knowledge graph. OPTIONAL in
 * the model (`Topic.graph` may be null while `Topic.onGraph` is true) because
 * Phase 1 computes layouts for ~200 topics rather than authoring them. §3.2.
 */
export interface TopicGraphPlacement {
  /**
   * 1-based draw order across graph topics; unique. The ONE sanctioned sort
   * key in the store — `graphTopics()` sorts by it and nothing else sorts
   * anything. Decoupled from topics.json order, which is catalogue order. §3.3.
   */
  order: number
  x: number
  y: number
  /** Always authored, even when identical to Topic.label. See §3.3. */
  label: string
}

export interface Topic {
  id: TopicId
  strandId: StrandId
  label: string
  yearBand: YearBand
  /** Appears in the teacher-facing topic catalogue (class setup, homework). */
  catalogue: boolean
  /** Membership in the prerequisite graph. What isGraphTopic() reads. §3.2. */
  onGraph: boolean
  /** Authored layout override. Non-null implies onGraph. May be null when onGraph. */
  graph: TopicGraphPlacement | null
  /** Retired ids that still resolve to this topic. §1.6. [] in seed content. */
  aliases: readonly TopicId[]
  source: ContentSource
  /** ISO-8601 date, or null if never formally reviewed. */
  reviewedAt: string | null
  status: ContentStatus
}

/** Which board/tier a subtopic is examinable in. build-plan §4. */
export interface BoardScope {
  board: ExamBoard
  tier: ExamTier
  inScope: boolean
}

export interface Subtopic {
  id: SubtopicId
  topicId: TopicId
  label: string
  yearBand: YearBand
  /** null in seed content; Phase 1 populates. */
  difficultyTier: DifficultyTier | null
  /** [] until Phase 4. build-plan §4's `board_scope`. §3.10. */
  boardScope: readonly BoardScope[]
  aliases: readonly SubtopicId[]
  source: ContentSource
  reviewedAt: string | null
  status: ContentStatus
}

/** One (source, confidence) assessment of an edge, with its evidence base. */
export interface PrereqEdgeEvidence {
  source: PrereqEdgeSource
  confidence: number
  /** Sample size, for an empirical assessment. */
  n?: number
  /** ISO-8601 date this assessment was made. */
  at?: string
}

export interface PrereqEdge<Id extends string = string> {
  from: Id
  to: Id
  /** 0..1. How strongly `to` depends on `from`. */
  strength: number
  /** The current best assessment. */
  source: PrereqEdgeSource
  /** 0..1. Confidence in the edge itself, per build-plan §1.4. */
  confidence: number
  /**
   * Append-only history. build-plan §1.4 applies three verification sources at
   * different times (AI now, teacher ~week 18, empirical in year two); the
   * year-two pass must not destroy the teacher's provenance to record its own.
   * Absent on all 17 seed edges.
   */
  evidence?: readonly PrereqEdgeEvidence[]
}
export type TopicPrereqEdge = PrereqEdge<TopicId>
export type SubtopicPrereqEdge = PrereqEdge<SubtopicId>

export interface GraphFilter {
  id: GraphFilterId
  label: string
  topicIds: readonly TopicId[]
}

export interface QuestionLine {
  /** Rendered source. Plain Unicode maths today, not LaTeX. See §3.7. */
  text: string
  /** The "why" for this step. '' where the original solNotes entry was empty. */
  note: string
  /**
   * The prerequisite subtopics this line of working tests. The field the
   * product sells: it turns "student flagged line 3" into a named gap.
   * PLURAL — a line routinely tests more than one prerequisite, and widening
   * after generation is a rewrite of ~1.3M rows. Empty array, never null.
   * Every entry must satisfy validator rule E_ANCESTRY (§8.5 rule 9).
   */
  prereqSubtopicIds: readonly SubtopicId[]
}

/** A wrong answer plus the misconception it traces to. build-plan §2.6 gate 4. */
export interface Distractor {
  text: string
  /** Named misconception. Never ''. Seed values are §2.8's table. */
  cause: string
}

export interface Question {
  id: QuestionId
  /** Denormalised parent of subtopicId. Validator enforces agreement. */
  topicId: TopicId
  subtopicId: SubtopicId
  /** Scoped within subtopicId, not globally unique in principle. See §3.5. */
  familyId: FamilyId
  difficulty: DifficultyTier
  prompt: string
  statement: string
  answerLabel: string
  correctAnswer: string
  lines: readonly QuestionLine[]
  /** Index into `lines` of the step students typically get wrong. */
  errorLineIndex: number
  /**
   * Three plausible wrong answers for the MCQ confidence-rebuild retry.
   * ABSENT (not [], not null) when the question has none — PracticeLoop's
   * `mcq` path falls back to free-typed input on absence.
   */
  distractors?: readonly Distractor[]
  /** build-plan §4's `board_style`. null until Phase 4. §3.10. */
  boardStyle: string | null
  aliases: readonly QuestionId[]
  source: ContentSource
  reviewedAt: string | null
  status: ContentStatus
}

export type ReteachScope = 'Focused re-teach' | 'Quick reminder' | 'Full walk-back' | 'No re-teach needed'

/**
 * Authored re-teach content. NOT the same thing as reteach.ts's `ReteachCard`,
 * which is a view model with CSSProperties on it. Empty in seed content;
 * buildReteach() synthesises today and consults this store first (§6.10).
 */
export interface ReteachCardContent {
  questionId: QuestionId
  lineIndex: number | 'all'
  scope: ReteachScope
  heading: string
  body: readonly string[]
  workedExample: readonly string[] | null
}

// ---------------------------------------------------------------------------
// Lessons — authored form, then the hydrated form the store returns
// ---------------------------------------------------------------------------
export interface TransferIn { hook: string; body: readonly string[] }
export interface TransferOut { prompt: string; placeholder?: string }
export interface TeachBlock {
  heading: string
  body: readonly string[]
  exampleTitle?: string
  exampleSteps?: readonly string[]
}

export interface LessonPrerequisiteContent {
  subtopicId: SubtopicId
  transferIn?: TransferIn
  teach: TeachBlock
  transferOut?: TransferOut
}

export interface LessonContent {
  topicId: TopicId
  prerequisites: readonly LessonPrerequisiteContent[]
}

/**
 * Hydrated by the store. What LessonSession.tsx consumes.
 * NOTE: there is deliberately no `checkProblems` here. It was a bank-wide join
 * performed at store-build time; the caller now calls
 * questionsForSubtopic(subtopicId) instead. See §3.12.
 */
export interface LessonPrerequisite extends LessonPrerequisiteContent {
  /** === subtopicId. Present because LessonSession keys React nodes on it. */
  id: SubtopicId
  /** === the subtopic's label. */
  label: string
}

export interface Lesson {
  topicId: TopicId
  /** === topicLabel(topicId). Was `Lesson.subtopic`. */
  topicLabel: string
  prerequisites: readonly LessonPrerequisite[]
}

// ---------------------------------------------------------------------------
// School
// ---------------------------------------------------------------------------
export interface Teacher {
  id: TeacherId
  name: string
  subject: string
  classIds: readonly ClassId[]
}

export interface SchoolClass {
  id: ClassId
  subject: string
  yearBand: YearBand
  teacherId: TeacherId
}

export interface ClassDefaults {
  roster: readonly string[]
  basket: readonly TopicId[]
}

// ---------------------------------------------------------------------------
// Sample (demo) data
// ---------------------------------------------------------------------------
export interface NodeStats { last: string; next: string; reps: number }

export interface SampleNodeState extends NodeStats {
  status: NodeStatus
}

export interface SampleStudentNodeStates {
  studentId: StudentId
  nodes: Readonly<Record<TopicId, SampleNodeState>>
}

export interface PaceRow {
  /** Display string, verbatim from the prototype. Was `PaceRow.topic`. */
  label: string
  /** null where the label names no topic (e.g. 'Ratio & proportion'). §2.14. */
  topicId: TopicId | null
  tag: string
  kind: 'ahead' | 'onpace' | 'behind'
  actual: number
  expected: number
}

export interface MasteryRow {
  /** Was `MasteryRow.name`. */
  label: string
  topicId: TopicId | null
  foundations: number
  core: number
  stretch: number
}

export interface WorkingOnNow {
  /** Was `WorkingOnNow.topic`. */
  label: string
  topicId: TopicId | null
  detail: string
  note: string
}

/**
 * The teacher-dashboard drill-down fixture for one sample student. This is
 * NOT build-plan §5.2's transferable profile — that document is
 * {student_id, graph_version, node_states[], mastery_by_topic,
 * activity_summary}, does not exist yet, and is recorded in §9.2 (D5).
 */
export interface StudentProfile {
  studentId: StudentId
  /** The class this student is on the roster for. */
  classId: string
  whereToStart: readonly string[]
  pace: readonly PaceRow[]
  mastery: readonly MasteryRow[]
  workingOnNow: WorkingOnNow
}

// Lift-and-shift from activityLog.ts / oversight.ts — field-for-field identical.
export interface LogQuestion {
  label: string
  q: string
  hit: boolean
  note: string
  work?: readonly string[]
  wrong?: readonly number[]
  why?: readonly string[]
}

export type LogKind = 'Review' | 'Problem set' | 'Lesson'

export interface LogActivity {
  kind: LogKind
  date: string
  title: string
  result: string
  flag: 'attention' | 'ok'
  summary: string
  detail: readonly string[]
  upload: boolean
  items: readonly LogQuestion[]
}

export interface StudentActivityLog {
  studentId: StudentId
  activities: readonly LogActivity[]
}

export type OversightKind = 'uncertain' | 'gaming' | 'probe'

export interface OversightDetail {
  kind: string
  title: string
  date: string
  result: string
  flag: 'attention' | 'ok'
  upload: boolean
  items: readonly LogQuestion[]
}

export interface OversightItem {
  kind: OversightKind
  student: string
  context: string
  title: string
  body: string
  asks: string
  detail: OversightDetail
}

// ---------------------------------------------------------------------------
// Derived / view types
// ---------------------------------------------------------------------------
/** A topic projected onto the graph. Shape-identical to the old KnowledgeNode. */
export interface GraphTopic {
  id: TopicId
  x: number
  y: number
  label: string
}

/** One group in the teacher-facing topic picker. Replaces CurriculumGroup. */
export interface CatalogueGroup {
  strandId: StrandId
  /** The strand label. Rendered as the group heading. */
  label: string
  /** Catalogue topics in this strand, in authored order. */
  topics: readonly Topic[]
}

/** Directed prerequisite pair. The tuple view of a TopicPrereqEdge. */
export type EdgePair = readonly [from: TopicId, to: TopicId]

/** Visual style per mastery status. Lives in theme.ts; declared here for reuse. */
export interface NodeStyle {
  fill: string
  stroke: string
  text: string
  sw: number
  dash: string
}

/** Visual style per Oversight kind. Lives in theme.ts; declared here for reuse. */
export interface OversightKindStyle {
  label: string
  color: string
  bg: string
  bd: string
}
