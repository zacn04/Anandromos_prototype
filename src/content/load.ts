/**
 * THE ASYNC SEAM. This is the only module in the repo that knows how content
 * files are read — §5.2 of `docs/content-schema-spec.md`.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ THE FUTURE HTTP SWAP IS `readBundle` PLUS ONE QuestionBank            │
 * │ IMPLEMENTATION, AND NOTHING ELSE.                                     │
 * │                                                                       │
 * │ CORE tier: replace each `import()` below with                         │
 * │   fetch(`${BASE}/curriculum/topics`).then(r => r.json())              │
 * │ and keep the return type identical.                                   │
 * │ BANK tier: replace `createInMemoryBank(bundle.bank)` (called inside   │
 * │   buildStore) with a fetch-and-cache implementation of the same       │
 * │   `QuestionBank` interface — §3.12, and §4.2's topic-keyed shards.    │
 * │                                                                       │
 * │ No other file in the repo changes, and no accessor signature changes. │
 * │ That is the entire point of the seam: do NOT leak `import()` or       │
 * │ `fetch` into any other module.                                        │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Async at the loader, synchronous at every call site below it (constraint 2).
 * `main.tsx` awaits this exactly once, before the first render.
 */
import type {
  ClassDefaults,
  ContentMeta,
  GraphFilter,
  LessonContent,
  OversightItem,
  Question,
  ReteachCardContent,
  SampleStudentNodeStates,
  SchoolClass,
  Strand,
  StudentActivityLog,
  StudentProfile,
  Subtopic,
  SubtopicPrereqEdge,
  Teacher,
  Topic,
  TopicPrereqEdge,
} from './schema'
import type { ContentStore, RawContentBundle } from './store'
import type { QuestionTemplate } from './template'
import { buildStore, isContentLoaded, requireStore, setStore } from './store'
import {
  CONTENT_SOURCES,
  CONTENT_STATUSES,
  DIFFICULTY_TIERS,
  NODE_STATUSES,
  PREREQ_EDGE_SOURCES,
  RETEACH_SCOPES,
  SCHEMA_VERSION,
  isArray,
  isBoolean,
  isFiniteNumber,
  isInteger,
  isIsoDateOrNull,
  isNonEmptyString,
  isPlainObject,
  isString,
  isStringArray,
  isUnitInterval,
  oneOf,
} from './validate.ts'

// ---------------------------------------------------------------------------
// Reading the files
// ---------------------------------------------------------------------------

/**
 * `resolveJsonModule` types a JSON import from its literal contents, which
 * widens every union to `string` (`status: string`, not `ContentStatus`) — so
 * parsed values are cast to the declared entity types rather than checked by
 * `tsc`. That is deliberate and it is not a hole: `npm run validate:content`
 * checks the files exhaustively offline and `npm run build` gates on it, and
 * `assertContentBundle` below re-checks structure in dev. §5.5.
 */
function itemsOf<T>(mod: { default: unknown }): readonly T[] {
  const envelope = mod.default as { items?: readonly T[] } | undefined
  return envelope?.items ?? []
}

/** For the two files that carry no `items` envelope: meta.json, class-defaults.json. */
function objectOf<T>(mod: { default: unknown }): T {
  return mod.default as T
}

/**
 * Reads all 17 content files (§4.1). Dynamic JSON imports today, so Vite
 * code-splits them into their own chunk; `fetch()` tomorrow.
 */
