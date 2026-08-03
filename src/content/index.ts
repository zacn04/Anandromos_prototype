/**
 * The content store's public surface — §5.8.
 *
 * Everything outside `src/content/` imports from here (`'../content'`), never
 * from the individual modules. The one exemption: type-only imports of
 * `schema.ts` may be direct, which is what lets `src/theme.ts` write
 * `import type { NodeStatus, NodeStyle } from './content/schema'` without
 * taking a value dependency on the store.
 *
 * Deliberately NOT exported: `setStore`, `buildStore`, `createInMemoryBank`,
 * and everything in `validate.ts`. Those are construction and verification
 * details; a component that reaches for one is doing something wrong.
 */

// ---- the synchronous accessor surface (§5.6) ------------------------------
export * from './accessors'

// ---- SVG geometry for the knowledge graph (§5.7) --------------------------
export * from './graphGeometry'

// ---- the async seam (§5.2). Awaited exactly once, in main.tsx -------------
export { loadContent } from './load'

// ---- store lifecycle ------------------------------------------------------
export { isContentLoaded } from './store'
export type { ContentStore } from './store'

// ---- entity + id types (§5.3) ---------------------------------------------
export type {
  // ids
  StrandId,
  TopicId,
  SubtopicId,
  QuestionId,
  GraphFilterId,
  TeacherId,
  ClassId,
  StudentId,
  FamilyId,
  YearBand,
  // shared enums
  ContentStatus,
  ContentSource,
  DifficultyTier,
  MasteryTier,
  NodeStatus,
  PrereqEdgeSource,
  ExamBoard,
  ExamTier,
  // curriculum
  ContentMeta,
  Strand,
  TopicGraphPlacement,
  Topic,
  BoardScope,
  Subtopic,
  PrereqEdgeEvidence,
  PrereqEdge,
  TopicPrereqEdge,
  SubtopicPrereqEdge,
  GraphFilter,
  QuestionLine,
  Distractor,
  Question,
  ReteachScope,
  ReteachCardContent,
  // lessons
  TransferIn,
  TransferOut,
  TeachBlock,
  LessonPrerequisiteContent,
  LessonContent,
  LessonPrerequisite,
  Lesson,
  // school
  Teacher,
  SchoolClass,
  ClassDefaults,
  // samples
  NodeStats,
  SampleNodeState,
  SampleStudentNodeStates,
  PaceRow,
  MasteryRow,
  WorkingOnNow,
  StudentProfile,
  LogQuestion,
  LogKind,
  LogActivity,
  StudentActivityLog,
  OversightKind,
  OversightDetail,
  OversightItem,
  // derived / view types
  GraphTopic,
  CatalogueGroup,
  EdgePair,
  NodeStyle,
  OversightKindStyle,
} from './schema'
