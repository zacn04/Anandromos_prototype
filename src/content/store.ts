/**
 * The content store: the indexed, in-memory shape every synchronous accessor
 * reads. Implements §5.4 of `docs/content-schema-spec.md`.
 *
 * `buildStore` is pure — raw parsed bundle in, fully indexed store out, no I/O
 * and no globals. It indexes the CORE tier exhaustively and hands the BANK
 * tier straight to `createInMemoryBank()` without ever iterating it (§3.12),
 * which is what keeps store construction O(core) rather than O(320,000).
 *
 * The module singleton at the bottom is installed once by `loadContent()`.
 * `requireStore()` THROWS when it is missing; it never returns an empty store,
 * because a silently-empty store renders a blank knowledge graph and a
 * working-looking app — the worst possible failure mode for a demo.
 */
import type {
  CatalogueGroup,
  ClassDefaults,
  ClassId,
  ContentMeta,
  EdgePair,
  GraphFilter,
  GraphFilterId,
  GraphTopic,
  Lesson,
  LessonContent,
  LessonPrerequisite,
  LogActivity,
  OversightItem,
  PrereqEdge,
  SampleNodeState,
  SampleStudentNodeStates,
  SchoolClass,
  Strand,
  StrandId,
  StudentActivityLog,
  StudentId,
  StudentProfile,
  Subtopic,
  SubtopicId,
  SubtopicPrereqEdge,
  Teacher,
  TeacherId,
  Topic,
  TopicGraphPlacement,
  TopicId,
  TopicPrereqEdge,
} from './schema'
import type { QuestionBank, RawQuestionBank } from './bank'
import { createInMemoryBank } from './bank'

/**
 * Precomputed CORE lookups. Built once at load; every accessor below is O(1)
 * or O(k). Nothing here iterates the BANK tier.
 */
export interface ContentIndex {
  topicById: ReadonlyMap<TopicId, Topic>
  subtopicById: ReadonlyMap<SubtopicId, Subtopic>
  strandById: ReadonlyMap<StrandId, Strand>
  teacherById: ReadonlyMap<TeacherId, Teacher>
  classById: ReadonlyMap<ClassId, SchoolClass>
  graphFilterById: ReadonlyMap<GraphFilterId, GraphFilter>
  /**
   * Retired id → live id, for topics and subtopics. §1.6.
   *
   * Question aliases are NOT in here: they live inside the bank's own index,
   * because populating them at this level would mean iterating the BANK tier
   * at store-build time, which §3.12 forbids. `questionById()` still resolves
   * live ids first and then aliases, exactly as §5.6 specifies — the index is
   * simply owned by the entity that owns question identity. Empty on seed
   * content (every `aliases` array is `[]`), so the two readings are
   * behaviourally identical today.
   */
  aliasTo: ReadonlyMap<string, string>

  subtopicsByTopic: ReadonlyMap<TopicId, readonly Subtopic[]>

  /** Graph topics sorted by Topic.graph.order. Replaces NODES. §3.3. */
  graphTopics: readonly GraphTopic[]
  graphTopicById: ReadonlyMap<TopicId, GraphTopic>
  /** Topic-level edges as [from, to]. Replaces EDGES. Authored order. */
  edgePairs: readonly EdgePair[]
  /** Direct prerequisites of each topic, in edge-file order. */
  prereqsByTopic: ReadonlyMap<TopicId, readonly TopicId[]>
  /** Transitive topic-graph ancestors. Used by the validator, not the app. */
  ancestorsByTopic: ReadonlyMap<TopicId, ReadonlySet<TopicId>>
  /**
   * Transitive subtopic-graph ancestors. Empty today (the subtopic edge file
   * is empty); it is what §8.5 rule 9's tier-A ancestry check reads.
   */
  ancestorsBySubtopic: ReadonlyMap<SubtopicId, ReadonlySet<SubtopicId>>

  catalogueGroups: readonly CatalogueGroup[]
  lessonByTopic: ReadonlyMap<TopicId, Lesson>

  defaultBasket: Readonly<Record<TopicId, boolean>>
}

export interface ContentStore {
  meta: ContentMeta
  strands: readonly Strand[]
  topics: readonly Topic[]
  subtopics: readonly Subtopic[]
  topicEdges: readonly TopicPrereqEdge[]
  subtopicEdges: readonly SubtopicPrereqEdge[]
  graphFilters: readonly GraphFilter[]
  lessons: readonly LessonContent[]