async function readBundle(): Promise<RawContentBundle> {
  const [
    meta,
    strands,
    topics,
    subtopics,
    topicEdges,
    subtopicEdges,
    graphFilters,
    lessons,
    questions,
    reteachCards,
    questionTemplates,
    teachers,
    classes,
    classDefaults,
    nodeStates,
    profiles,
    activityLogs,
    oversight,
  ] = await Promise.all([
    import('../../content/curriculum/meta.json'),
    import('../../content/curriculum/strands.json'),
    import('../../content/curriculum/topics.json'),
    import('../../content/curriculum/subtopics.json'),
    import('../../content/curriculum/prereq-edges.topic.json'),
    import('../../content/curriculum/prereq-edges.subtopic.json'),
    import('../../content/curriculum/graph-filters.json'),
    import('../../content/curriculum/lessons.json'),
    import('../../content/curriculum/questions.json'),
    import('../../content/curriculum/reteach-cards.json'),
    import('../../content/curriculum/question-templates.json'),
    import('../../content/school/teachers.json'),
    import('../../content/school/classes.json'),
    import('../../content/school/class-defaults.json'),
    import('../../content/samples/node-states.json'),
    import('../../content/samples/student-profiles.json'),
    import('../../content/samples/activity-log.json'),
    import('../../content/samples/oversight.json'),
  ])

  return {
    core: {
      meta: objectOf<ContentMeta>(meta),
      strands: itemsOf<Strand>(strands),
      topics: itemsOf<Topic>(topics),
      subtopics: itemsOf<Subtopic>(subtopics),
      topicEdges: itemsOf<TopicPrereqEdge>(topicEdges),
      subtopicEdges: itemsOf<SubtopicPrereqEdge>(subtopicEdges),
      graphFilters: itemsOf<GraphFilter>(graphFilters),
      lessons: itemsOf<LessonContent>(lessons),
      teachers: itemsOf<Teacher>(teachers),
      classes: itemsOf<SchoolClass>(classes),
      classDefaults: objectOf<ClassDefaults>(classDefaults),
      nodeStates: itemsOf<SampleStudentNodeStates>(nodeStates),
      profiles: itemsOf<StudentProfile>(profiles),
      activityLogs: itemsOf<StudentActivityLog>(activityLogs),
      oversight: itemsOf<OversightItem>(oversight),
    },
    bank: {
      questions: itemsOf<Question>(questions),
      reteachCards: itemsOf<ReteachCardContent>(reteachCards),
      templates: itemsOf<QuestionTemplate>(questionTemplates),
    },
  }
}

// ---------------------------------------------------------------------------
// Dev-only structural check (§5.5)
// ---------------------------------------------------------------------------
// Required fields present, enum members valid, array lengths sane. No graph
// algorithms: the expensive structural checks already ran offline in
// `npm run validate:content`, which `npm run build` gates on. The CORE tier is
// checked exhaustively; the BANK tier by spot-check only (it is an array, and
// its first and last item are structurally valid), so this stays O(1) in bank
// size and still costs nothing at 320,000 questions.
//
// Predicates come from `validate.ts`, which the offline CLI imports too — one
// implementation, so the browser and the CLI can never disagree about what a
// valid row looks like (§8.1). In a production build `import.meta.env.DEV` is
// statically false, so this whole section and its import are eliminated.

type Report = (where: string, what: string) => void

function readArray(where: string, value: unknown, bad: Report): readonly unknown[] {
  if (!isArray(value)) {
    bad(where, 'expected an array')
    return []
  }
  return value
}

/** Runs `check` over every plain-object item, reporting non-objects itself. */
function eachRow(
  where: string,
  value: unknown,
  bad: Report,
  check: (row: Record<string, unknown>, at: string) => void,
): void {
  const rows = readArray(where, value, bad)
  for (let i = 0; i < rows.length; i++) {
    const at = `${where}[${i}]`
    const row = rows[i]
    if (!isPlainObject(row)) {
      bad(at, 'expected an object')
      continue
    }
    check(row, at)
  }
}

/** id / label / status / source / reviewedAt / aliases — shared by three entities. */
function checkAuthored(row: Record<string, unknown>, at: string, bad: Report): void {
  if (!isNonEmptyString(row.id)) bad(at, '`id` must be a non-empty string')
  if (!isNonEmptyString(row.label)) bad(at, '`label` must be a non-empty string')
  if (!isStringArray(row.aliases)) bad(at, '`aliases` must be an array of strings')
  if (!oneOf(row.source, CONTENT_SOURCES)) bad(at, `\`source\` must be one of ${CONTENT_SOURCES.join(' | ')}`)
  if (!isIsoDateOrNull(row.reviewedAt)) bad(at, '`reviewedAt` must be an ISO date (YYYY-MM-DD) or null')
  if (!oneOf(row.status, CONTENT_STATUSES)) bad(at, `\`status\` must be one of ${CONTENT_STATUSES.join(' | ')}`)
}

function checkEdges(where: string, value: unknown, bad: Report): void {
  eachRow(where, value, bad, (row, at) => {
    if (!isNonEmptyString(row.from)) bad(at, '`from` must be a non-empty id')
    if (!isNonEmptyString(row.to)) bad(at, '`to` must be a non-empty id')
    if (!isUnitInterval(row.strength)) bad(at, '`strength` must be a number in 0..1')
    if (!isUnitInterval(row.confidence)) bad(at, '`confidence` must be a number in 0..1')
    if (!oneOf(row.source, PREREQ_EDGE_SOURCES)) {
      bad(at, `\`source\` must be one of ${PREREQ_EDGE_SOURCES.join(' | ')}`)
    }
  })
}

function checkQuestion(row: Record<string, unknown>, at: string, bad: Report): void {
  if (!isNonEmptyString(row.id)) bad(at, '`id` must be a non-empty string')
  if (!isNonEmptyString(row.topicId)) bad(at, '`topicId` must be a non-empty id')
  if (!isNonEmptyString(row.subtopicId)) bad(at, '`subtopicId` must be a non-empty id')
  if (!isNonEmptyString(row.familyId)) bad(at, '`familyId` must be a non-empty slug')
  if (!oneOf(row.difficulty, DIFFICULTY_TIERS)) {
    bad(at, `\`difficulty\` must be one of ${DIFFICULTY_TIERS.join(' | ')}`)
  }
  if (!isString(row.prompt)) bad(at, '`prompt` must be a string')
  if (!isString(row.statement)) bad(at, '`statement` must be a string')
  if (!isString(row.answerLabel)) bad(at, '`answerLabel` must be a string (may be empty)')
  if (!isString(row.correctAnswer)) bad(at, '`correctAnswer` must be a string')
  if (!isString(row.boardStyle) && row.boardStyle !== null) bad(at, '`boardStyle` must be a string or null')
  if (!isStringArray(row.aliases)) bad(at, '`aliases` must be an array of strings')
  if (!oneOf(row.source, CONTENT_SOURCES)) bad(at, `\`source\` must be one of ${CONTENT_SOURCES.join(' | ')}`)
  if (!isIsoDateOrNull(row.reviewedAt)) bad(at, '`reviewedAt` must be an ISO date or null')
  if (!oneOf(row.status, CONTENT_STATUSES)) bad(at, `\`status\` must be one of ${CONTENT_STATUSES.join(' | ')}`)

  const lines = readArray(`${at}.lines`, row.lines, bad)
  if (lines.length === 0) bad(at, '`lines` must not be empty')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!isPlainObject(line)) {
      bad(`${at}.lines[${i}]`, 'expected an object')
      continue
    }
    if (!isString(line.text)) bad(`${at}.lines[${i}]`, '`text` must be a string')
    if (!isString(line.note)) bad(`${at}.lines[${i}]`, '`note` must be a string (may be empty)')
    if (!isStringArray(line.prereqSubtopicIds)) {
      bad(`${at}.lines[${i}]`, '`prereqSubtopicIds` must be an array of subtopic ids (never null)')
    }
  }
  if (!isInteger(row.errorLineIndex) || row.errorLineIndex < 0 || row.errorLineIndex >= lines.length) {
    bad(at, `\`errorLineIndex\` must be an integer in 0..${lines.length - 1}`)
  }

  // Absent is correct for a question with no distractors — PracticeLoop's mcq
  // path keys on absence, so `[]` and `null` are both wrong here (§3.8).
  if (row.distractors !== undefined) {
    const distractors = readArray(`${at}.distractors`, row.distractors, bad)
    if (distractors.length < 3) bad(at, '`distractors`, when present, needs at least 3 entries')
    for (let i = 0; i < distractors.length; i++) {
      const distractor = distractors[i]
      if (!isPlainObject(distractor)) {
        bad(`${at}.distractors[${i}]`, 'expected { text, cause }')
        continue
      }
      if (!isString(distractor.text)) bad(`${at}.distractors[${i}]`, '`text` must be a string')
      if (!isString(distractor.cause)) bad(`${at}.distractors[${i}]`, '`cause` must be a string')
    }
  }
}