  teachers: readonly Teacher[]
  classes: readonly SchoolClass[]
  classDefaults: ClassDefaults

  sampleNodeStates: Readonly<Record<StudentId, Readonly<Record<TopicId, SampleNodeState>>>>
  sampleProfiles: Readonly<Record<StudentId, StudentProfile>>
  sampleActivityLog: Readonly<Record<StudentId, readonly LogActivity[]>>
  sampleOversight: readonly OversightItem[]

  /** The BANK tier. The ONLY way to reach a question or a re-teach card. §3.12. */
  bank: QuestionBank

  index: ContentIndex
}

/**
 * Every CORE content file as parsed, before indexing. Field names match
 * §4.1's filenames; each holds the file's `items` array (or the whole object
 * for `meta` / `classDefaults`).
 */
export interface CoreBundle {
  meta: ContentMeta
  strands: readonly Strand[]
  topics: readonly Topic[]
  subtopics: readonly Subtopic[]
  topicEdges: readonly TopicPrereqEdge[]
  subtopicEdges: readonly SubtopicPrereqEdge[]
  graphFilters: readonly GraphFilter[]
  lessons: readonly LessonContent[]
  teachers: readonly Teacher[]
  classes: readonly SchoolClass[]
  classDefaults: ClassDefaults
  nodeStates: readonly SampleStudentNodeStates[]
  profiles: readonly StudentProfile[]
  activityLogs: readonly StudentActivityLog[]
  oversight: readonly OversightItem[]
}

/**
 * The ONLY type `load.ts` produces and the ONLY type `buildStore` consumes.
 * Two tiers, so the HTTP swap in §5.2 is `readBundle` plus one QuestionBank
 * implementation and nothing else.
 */
export interface RawContentBundle {
  core: CoreBundle
  bank: RawQuestionBank
}

// ---------------------------------------------------------------------------
// buildStore
// ---------------------------------------------------------------------------

/**
 * Transitive prerequisite ancestors over one prerequisite graph.
 *
 * Every id in `ids` gets an entry, even when it has no ancestors, so a caller
 * may write `ancestors.get(id).has(other)` without a null check — this repo has
 * no `strictNullChecks` to remind it (§9.2 D7). A cycle short-circuits rather
 * than recursing forever; `E_CYCLE` reports it offline, where it belongs.
 */
function buildAncestors<Id extends string>(
  ids: readonly Id[],
  edges: readonly PrereqEdge<Id>[],
): Map<Id, ReadonlySet<Id>> {
  const directPrereqs = new Map<Id, Id[]>()
  for (const edge of edges) {
    const bucket = directPrereqs.get(edge.to)
    if (bucket) bucket.push(edge.from)
    else directPrereqs.set(edge.to, [edge.from])
  }

  const memo = new Map<Id, Set<Id>>()
  const visiting = new Set<Id>()

  function walk(id: Id): Set<Id> {
    const done = memo.get(id)
    if (done) return done
    if (visiting.has(id)) return new Set<Id>()
    visiting.add(id)
    const acc = new Set<Id>()
    for (const parent of directPrereqs.get(id) ?? []) {
      acc.add(parent)
      for (const grandparent of walk(parent)) acc.add(grandparent)
    }
    visiting.delete(id)
    memo.set(id, acc)
    return acc
  }

  const out = new Map<Id, ReadonlySet<Id>>()
  for (const id of ids) out.set(id, walk(id))
  // Edge endpoints that name no authored entity still get an entry, so a
  // dangling reference degrades to "no ancestors" instead of a crash.
  for (const edge of edges) {
    if (!out.has(edge.from)) out.set(edge.from, walk(edge.from))
    if (!out.has(edge.to)) out.set(edge.to, walk(edge.to))
  }
  return out
}

/**
 * Pure: raw parsed bundle in, fully indexed store out. No I/O, no globals.
 * Indexes the CORE tier exhaustively; hands the BANK tier straight to
 * createInMemoryBank() and never iterates it.
 */