function checkReteachCard(row: Record<string, unknown>, at: string, bad: Report): void {
  if (!isNonEmptyString(row.questionId)) bad(at, '`questionId` must be a non-empty id')
  if (row.lineIndex !== 'all' && !isInteger(row.lineIndex)) bad(at, "`lineIndex` must be an integer or 'all'")
  if (!oneOf(row.scope, RETEACH_SCOPES)) bad(at, `\`scope\` must be one of ${RETEACH_SCOPES.join(' | ')}`)
  if (!isNonEmptyString(row.heading)) bad(at, '`heading` must be a non-empty string')
  if (!isStringArray(row.body)) bad(at, '`body` must be an array of strings')
  if (row.workedExample !== null && !isStringArray(row.workedExample)) {
    bad(at, '`workedExample` must be an array of strings or null')
  }
}

/** Spot-check only: first and last row. O(1) in bank size, by design. */
function spotCheck(
  where: string,
  value: unknown,
  bad: Report,
  check: (row: Record<string, unknown>, at: string) => void,
): void {
  const rows = readArray(where, value, bad)
  if (rows.length === 0) return
  for (const i of rows.length === 1 ? [0] : [0, rows.length - 1]) {
    const at = `${where}[${i}]`
    const row = rows[i]
    if (!isPlainObject(row)) {
      bad(at, 'expected an object')
      continue
    }
    check(row, at)
  }
}

/**
 * Dev-only. Throws with every problem it found, so one reload names the whole
 * list rather than the first line of it.
 */
function assertContentBundle(bundle: RawContentBundle): void {
  const problems: string[] = []
  const bad: Report = (where, what) => {
    problems.push(`${where} — ${what}`)
  }

  if (!isPlainObject(bundle) || !isPlainObject(bundle.core) || !isPlainObject(bundle.bank)) {
    throw new Error('Anadromos content bundle is not { core, bank } — the loader is mis-wired.')
  }
  const core = bundle.core

  // ---- meta --------------------------------------------------------------
  const meta = core.meta as unknown
  if (!isPlainObject(meta)) {
    bad('meta.json', 'expected an object')
  } else {
    if (meta.schemaVersion !== SCHEMA_VERSION) bad('meta.json', `\`schemaVersion\` must be ${SCHEMA_VERSION}`)
    if (!isNonEmptyString(meta.contentVersion)) bad('meta.json', '`contentVersion` must be a non-empty string')
    if (!isNonEmptyString(meta.topicGraphVersion)) bad('meta.json', '`topicGraphVersion` must be a non-empty string')
    if (!isNonEmptyString(meta.subtopicGraphVersion)) {
      bad('meta.json', '`subtopicGraphVersion` must be a non-empty string')
    }
    if (!isPlainObject(meta.graphHashes) || !isString(meta.graphHashes.topic) || !isString(meta.graphHashes.subtopic)) {
      bad('meta.json', '`graphHashes` must be { topic: string, subtopic: string }')
    }
    if (!isStringArray(meta.yearBands) || meta.yearBands.length === 0) {
      bad('meta.json', '`yearBands` must be a non-empty array of strings')
    }
  }

  // ---- curriculum (CORE, exhaustive) -------------------------------------
  eachRow('strands.json', core.strands, bad, (row, at) => {
    if (!isNonEmptyString(row.id)) bad(at, '`id` must be a non-empty string')
    if (!isNonEmptyString(row.label)) bad(at, '`label` must be a non-empty string')
  })
  if (isArray(core.strands) && core.strands.length === 0) bad('strands.json', 'is empty')

  eachRow('topics.json', core.topics, bad, (row, at) => {
    checkAuthored(row, at, bad)
    if (!isNonEmptyString(row.strandId)) bad(at, '`strandId` must be a non-empty id')
    if (!isNonEmptyString(row.yearBand)) bad(at, '`yearBand` must be a non-empty string')
    if (!isBoolean(row.catalogue)) bad(at, '`catalogue` must be a boolean')
    if (!isBoolean(row.onGraph)) bad(at, '`onGraph` must be a boolean')
    if (row.graph !== null) {
      if (!isPlainObject(row.graph)) {
        bad(at, '`graph` must be { order, x, y, label } or null')
      } else {
        if (!isInteger(row.graph.order) || row.graph.order < 1) bad(at, '`graph.order` must be an integer >= 1')
        if (!isFiniteNumber(row.graph.x)) bad(at, '`graph.x` must be a number')
        if (!isFiniteNumber(row.graph.y)) bad(at, '`graph.y` must be a number')
        if (!isNonEmptyString(row.graph.label)) bad(at, '`graph.label` must be authored, even when it equals `label`')
      }
      if (row.onGraph === false) bad(at, 'has `graph` coordinates but `onGraph: false` (E_GRAPH_PLACEMENT_ORPHAN)')
    }
  })
  if (isArray(core.topics) && core.topics.length === 0) bad('topics.json', 'is empty')

  eachRow('subtopics.json', core.subtopics, bad, (row, at) => {
    checkAuthored(row, at, bad)
    if (!isNonEmptyString(row.topicId)) bad(at, '`topicId` must be a non-empty id')
    if (!isNonEmptyString(row.yearBand)) bad(at, '`yearBand` must be a non-empty string')
    if (row.difficultyTier !== null && !oneOf(row.difficultyTier, DIFFICULTY_TIERS)) {
      bad(at, `\`difficultyTier\` must be null or one of ${DIFFICULTY_TIERS.join(' | ')}`)
    }
    readArray(`${at}.boardScope`, row.boardScope, bad)
  })

  checkEdges('prereq-edges.topic.json', core.topicEdges, bad)
  checkEdges('prereq-edges.subtopic.json', core.subtopicEdges, bad)

  eachRow('graph-filters.json', core.graphFilters, bad, (row, at) => {
    if (!isNonEmptyString(row.id)) bad(at, '`id` must be a non-empty string')
    if (!isNonEmptyString(row.label)) bad(at, '`label` must be a non-empty string')
    if (!isStringArray(row.topicIds)) bad(at, '`topicIds` must be an array of topic ids')
  })

  eachRow('lessons.json', core.lessons, bad, (row, at) => {
    if (!isNonEmptyString(row.topicId)) bad(at, '`topicId` must be a non-empty id')
    eachRow(`${at}.prerequisites`, row.prerequisites, bad, (prereq, prereqAt) => {
      if (!isNonEmptyString(prereq.subtopicId)) bad(prereqAt, '`subtopicId` must be a non-empty id')
      if (!isPlainObject(prereq.teach)) bad(prereqAt, '`teach` must be an object')
      else if (!isNonEmptyString(prereq.teach.heading)) bad(prereqAt, '`teach.heading` must be a non-empty string')
    })
  })

  // ---- school (CORE, exhaustive) -----------------------------------------
  eachRow('teachers.json', core.teachers, bad, (row, at) => {
    if (!isNonEmptyString(row.id)) bad(at, '`id` must be a non-empty string')
    if (!isNonEmptyString(row.name)) bad(at, '`name` must be a non-empty string')
    if (!isNonEmptyString(row.subject)) bad(at, '`subject` must be a non-empty string')
    if (!isStringArray(row.classIds)) bad(at, '`classIds` must be an array of class ids')
  })

  eachRow('classes.json', core.classes, bad, (row, at) => {
    if (!isNonEmptyString(row.id)) bad(at, '`id` must be a non-empty string')
    if (!isNonEmptyString(row.subject)) bad(at, '`subject` must be a non-empty string')
    if (!isNonEmptyString(row.yearBand)) bad(at, '`yearBand` must be a non-empty string')
    if (!isNonEmptyString(row.teacherId)) bad(at, '`teacherId` must be a non-empty id')
  })

  const classDefaults = core.classDefaults as unknown
  if (!isPlainObject(classDefaults)) {
    bad('class-defaults.json', 'expected an object')
  } else {
    if (!isStringArray(classDefaults.roster)) bad('class-defaults.json', '`roster` must be an array of names')
    if (!isStringArray(classDefaults.basket)) bad('class-defaults.json', '`basket` must be an array of topic ids')
  }

  // ---- samples (CORE, exhaustive) ----------------------------------------
  eachRow('node-states.json', core.nodeStates, bad, (row, at) => {
    if (!isNonEmptyString(row.studentId)) bad(at, '`studentId` must be a non-empty id')
    if (!isPlainObject(row.nodes)) {
      bad(at, '`nodes` must be an object keyed by topic id')
      return
    }
    for (const topicId of Object.keys(row.nodes)) {
      const state = row.nodes[topicId]
      const stateAt = `${at}.nodes.${topicId}`
      if (!isPlainObject(state)) {
        bad(stateAt, 'expected { status, last, next, reps }')
        continue
      }
      if (!oneOf(state.status, NODE_STATUSES)) bad(stateAt, `\`status\` must be one of ${NODE_STATUSES.join(' | ')}`)
      if (!isString(state.last)) bad(stateAt, '`last` must be a string')
      if (!isString(state.next)) bad(stateAt, '`next` must be a string')
      if (!isInteger(state.reps)) bad(stateAt, '`reps` must be an integer')
    }
  })

  eachRow('student-profiles.json', core.profiles, bad, (row, at) => {
    if (!isNonEmptyString(row.studentId)) bad(at, '`studentId` must be a non-empty id')
    if (!isStringArray(row.whereToStart)) bad(at, '`whereToStart` must be an array of strings')
    eachRow(`${at}.pace`, row.pace, bad, (pace, paceAt) => {
      if (!isNonEmptyString(pace.label)) bad(paceAt, '`label` must be a non-empty string')
      if (pace.topicId !== null && !isNonEmptyString(pace.topicId)) bad(paceAt, '`topicId` must be an id or null')
      if (!isString(pace.tag)) bad(paceAt, '`tag` must be a string')
      if (!oneOf(pace.kind, ['ahead', 'onpace', 'behind'] as const)) {
        bad(paceAt, '`kind` must be one of ahead | onpace | behind')
      }
      if (!isFiniteNumber(pace.actual)) bad(paceAt, '`actual` must be a number')
      if (!isFiniteNumber(pace.expected)) bad(paceAt, '`expected` must be a number')
    })
    eachRow(`${at}.mastery`, row.mastery, bad, (mastery, masteryAt) => {
      if (!isNonEmptyString(mastery.label)) bad(masteryAt, '`label` must be a non-empty string')
      if (mastery.topicId !== null && !isNonEmptyString(mastery.topicId)) {
        bad(masteryAt, '`topicId` must be an id or null')
      }
      if (!isFiniteNumber(mastery.foundations)) bad(masteryAt, '`foundations` must be a number')
      if (!isFiniteNumber(mastery.core)) bad(masteryAt, '`core` must be a number')
      if (!isFiniteNumber(mastery.stretch)) bad(masteryAt, '`stretch` must be a number')
    })
    if (!isPlainObject(row.workingOnNow)) {
      bad(at, '`workingOnNow` must be an object')
    } else {
      if (!isNonEmptyString(row.workingOnNow.label)) bad(at, '`workingOnNow.label` must be a non-empty string')
      if (row.workingOnNow.topicId !== null && !isNonEmptyString(row.workingOnNow.topicId)) {
        bad(at, '`workingOnNow.topicId` must be an id or null')
      }
    }
  })

  eachRow('activity-log.json', core.activityLogs, bad, (row, at) => {
    if (!isNonEmptyString(row.studentId)) bad(at, '`studentId` must be a non-empty id')
    eachRow(`${at}.activities`, row.activities, bad, (activity, activityAt) => {
      if (!oneOf(activity.kind, ['Review', 'Problem set', 'Lesson', 'Free play'] as const)) {
        bad(activityAt, '`kind` must be one of Review | Problem set | Lesson | Free play')
      }
      if (!isString(activity.date)) bad(activityAt, '`date` must be a string')
      if (!isString(activity.title)) bad(activityAt, '`title` must be a string')
      if (!isString(activity.result)) bad(activityAt, '`result` must be a string')
      if (!oneOf(activity.flag, ['attention', 'ok'] as const)) bad(activityAt, '`flag` must be attention | ok')
      if (!isString(activity.summary)) bad(activityAt, '`summary` must be a string')
      if (!isStringArray(activity.detail)) bad(activityAt, '`detail` must be an array of strings')
      if (!isBoolean(activity.upload)) bad(activityAt, '`upload` must be a boolean')
      readArray(`${activityAt}.items`, activity.items, bad)
    })
  })

  eachRow('oversight.json', core.oversight, bad, (row, at) => {
    if (!oneOf(row.kind, ['uncertain', 'gaming', 'probe'] as const)) {
      bad(at, '`kind` must be one of uncertain | gaming | probe')
    }
    if (!isNonEmptyString(row.student)) bad(at, '`student` must be a non-empty string')
    if (!isString(row.context)) bad(at, '`context` must be a string')
    if (!isNonEmptyString(row.title)) bad(at, '`title` must be a non-empty string')
    if (!isString(row.body)) bad(at, '`body` must be a string')
    if (!isString(row.asks)) bad(at, '`asks` must be a string')
    if (!isPlainObject(row.detail)) bad(at, '`detail` must be an object')
  })

  // ---- BANK tier (spot-check only) ---------------------------------------
  spotCheck('questions.json', bundle.bank.questions, bad, (row, at) => checkQuestion(row, at, bad))
  spotCheck('reteach-cards.json', bundle.bank.reteachCards, bad, (row, at) => checkReteachCard(row, at, bad))

  if (problems.length > 0) {
    const shown = problems.slice(0, 25)
    const more = problems.length - shown.length
    throw new Error(
      `Anadromos content failed its dev structural check (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
        shown.map((problem) => `  ${problem}`).join('\n') +
        (more > 0 ? `\n  …and ${more} more.` : '') +
        '\nRun `npm run validate:content` for the full offline report.',
    )
  }
}

// ---------------------------------------------------------------------------
// loadContent
// ---------------------------------------------------------------------------

let inFlight: Promise<ContentStore> | null = null

/**
 * Reads every content file, validates (dev only), indexes, and installs the
 * module singleton. Idempotent: the second call returns the same store, and
 * concurrent calls share one in-flight promise.
 */
export async function loadContent(): Promise<ContentStore> {
  if (isContentLoaded()) return requireStore()
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const bundle = await readBundle()
      if (import.meta.env.DEV) assertContentBundle(bundle)
      const store = buildStore(bundle)
      setStore(store)
      return store
    } catch (err) {
      // A failed load must not poison the module: let a retry re-read.
      inFlight = null
      throw err
    }
  })()
  return inFlight
}