export function buildStore(bundle: RawContentBundle): ContentStore {
  const core = bundle.core

  const meta = core.meta
  const strands: readonly Strand[] = core.strands ?? []
  const topics: readonly Topic[] = core.topics ?? []
  const subtopics: readonly Subtopic[] = core.subtopics ?? []
  const topicEdges: readonly TopicPrereqEdge[] = core.topicEdges ?? []
  const subtopicEdges: readonly SubtopicPrereqEdge[] = core.subtopicEdges ?? []
  const graphFilters: readonly GraphFilter[] = core.graphFilters ?? []
  const lessons: readonly LessonContent[] = core.lessons ?? []
  const teachers: readonly Teacher[] = core.teachers ?? []
  const classes: readonly SchoolClass[] = core.classes ?? []
  const classDefaults: ClassDefaults = core.classDefaults ?? { roster: [], basket: [] }

  // ---- id indexes --------------------------------------------------------
  const topicById = new Map<TopicId, Topic>()
  for (const topic of topics) topicById.set(topic.id, topic)

  const subtopicById = new Map<SubtopicId, Subtopic>()
  for (const subtopic of subtopics) subtopicById.set(subtopic.id, subtopic)

  const strandById = new Map<StrandId, Strand>()
  for (const strand of strands) strandById.set(strand.id, strand)

  const teacherById = new Map<TeacherId, Teacher>()
  for (const teacher of teachers) teacherById.set(teacher.id, teacher)

  const classById = new Map<ClassId, SchoolClass>()
  for (const schoolClass of classes) classById.set(schoolClass.id, schoolClass)

  const graphFilterById = new Map<GraphFilterId, GraphFilter>()
  for (const filter of graphFilters) graphFilterById.set(filter.id, filter)

  // Retired ids that still resolve (§1.6). Resolution is always live-id-first
  // at the accessor, so an alias can never shadow a real entity even if one
  // slipped past E_ALIAS_COLLIDES.
  const aliasTo = new Map<string, string>()
  for (const topic of topics) {
    for (const alias of topic.aliases ?? []) aliasTo.set(alias, topic.id)
  }
  for (const subtopic of subtopics) {
    for (const alias of subtopic.aliases ?? []) aliasTo.set(alias, subtopic.id)
  }

  // ---- subtopics by topic, in authored order -----------------------------
  const subtopicsByTopic = new Map<TopicId, Subtopic[]>()
  for (const subtopic of subtopics) {
    const bucket = subtopicsByTopic.get(subtopic.topicId)
    if (bucket) bucket.push(subtopic)
    else subtopicsByTopic.set(subtopic.topicId, [subtopic])
  }

  // ---- the knowledge graph ------------------------------------------------
  // The ONE sanctioned sort in the whole store (§0.2, §3.3): graph draw order
  // is Topic.graph.order, deliberately decoupled from topics.json's catalogue
  // order. A topic needs BOTH onGraph and authored coordinates to be drawn —
  // onGraph alone is membership (§3.2), and a GraphTopic cannot be built
  // without x/y.
  const placedTopics: Array<{ id: TopicId; placement: TopicGraphPlacement }> = []
  for (const topic of topics) {
    if (!topic.onGraph || !topic.graph) continue
    placedTopics.push({ id: topic.id, placement: topic.graph })
  }
  placedTopics.sort((a, b) => a.placement.order - b.placement.order)
  const graphTopics: readonly GraphTopic[] = placedTopics.map((placed) => ({
    id: placed.id,
    x: placed.placement.x,
    y: placed.placement.y,
    label: placed.placement.label,
  }))

  const graphTopicById = new Map<TopicId, GraphTopic>()
  for (const node of graphTopics) graphTopicById.set(node.id, node)

  const edgePairs: readonly EdgePair[] = topicEdges.map((edge) => [edge.from, edge.to] as EdgePair)

  const prereqsByTopic = new Map<TopicId, TopicId[]>()
  for (const edge of topicEdges) {
    const bucket = prereqsByTopic.get(edge.to)
    if (bucket) bucket.push(edge.from)
    else prereqsByTopic.set(edge.to, [edge.from])
  }

  const ancestorsByTopic = buildAncestors(
    topics.map((topic) => topic.id),
    topicEdges,
  )
  const ancestorsBySubtopic = buildAncestors(
    subtopics.map((subtopic) => subtopic.id),
    subtopicEdges,
  )

  // ---- the teacher-facing catalogue --------------------------------------
  // One group per strand, in strand order, holding that strand's catalogue
  // topics in topics.json order. A strand with no catalogue topics still gets
  // its (empty) group: no accessor filters beyond what its name says, and both
  // render call sites already drop empty groups after their own search filter.
  const catalogueTopicsByStrand = new Map<StrandId, Topic[]>()
  for (const topic of topics) {
    if (!topic.catalogue) continue
    const bucket = catalogueTopicsByStrand.get(topic.strandId)
    if (bucket) bucket.push(topic)
    else catalogueTopicsByStrand.set(topic.strandId, [topic])
  }
  const catalogueGroups: readonly CatalogueGroup[] = strands.map((strand) => ({
    strandId: strand.id,
    label: strand.label,
    topics: catalogueTopicsByStrand.get(strand.id) ?? [],
  }))

  // ---- lesson hydration (§5.4) -------------------------------------------
  // topicLabel from the topic; per prerequisite, id (= subtopicId) and label
  // (= the subtopic's label). Deliberately no `checkProblems`: that was a
  // bank-wide join at store-build time, and the caller now asks the bank
  // directly via questionsForSubtopic() (§3.12).
  const lessonByTopic = new Map<TopicId, Lesson>()
  for (const lesson of lessons) {
    const topic = topicById.get(lesson.topicId)
    const prerequisites: readonly LessonPrerequisite[] = (lesson.prerequisites ?? []).map(
      (prereq) => {
        const subtopic = subtopicById.get(prereq.subtopicId)
        return {
          ...prereq,
          id: prereq.subtopicId,
          label: subtopic ? subtopic.label : prereq.subtopicId,
        }
      },
    )
    lessonByTopic.set(lesson.topicId, {
      topicId: lesson.topicId,
      topicLabel: topic ? topic.label : lesson.topicId,
      prerequisites,
    })
  }

  // ---- class-setup defaults ----------------------------------------------
  // Authored as an id array (every value in the old Record was `true`); the
  // Record shape the class-setup screen spreads is rebuilt here, once.
  const defaultBasket: Record<TopicId, boolean> = {}
  for (const topicId of classDefaults.basket ?? []) defaultBasket[topicId] = true

  // ---- sample (demo) fixtures --------------------------------------------
  // Keyed by studentId, insertion order = authored file order, which is what
  // sampleStudentIds() reads back.
  const sampleNodeStates: Record<StudentId, Readonly<Record<TopicId, SampleNodeState>>> = {}
  for (const row of core.nodeStates ?? []) sampleNodeStates[row.studentId] = row.nodes ?? {}

  const sampleProfiles: Record<StudentId, StudentProfile> = {}
  for (const profile of core.profiles ?? []) sampleProfiles[profile.studentId] = profile

  const sampleActivityLog: Record<StudentId, readonly LogActivity[]> = {}
  for (const log of core.activityLogs ?? []) sampleActivityLog[log.studentId] = log.activities ?? []

  const index: ContentIndex = {
    topicById,
    subtopicById,
    strandById,
    teacherById,
    classById,
    graphFilterById,
    aliasTo,
    subtopicsByTopic,
    graphTopics,
    graphTopicById,
    edgePairs,
    prereqsByTopic,
    ancestorsByTopic,
    ancestorsBySubtopic,
    catalogueGroups,
    lessonByTopic,
    defaultBasket,
  }

  return {
    meta,
    strands,
    topics,
    subtopics,
    topicEdges,
    subtopicEdges,
    graphFilters,
    lessons,
    teachers,
    classes,
    classDefaults,
    sampleNodeStates,
    sampleProfiles,
    sampleActivityLog,
    sampleOversight: core.oversight ?? [],
    bank: createInMemoryBank(bundle.bank),
    index,
  }
}

// ---------------------------------------------------------------------------
// The module singleton
// ---------------------------------------------------------------------------

let installed: ContentStore | null = null

/** Internal: called by loadContent(). Not exported from index.ts. */
export function setStore(store: ContentStore): void {
  installed = store
}

/** True once loadContent() has resolved. */
export function isContentLoaded(): boolean {
  return installed !== null
}

/**
 * Throws if loadContent() has not resolved. Message names the fix.
 *
 * It throws rather than returning an empty store on purpose: an empty store
 * renders a blank knowledge graph inside an otherwise working-looking app,
 * which is a demo failure nobody notices until it is on a projector. A thrown
 * error surfaces on the first render and is unmissable. The usual cause is a
 * module-scope accessor call — see §6.12: ES imports are hoisted, so every
 * module-scope statement in the app runs BEFORE main.tsx awaits loadContent().
 */
export function requireStore(): ContentStore {
  if (!installed) {
    throw new Error(
      'Anadromos content store not loaded. main.tsx must `await loadContent()` before rendering. (Called from a synchronous accessor.)',
    )
  }
  return installed
}
