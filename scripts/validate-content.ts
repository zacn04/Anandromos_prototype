#!/usr/bin/env node
/**
 * anadromos · offline content validation CLI. Spec §8.
 *
 *   npm run validate:content                  human-readable report
 *   npm run validate:content -- --json        one JSON object on stdout, nothing else
 *   npm run validate:content -- --strict      warnings become errors. THIS is what CI runs.
 *   npm run validate:content -- --verbose     also print info-level findings
 *   npm run validate:content -- --write-hashes            rewrite meta.json's graphHashes
 *   npm run validate:content -- --dir content/__fixtures__/invalid-cycle
 *
 * Exit codes (§8.2): 0 = no errors · 1 = errors · 2 = a file could not be read
 * or parsed, so nothing was validated.
 *
 * Plain Node ESM TypeScript, run through Node's native type stripping. Zero
 * dependencies — not even a dev-only schema library: the same predicates and
 * the same slugify() have to run in the browser loader where a schema library
 * is banned (constraint 6), so there is one implementation in
 * src/content/validate.ts and both sides import it (§8.1).
 *
 * Reads with readFileSync + JSON.parse rather than import(), so it also catches
 * malformed JSON, byte-order marks, and files a bundler would have tolerated.
 * It never builds a ContentStore; it works on the parsed files directly and is
 * unaffected by §3.12's CORE/BANK split.
 *
 * All twelve checks always run. The CLI never short-circuits after the first
 * failure, because fixing one content error at a time is how a 39-row change
 * takes a week.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CONTENT_FILES,
  CONTENT_KINDS,
  CONTENT_SOURCES,
  CONTENT_STATUSES,
  DIFFICULTY_TIERS,
  ENVELOPE_EXEMPT_KINDS,
  EXAM_BOARDS,
  EXAM_TIERS,
  ID_LEVELS,
  NEAR_DUPLICATE_MAX_DISTANCE,
  NEAR_DUPLICATE_MIN_LENGTH,
  NODE_STATUSES,
  RE_CLASS_ID,
  RE_FAMILY_ID,
  RE_GRAPH_FILTER_ID,
  RE_STUDENT_ID,
  RE_TEACHER_ID,
  isArray,
  isInteger,
  isNonEmptyString,
  isPlainObject,
  isString,
  lastSegmentOf,
  levenshtein,
  oneOf,
  overlongSegment,
  parentOf,
  regexForLevel,
  segmentsOf,
  segmentsWellFormed,
} from '../src/content/validate.ts'

// ---------------------------------------------------------------------------
// Types local to the CLI. Parsed JSON is untyped by construction; the whole
// point of this script is to find out whether it matches schema.ts.
// ---------------------------------------------------------------------------

type Row = Record<string, any>
type Severity = 'error' | 'warning' | 'info'

interface Finding {
  severity: Severity
  code: string
  check: string
  file: string
  index: number | null
  id: string | null
  message: string
  path?: string[]
}

interface CheckReport {
  name: string
  unit: string
  subjects: number
  errors: number
  warnings: number
  infos: number
}

interface LoadedFile {
  path: string
  label: string
  expectedKind: string
  exists: boolean
  parsed: any
  parseError: string | null
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const opts = {
  json: argv.indexOf('--json') > -1,
  strict: argv.indexOf('--strict') > -1,
  verbose: argv.indexOf('--verbose') > -1,
  writeHashes: argv.indexOf('--write-hashes') > -1,
  dir: 'content',
}
{
  const i = argv.indexOf('--dir')
  if (i > -1 && argv[i + 1]) opts.dir = argv[i + 1]
}
const ROOT = resolve(process.cwd(), opts.dir)
const DIR_LABEL = opts.dir.replace(/\/+$/, '')

// ---------------------------------------------------------------------------
// Finding sink
// ---------------------------------------------------------------------------

const findings: Finding[] = []
let currentCheck = ''

function report(
  severity: Severity,
  code: string,
  file: string,
  index: number | null,
  id: string | null,
  message: string,
  path?: string[],
): void {
  const f: Finding = { severity, code, check: currentCheck, file, index, id, message }
  if (path) f.path = path
  findings.push(f)
}

const err = (code: string, file: string, index: number | null, id: string | null, message: string, path?: string[]) =>
  report('error', code, file, index, id, message, path)
const warn = (code: string, file: string, index: number | null, id: string | null, message: string) =>
  report('warning', code, file, index, id, message)
const info = (code: string, file: string, index: number | null, id: string | null, message: string) =>
  report('info', code, file, index, id, message)

// ---------------------------------------------------------------------------
// Read every file in §4.1's manifest
// ---------------------------------------------------------------------------

const files: LoadedFile[] = CONTENT_FILES.map((f) => {
  const abs = join(ROOT, f.path)
  const label = `${DIR_LABEL}/${f.path}`
  if (!existsSync(abs)) {
    return { path: f.path, label, expectedKind: f.kind, exists: false, parsed: null, parseError: null }
  }
  try {
    return {
      path: f.path,
      label,
      expectedKind: f.kind,
      exists: true,
      parsed: JSON.parse(readFileSync(abs, 'utf8')),
      parseError: null,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { path: f.path, label, expectedKind: f.kind, exists: true, parsed: null, parseError: msg }
  }
})

const byPath = new Map<string, LoadedFile>(files.map((f) => [f.path, f]))

/** Array-of-objects accessor for an untyped JSON field. Never throws. */
function rowsOf(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : []
}

function itemsOf(path: string): Row[] {
  const f = byPath.get(path)
  if (!f || !f.parsed || !isArray(f.parsed.items)) return []
  return f.parsed.items as Row[]
}
function fileLabel(path: string): string {
  return `${DIR_LABEL}/${path}`
}

// A parse failure means nothing was validated. Bail with exit code 2 (§8.2).
const parseFailures = files.filter((f) => f.parseError !== null)
if (parseFailures.length > 0) {
  currentCheck = 'file-envelope'
  for (const f of parseFailures) err('E_FILE_PARSE', f.label, null, null, f.parseError!)
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        { ok: false, dir: DIR_LABEL, counts: {}, checks: [], findings, errors: findings.length, warnings: 0 },
        null,
        2,
      )}\n`,
    )
  } else {
    process.stderr.write(`anadromos · content validation · ${DIR_LABEL}/\n\n`)
    for (const f of findings) process.stderr.write(`  E_FILE_PARSE  ${f.file}\n                ${f.message}\n`)
    process.stderr.write('\n  could not parse a content file · nothing was validated\n')
  }
  process.exit(2)
}

// ---------------------------------------------------------------------------
// The parsed bundle
// ---------------------------------------------------------------------------

const META_PATH = 'curriculum/meta.json'
const STRANDS_PATH = 'curriculum/strands.json'
const TOPICS_PATH = 'curriculum/topics.json'
const SUBTOPICS_PATH = 'curriculum/subtopics.json'
const TOPIC_EDGES_PATH = 'curriculum/prereq-edges.topic.json'
const SUBTOPIC_EDGES_PATH = 'curriculum/prereq-edges.subtopic.json'
const FILTERS_PATH = 'curriculum/graph-filters.json'
const LESSONS_PATH = 'curriculum/lessons.json'
const QUESTIONS_PATH = 'curriculum/questions.json'
const RETEACH_PATH = 'curriculum/reteach-cards.json'
const TEMPLATES_PATH = 'curriculum/question-templates.json'
const TEACHERS_PATH = 'school/teachers.json'
const CLASSES_PATH = 'school/classes.json'
const CLASS_DEFAULTS_PATH = 'school/class-defaults.json'
const NODE_STATES_PATH = 'samples/node-states.json'
const PROFILES_PATH = 'samples/student-profiles.json'
const ACTIVITY_PATH = 'samples/activity-log.json'
const OVERSIGHT_PATH = 'samples/oversight.json'

const meta: Row = (byPath.get(META_PATH)?.parsed as Row) ?? {}
const classDefaults: Row = (byPath.get(CLASS_DEFAULTS_PATH)?.parsed as Row) ?? {}

const strands = itemsOf(STRANDS_PATH)
const topics = itemsOf(TOPICS_PATH)
const subtopics = itemsOf(SUBTOPICS_PATH)
const topicEdges = itemsOf(TOPIC_EDGES_PATH)
const subtopicEdges = itemsOf(SUBTOPIC_EDGES_PATH)
const graphFilters = itemsOf(FILTERS_PATH)
const lessons = itemsOf(LESSONS_PATH)
const questions = itemsOf(QUESTIONS_PATH)
const reteachCards = itemsOf(RETEACH_PATH)
const questionTemplates = itemsOf(TEMPLATES_PATH)
const teachers = itemsOf(TEACHERS_PATH)
const classes = itemsOf(CLASSES_PATH)
const nodeStates = itemsOf(NODE_STATES_PATH)
const profiles = itemsOf(PROFILES_PATH)
const activityLogs = itemsOf(ACTIVITY_PATH)
const oversight = itemsOf(OVERSIGHT_PATH)

const strandIds = new Set<string>(strands.map((s) => s.id).filter(isString))
const topicById = new Map<string, Row>()
for (const t of topics) if (isString(t.id) && !topicById.has(t.id)) topicById.set(t.id, t)
const subtopicById = new Map<string, Row>()
for (const s of subtopics) if (isString(s.id) && !subtopicById.has(s.id)) subtopicById.set(s.id, s)
const questionById = new Map<string, Row>()
for (const q of questions) if (isString(q.id) && !questionById.has(q.id)) questionById.set(q.id, q)
const teacherById = new Map<string, Row>()
for (const t of teachers) if (isString(t.id) && !teacherById.has(t.id)) teacherById.set(t.id, t)
const classById = new Map<string, Row>()
for (const c of classes) if (isString(c.id) && !classById.has(c.id)) classById.set(c.id, c)

const yearBands: string[] = isArray(meta.yearBands) ? (meta.yearBands as any[]).filter(isString) : []
const basket: string[] = isArray(classDefaults.basket) ? (classDefaults.basket as any[]).filter(isString) : []
const roster: string[] = isArray(classDefaults.roster) ? (classDefaults.roster as any[]).filter(isString) : []

const onGraphIds = new Set<string>()
for (const t of topics) if (isString(t.id) && t.onGraph === true) onGraphIds.add(t.id)

// ---------------------------------------------------------------------------
// --write-hashes, applied before validation so the run reports the new state
// ---------------------------------------------------------------------------

function hashEdgeFile(path: string): string {
  const f = byPath.get(path)
  if (!f || !f.parsed || !isArray(f.parsed.items)) return ''
  return createHash('sha256').update(JSON.stringify(f.parsed.items), 'utf8').digest('hex')
}

if (opts.writeHashes) {
  const metaFile = byPath.get(META_PATH)
  if (metaFile && metaFile.parsed && isPlainObject(metaFile.parsed)) {
    const next = { topic: hashEdgeFile(TOPIC_EDGES_PATH), subtopic: hashEdgeFile(SUBTOPIC_EDGES_PATH) }
    metaFile.parsed.graphHashes = next
    meta.graphHashes = next
    writeFileSync(join(ROOT, META_PATH), `${JSON.stringify(metaFile.parsed, null, 2)}\n`, 'utf8')
    process.stderr.write(
      `wrote graphHashes to ${fileLabel(META_PATH)}\n` +
        `  topic     ${next.topic}\n` +
        `  subtopic  ${next.subtopic}\n` +
        `REMINDER: bump topicGraphVersion / subtopicGraphVersion by hand if the edges changed.\n` +
        `          --write-hashes never touches the version strings (§4.3).\n\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// Shared graph helpers
// ---------------------------------------------------------------------------

function edgePairs(rows: Row[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const e of rows) {
    if (isString(e.from) && isString(e.to)) out.push([e.from, e.to])
  }
  return out
}

/** Transitive prerequisite ancestors: everything that reaches `node`. */
function buildAncestors(pairs: Array<[string, string]>): Map<string, Set<string>> {
  const incoming = new Map<string, string[]>()
  const nodes = new Set<string>()
  for (const [from, to] of pairs) {
    nodes.add(from)
    nodes.add(to)
    const list = incoming.get(to)
    if (list) list.push(from)
    else incoming.set(to, [from])
  }
  const memo = new Map<string, Set<string>>()
  const visiting = new Set<string>()
  function ancestorsOf(node: string): Set<string> {
    const cached = memo.get(node)
    if (cached) return cached
    if (visiting.has(node)) return new Set<string>() // cycle guard; E_CYCLE reports it
    visiting.add(node)
    const acc = new Set<string>()
    for (const parent of incoming.get(node) ?? []) {
      acc.add(parent)
      for (const a of ancestorsOf(parent)) acc.add(a)
    }
    visiting.delete(node)
    memo.set(node, acc)
    return acc
  }
  for (const n of nodes) ancestorsOf(n)
  return memo
}

// ---------------------------------------------------------------------------
// CHECK 1 · file-envelope
// ---------------------------------------------------------------------------

function checkFileEnvelope(): number {
  const metaVersion = isInteger(meta.schemaVersion) ? meta.schemaVersion : null

  for (const f of files) {
    if (!f.exists) {
      err('E_FILE_MISSING', f.label, null, null, `required content file is absent`)
      continue
    }
    if (!isPlainObject(f.parsed)) {
      err('E_ENVELOPE', f.label, null, null, 'file root is not a JSON object')
      continue
    }
    const root = f.parsed as Row

    if (!isInteger(root.schemaVersion)) {
      err('E_ENVELOPE', f.label, null, null, `schemaVersion must be an integer, got ${JSON.stringify(root.schemaVersion)}`)
    } else if (metaVersion !== null && root.schemaVersion !== metaVersion) {
      err(
        'E_SCHEMA_VERSION',
        f.label,
        null,
        null,
        `schemaVersion ${root.schemaVersion} differs from meta.json's ${metaVersion}`,
      )
    }

    if (!oneOf(root.kind, CONTENT_KINDS)) {
      err('E_ENVELOPE', f.label, null, null, `kind ${JSON.stringify(root.kind)} is not one of §4.3's 17 values`)
    } else if (root.kind !== f.expectedKind) {
      err('E_ENVELOPE', f.label, null, null, `kind is "${root.kind}", expected "${f.expectedKind}"`)
    }

    const exempt = (ENVELOPE_EXEMPT_KINDS as readonly string[]).indexOf(f.expectedKind) > -1
    if (!exempt && !isArray(root.items)) {
      err('E_ENVELOPE', f.label, null, null, 'items must be an array')
    }
  }

  // meta.json's own required shape. Version strings are rule 12's business.
  const metaFile = byPath.get(META_PATH)
  if (metaFile?.exists && isPlainObject(metaFile.parsed)) {
    if (!isNonEmptyString(meta.contentVersion)) {
      err('E_ENVELOPE', fileLabel(META_PATH), null, null, 'contentVersion must be a non-empty string')
    }
    if (!isArray(meta.yearBands) || (meta.yearBands as any[]).some((b: unknown) => !isNonEmptyString(b))) {
      err('E_ENVELOPE', fileLabel(META_PATH), null, null, 'yearBands must be an array of non-empty strings')
    }
    if (!isPlainObject(meta.graphHashes)) {
      err('E_ENVELOPE', fileLabel(META_PATH), null, null, 'graphHashes must be an object { topic, subtopic }')
    }
  }

  // class-defaults.json's two arrays.
  const cdFile = byPath.get(CLASS_DEFAULTS_PATH)
  if (cdFile?.exists && isPlainObject(cdFile.parsed)) {
    if (!isArray(classDefaults.roster) || (classDefaults.roster as any[]).some((n: unknown) => !isNonEmptyString(n))) {
      err('E_ENVELOPE', fileLabel(CLASS_DEFAULTS_PATH), null, null, 'roster must be an array of non-empty strings')
    }
    if (!isArray(classDefaults.basket)) {
      err('E_ENVELOPE', fileLabel(CLASS_DEFAULTS_PATH), null, null, 'basket must be an array of topic ids')
    }
  }

  return files.length
}

// ---------------------------------------------------------------------------
// CHECK 2 · id-grammar
// ---------------------------------------------------------------------------

type DottedLevel = keyof typeof ID_LEVELS

function checkDottedId(value: unknown, level: DottedLevel, file: string, index: number, what: string): void {
  if (!isString(value) || value === '') {
    err('E_ID_GRAMMAR', file, index, null, `${what} must be a non-empty string, got ${JSON.stringify(value)}`)
    return
  }
  const id = value
  if (!segmentsWellFormed(id)) {
    err(
      'E_ID_GRAMMAR',
      file,
      index,
      id,
      `${what} "${id}" has a segment outside SEGMENT := [a-z0-9]+(-[a-z0-9]+)* (§1.2)`,
    )
  } else if (segmentsOf(id).length !== ID_LEVELS[level] || !regexForLevel(level).test(id)) {
    err(
      'E_ID_LEVEL',
      file,
      index,
      id,
      `${what} "${id}" has ${segmentsOf(id).length} segment(s); a ${level} id has ${ID_LEVELS[level]}`,
    )
  }
  const long = overlongSegment(id)
  if (long !== null) {
    err('E_ID_SEGMENT_LENGTH', file, index, id, `segment "${long}" is ${long.length} characters; the limit is 40`)
  }
}

function checkNamespacedId(value: unknown, re: RegExp, file: string, index: number, what: string): void {
  if (!isString(value) || !re.test(value)) {
    err('E_ID_GRAMMAR', file, index, isString(value) ? value : null, `${what} ${JSON.stringify(value)} fails ${re.source}`)
  }
}

function checkIdGrammar(): number {
  strands.forEach((s, i) => checkDottedId(s.id, 'strand', fileLabel(STRANDS_PATH), i, 'Strand.id'))
  topics.forEach((t, i) => checkDottedId(t.id, 'topic', fileLabel(TOPICS_PATH), i, 'Topic.id'))
  subtopics.forEach((s, i) => checkDottedId(s.id, 'subtopic', fileLabel(SUBTOPICS_PATH), i, 'Subtopic.id'))
  questions.forEach((q, i) => {
    checkDottedId(q.id, 'question', fileLabel(QUESTIONS_PATH), i, 'Question.id')
    // familyId is subtopic-scoped (§3.5) and checked, but is not a subject.
    checkNamespacedId(q.familyId, RE_FAMILY_ID, fileLabel(QUESTIONS_PATH), i, 'Question.familyId')
  })
  graphFilters.forEach((f, i) =>
    checkNamespacedId(f.id, RE_GRAPH_FILTER_ID, fileLabel(FILTERS_PATH), i, 'GraphFilter.id'),
  )
  teachers.forEach((t, i) => checkNamespacedId(t.id, RE_TEACHER_ID, fileLabel(TEACHERS_PATH), i, 'Teacher.id'))
  classes.forEach((c, i) => checkNamespacedId(c.id, RE_CLASS_ID, fileLabel(CLASSES_PATH), i, 'SchoolClass.id'))
  teachers.forEach((t, i) => {
    const ids: unknown[] = isArray(t.classIds) ? t.classIds : []
    ids.forEach((cid) => checkNamespacedId(cid, RE_CLASS_ID, fileLabel(TEACHERS_PATH), i, 'Teacher.classIds[]'))
  })
  classes.forEach((c, i) =>
    checkNamespacedId(c.teacherId, RE_TEACHER_ID, fileLabel(CLASSES_PATH), i, 'SchoolClass.teacherId'),
  )

  // StudentIds across the three sample files. Checked, not a subject.
  const sampleFiles: Array<[string, Row[]]> = [
    [NODE_STATES_PATH, nodeStates],
    [PROFILES_PATH, profiles],
    [ACTIVITY_PATH, activityLogs],
  ]
  for (const [path, rows] of sampleFiles) {
    rows.forEach((r, i) => checkNamespacedId(r.studentId, RE_STUDENT_ID, fileLabel(path), i, 'studentId'))
  }

  return (
    strands.length + topics.length + subtopics.length + questions.length + graphFilters.length + teachers.length + classes.length
  )
}

// ---------------------------------------------------------------------------
// CHECK 3 · id-containment
// ---------------------------------------------------------------------------

function checkIdContainment(): number {
  topics.forEach((t, i) => {
    if (!isString(t.id)) return
    const parent = parentOf(t.id)
    if (parent === '' || !strandIds.has(parent)) {
      err('E_ID_PARENT_MISSING', fileLabel(TOPICS_PATH), i, t.id, `no strand "${parent}" for topic "${t.id}"`)
    }
    if (t.strandId !== parent) {
      err(
        'E_ID_PARENT_MISMATCH',
        fileLabel(TOPICS_PATH),
        i,
        t.id,
        `strandId "${t.strandId}" disagrees with the id's parent "${parent}"`,
      )
    }
  })

  subtopics.forEach((s, i) => {
    if (!isString(s.id)) return
    const parent = parentOf(s.id)
    if (parent === '' || !topicById.has(parent)) {
      err('E_ID_PARENT_MISSING', fileLabel(SUBTOPICS_PATH), i, s.id, `no topic "${parent}" for subtopic "${s.id}"`)
    }
    if (s.topicId !== parent) {
      err(
        'E_ID_PARENT_MISMATCH',
        fileLabel(SUBTOPICS_PATH),
        i,
        s.id,
        `topicId "${s.topicId}" disagrees with the id's parent "${parent}"`,
      )
    }
  })

  questions.forEach((q, i) => {
    if (!isString(q.id)) return
    const parent = parentOf(q.id)
    if (parent === '' || !subtopicById.has(parent)) {
      err('E_ID_PARENT_MISSING', fileLabel(QUESTIONS_PATH), i, q.id, `no subtopic "${parent}" for question "${q.id}"`)
    }
    if (q.subtopicId !== parent) {
      err(
        'E_ID_PARENT_MISMATCH',
        fileLabel(QUESTIONS_PATH),
        i,
        q.id,
        `subtopicId "${q.subtopicId}" disagrees with the id's parent "${parent}"`,
      )
    }
    if (isString(q.subtopicId)) {
      const grandparent = parentOf(q.subtopicId)
      if (q.topicId !== grandparent) {
        err(
          'E_ID_PARENT_MISMATCH',
          fileLabel(QUESTIONS_PATH),
          i,
          q.id,
          `topicId "${q.topicId}" disagrees with subtopicId's parent "${grandparent}"`,
        )
      }
    }
  })

  return topics.length + subtopics.length + questions.length
}

// ---------------------------------------------------------------------------
// CHECK 4 · id-uniqueness
// ---------------------------------------------------------------------------

function checkIdUniqueness(): number {
  const groups: Array<{ type: string; path: string; rows: Row[]; level: DottedLevel | null }> = [
    { type: 'strand', path: STRANDS_PATH, rows: strands, level: 'strand' },
    { type: 'topic', path: TOPICS_PATH, rows: topics, level: 'topic' },
    { type: 'subtopic', path: SUBTOPICS_PATH, rows: subtopics, level: 'subtopic' },
    { type: 'question', path: QUESTIONS_PATH, rows: questions, level: 'question' },
    { type: 'graph filter', path: FILTERS_PATH, rows: graphFilters, level: null },
    { type: 'teacher', path: TEACHERS_PATH, rows: teachers, level: null },
    { type: 'class', path: CLASSES_PATH, rows: classes, level: null },
  ]

  const liveIds = new Set<string>()
  for (const g of groups) for (const r of g.rows) if (isString(r.id)) liveIds.add(r.id)

  let subjects = 0
  for (const g of groups) {
    const seen = new Set<string>()
    g.rows.forEach((r, i) => {
      if (!isString(r.id)) return
      subjects++
      if (seen.has(r.id)) {
        err('E_ID_DUPLICATE', fileLabel(g.path), i, r.id, `two ${g.type} rows share the id "${r.id}"`)
      }
      seen.add(r.id)
    })
  }

  // Aliases (§1.6). [] on every seed row; the rules exist for reparenting.
  const aliasOwner = new Map<string, string>()
  for (const g of groups) {
    if (g.level === null) continue
    g.rows.forEach((r, i) => {
      const aliases: unknown[] = isArray(r.aliases) ? r.aliases : []
      for (const a of aliases) {
        subjects++
        if (!isString(a)) {
          err('E_ALIAS_GRAMMAR', fileLabel(g.path), i, isString(r.id) ? r.id : null, `alias ${JSON.stringify(a)} is not a string`)
          continue
        }
        if (!regexForLevel(g.level!).test(a)) {
          err('E_ALIAS_GRAMMAR', fileLabel(g.path), i, r.id, `alias "${a}" fails the ${g.type} id grammar`)
        }
        if (liveIds.has(a)) {
          err('E_ALIAS_COLLIDES', fileLabel(g.path), i, r.id, `alias "${a}" is a live id — an alias must never shadow something real`)
        }
        const prior = aliasOwner.get(a)
        if (prior !== undefined) {
          err('E_ALIAS_DUPLICATE', fileLabel(g.path), i, r.id, `alias "${a}" already belongs to "${prior}"`)
        } else {
          aliasOwner.set(a, isString(r.id) ? r.id : '?')
        }
      }
    })
  }

  // W_FAMILY_CROSS_SUBTOPIC — legal by §3.5, worth knowing today.
  const familyToSubtopics = new Map<string, Set<string>>()
  const familyFirstIndex = new Map<string, number>()
  questions.forEach((q, i) => {
    if (!isString(q.familyId) || !isString(q.subtopicId)) return
    let set = familyToSubtopics.get(q.familyId)
    if (!set) {
      set = new Set<string>()
      familyToSubtopics.set(q.familyId, set)
      familyFirstIndex.set(q.familyId, i)
    }
    set.add(q.subtopicId)
  })
  for (const [family, set] of familyToSubtopics) {
    if (set.size > 1) {
      warn(
        'W_FAMILY_CROSS_SUBTOPIC',
        fileLabel(QUESTIONS_PATH),
        familyFirstIndex.get(family) ?? null,
        family,
        `familyId "${family}" appears under ${set.size} subtopics: ${[...set].join(', ')}`,
      )
    }
  }

  // W_ID_NEAR_DUPLICATE — siblings under one parent whose final segments are
  // near-identical. E_ID_DUPLICATE cannot see solve-both-sides vs
  // solving-both-sides, and 8,000 auto-slugged siblings need to be inspectable.
  for (const g of groups) {
    if (g.level === null) continue
    const byParent = new Map<string, Array<{ id: string; seg: string; index: number }>>()
    g.rows.forEach((r, i) => {
      if (!isString(r.id)) return
      const parent = parentOf(r.id)
      const seg = lastSegmentOf(r.id)
      const list = byParent.get(parent)
      if (list) list.push({ id: r.id, seg, index: i })
      else byParent.set(parent, [{ id: r.id, seg, index: i }])
    })
    for (const siblings of byParent.values()) {
      for (let a = 0; a < siblings.length; a++) {
        for (let b = a + 1; b < siblings.length; b++) {
          const x = siblings[a]
          const y = siblings[b]
          if (x.seg.length < NEAR_DUPLICATE_MIN_LENGTH || y.seg.length < NEAR_DUPLICATE_MIN_LENGTH) continue
          const d = levenshtein(x.seg, y.seg)
          if (d <= NEAR_DUPLICATE_MAX_DISTANCE) {
            warn(
              'W_ID_NEAR_DUPLICATE',
              fileLabel(g.path),
              y.index,
              y.id,
              `"${y.id}" is ${d} edit(s) from sibling "${x.id}" — are they the same ${g.type}?`,
            )
          }
        }
      }
    }
  }

  return subjects
}

// ---------------------------------------------------------------------------
// CHECK 5 · referential-integrity
// ---------------------------------------------------------------------------

function checkReferentialIntegrity(): number {
  let subjects = 0

  topics.forEach((t, i) => {
    subjects++
    if (!isString(t.strandId) || !strandIds.has(t.strandId)) {
      err('E_REF_TOPIC_STRAND', fileLabel(TOPICS_PATH), i, t.id ?? null, `strandId "${t.strandId}" names no strand`)
    }
  })

  subtopics.forEach((s, i) => {
    subjects++
    if (!isString(s.topicId) || !topicById.has(s.topicId)) {
      err('E_REF_SUBTOPIC_TOPIC', fileLabel(SUBTOPICS_PATH), i, s.id ?? null, `topicId "${s.topicId}" names no topic`)
    }
  })

  questions.forEach((q, i) => {
    subjects++
    if (!isString(q.subtopicId) || !subtopicById.has(q.subtopicId)) {
      err(
        'E_REF_QUESTION_SUBTOPIC',
        fileLabel(QUESTIONS_PATH),
        i,
        q.id ?? null,
        `subtopicId "${q.subtopicId}" names no subtopic`,
      )
    }
    subjects++
    if (!isString(q.topicId) || !topicById.has(q.topicId)) {
      err('E_REF_QUESTION_TOPIC', fileLabel(QUESTIONS_PATH), i, q.id ?? null, `topicId "${q.topicId}" names no topic`)
    }
  })

  const edgeFiles: Array<{ path: string; rows: Row[]; level: DottedLevel; resolve: (id: string) => boolean }> = [
    { path: TOPIC_EDGES_PATH, rows: topicEdges, level: 'topic', resolve: (id) => topicById.has(id) },
    { path: SUBTOPIC_EDGES_PATH, rows: subtopicEdges, level: 'subtopic', resolve: (id) => subtopicById.has(id) },
  ]
  for (const ef of edgeFiles) {
    ef.rows.forEach((e, i) => {
      for (const end of ['from', 'to'] as const) {
        subjects++
        const v = e[end]
        if (!isString(v) || !ef.resolve(v)) {
          err(
            'E_REF_EDGE_ENDPOINT',
            fileLabel(ef.path),
            i,
            null,
            `${end} "${v}" names no ${ef.level}`,
          )
        }
      }
      if (isString(e.from) && isString(e.to) && segmentsOf(e.from).length !== segmentsOf(e.to).length) {
        err(
          'E_EDGE_LEVEL_MIX',
          fileLabel(ef.path),
          i,
          null,
          `"${e.from}" and "${e.to}" are not the same level`,
        )
      }
    })
  }

  // Templates are checked alongside authored questions: they are the bulk of
  // what a student is served, and an out-of-ancestry tag on a template is a
  // wrong diagnosis repeated across every instance it generates.
  const taggedSources: Row[] = [...rowsOf(questions), ...rowsOf(questionTemplates)]
  taggedSources.forEach((q, qi) => {
    const lines: Row[] = rowsOf(q.lines)
    lines.forEach((line, li) => {
      const tags: unknown[] = isArray(line.prereqSubtopicIds) ? line.prereqSubtopicIds : []
      for (const tag of tags) {
        subjects++
        if (!isString(tag) || !subtopicById.has(tag)) {
          err(
            'E_REF_LINE_PREREQ',
            fileLabel(QUESTIONS_PATH),
            qi,
            q.id ?? null,
            `line ${li} tags "${tag}", which names no subtopic`,
          )
        }
      }
    })
  })

  graphFilters.forEach((f, i) => {
    const ids: unknown[] = isArray(f.topicIds) ? f.topicIds : []
    for (const id of ids) {
      subjects++
      if (!isString(id) || !topicById.has(id)) {
        err('E_REF_FILTER_TOPIC', fileLabel(FILTERS_PATH), i, f.id ?? null, `topicIds entry "${id}" names no topic`)
      } else if (!onGraphIds.has(id)) {
        err('E_FILTER_NOT_GRAPH', fileLabel(FILTERS_PATH), i, f.id ?? null, `topic "${id}" has onGraph: false`)
      }
    }
  })

  basket.forEach((id) => {
    subjects++
    const t = topicById.get(id)
    if (!t) {
      err('E_REF_BASKET_TOPIC', fileLabel(CLASS_DEFAULTS_PATH), null, null, `basket entry "${id}" names no topic`)
    } else if (t.catalogue !== true) {
      err('E_BASKET_NOT_CATALOGUE', fileLabel(CLASS_DEFAULTS_PATH), null, null, `topic "${id}" has catalogue: false`)
    }
  })

  const subtopicsWithQuestions = new Set<string>()
  for (const q of rowsOf(questions)) {
    if (isString(q.subtopicId)) subtopicsWithQuestions.add(q.subtopicId)
  }
  for (const t of rowsOf(questionTemplates)) {
    if (isString(t.subtopicId)) subtopicsWithQuestions.add(t.subtopicId)
  }

  lessons.forEach((l, i) => {
    subjects++
    if (!isString(l.topicId) || !topicById.has(l.topicId)) {
      err('E_REF_LESSON_TOPIC', fileLabel(LESSONS_PATH), i, null, `topicId "${l.topicId}" names no topic`)
    }
    const prereqs: Row[] = rowsOf(l.prerequisites)
    for (const p of prereqs) {
      subjects++
      const sid = p.subtopicId
      if (!isString(sid) || !subtopicById.has(sid)) {
        err('E_REF_LESSON_PREREQ', fileLabel(LESSONS_PATH), i, null, `prerequisite "${sid}" names no subtopic`)
      } else if (subtopicById.get(sid)!.topicId !== l.topicId) {
        err(
          'E_LESSON_PREREQ_FOREIGN',
          fileLabel(LESSONS_PATH),
          i,
          null,
          `prerequisite "${sid}" belongs to "${subtopicById.get(sid)!.topicId}", not the lesson's "${l.topicId}"`,
        )
      } else if (!subtopicsWithQuestions.has(sid)) {
        // Not a content gap — a crash. LessonSession draws its check questions
        // with questionsForSubtopic, so a prerequisite with an empty bank puts
        // the student into a lesson that dies partway through.
        err(
          'E_LESSON_PREREQ_NO_QUESTIONS',
          fileLabel(LESSONS_PATH),
          i,
          null,
          `prerequisite "${sid}" has no questions, so this lesson cannot be delivered`,
        )
      }
    }
    if (prereqs.length === 0) {
      err('E_LESSON_EMPTY', fileLabel(LESSONS_PATH), i, null,
        `lesson for "${l.topicId}" has no prerequisites to teach`)
    }
  })

  // Every topic should be teachable. A warning rather than an error: adding a
  // topic before writing its lesson is a legitimate intermediate state, but it
  // should never pass unnoticed.
  const topicsWithLesson = new Set(lessons.map((l) => l.topicId))
  for (const [tid] of topicById) {
    if (!topicsWithLesson.has(tid)) {
      warn('W_TOPIC_NO_LESSON', fileLabel(LESSONS_PATH), null, tid,
        `topic "${tid}" has no lesson, so it can never be offered as one`)
    }
  }

  reteachCards.forEach((c, i) => {
    subjects++
    const q = isString(c.questionId) ? questionById.get(c.questionId) : undefined
    if (!q) {
      err('E_REF_RETEACH_QUESTION', fileLabel(RETEACH_PATH), i, null, `questionId "${c.questionId}" names no question`)
      return
    }
    const lineCount = isArray(q.lines) ? q.lines.length : 0
    const li = c.lineIndex
    const ok = li === 'all' || (isInteger(li) && li >= 0 && li < lineCount)
    if (!ok) {
      err(
        'E_REF_RETEACH_QUESTION',
        fileLabel(RETEACH_PATH),
        i,
        c.questionId,
        `lineIndex ${JSON.stringify(li)} is neither 'all' nor within 0..${lineCount - 1}`,
      )
    }
  })

  classes.forEach((c, i) => {
    subjects++
    if (!isString(c.teacherId) || !teacherById.has(c.teacherId)) {
      err('E_REF_CLASS_TEACHER', fileLabel(CLASSES_PATH), i, c.id ?? null, `teacherId "${c.teacherId}" names no teacher`)
    }
  })

  teachers.forEach((t, i) => {
    const ids: unknown[] = isArray(t.classIds) ? t.classIds : []
    for (const cid of ids) {
      subjects++
      if (!isString(cid) || !classById.has(cid)) {
        err('E_REF_TEACHER_CLASS', fileLabel(TEACHERS_PATH), i, t.id ?? null, `classIds entry "${cid}" names no class`)
      } else if (classById.get(cid)!.teacherId !== t.id) {
        err(
          'E_TEACHER_CLASS_ASYMMETRIC',
          fileLabel(TEACHERS_PATH),
          i,
          t.id ?? null,
          `class "${cid}" points back at "${classById.get(cid)!.teacherId}", not "${t.id}"`,
        )
      }
    }
  })


  // Every student profile must name a class that exists. A dangling classId
  // does not throw — it silently yields an empty roster, which is exactly the
  // failure this check exists to make loud.
  const classIdSet = new Set(rowsOf(classes).map((c) => c.id))
  rowsOf(profiles).forEach((pr, i) => {
    const cid = pr.classId
    if (!isString(cid)) {
      err('E_PROFILE_CLASS_MISSING', fileLabel(PROFILES_PATH), i, pr.studentId ?? null,
        'profile has no classId, so it appears on no class roster')
      return
    }
    if (!classIdSet.has(cid)) {
      err('E_REF_PROFILE_CLASS', fileLabel(PROFILES_PATH), i, pr.studentId ?? null,
        `classId "${cid}" names no class in ${CLASSES_PATH}`)
    }
  })
  nodeStates.forEach((ns, i) => {
    const nodes = isPlainObject(ns.nodes) ? ns.nodes : {}
    for (const key of Object.keys(nodes)) {
      subjects++
      if (!topicById.has(key)) {
        err('E_REF_SAMPLE_TOPIC', fileLabel(NODE_STATES_PATH), i, ns.studentId ?? null, `node key "${key}" names no topic`)
      } else if (!onGraphIds.has(key)) {
        err(
          'E_REF_SAMPLE_TOPIC',
          fileLabel(NODE_STATES_PATH),
          i,
          ns.studentId ?? null,
          `node key "${key}" is a topic with onGraph: false`,
        )
      }
    }
  })

  profiles.forEach((p, i) => {
    const rows: Row[] = []
    if (isArray(p.pace)) rows.push(...(p.pace as Row[]))
    if (isArray(p.mastery)) rows.push(...(p.mastery as Row[]))
    if (isPlainObject(p.workingOnNow)) rows.push(p.workingOnNow as Row)
    for (const r of rows) {
      if (r.topicId === null || r.topicId === undefined) continue
      subjects++
      if (!isString(r.topicId) || !topicById.has(r.topicId)) {
        err(
          'E_REF_PROFILE_TOPIC',
          fileLabel(PROFILES_PATH),
          i,
          p.studentId ?? null,
          `"${r.label}" joins to topicId "${r.topicId}", which names no topic`,
        )
      }
    }
  })

  const bands: Array<[string, Row[], string]> = [
    [TOPICS_PATH, topics, 'Topic'],
    [SUBTOPICS_PATH, subtopics, 'Subtopic'],
    [CLASSES_PATH, classes, 'SchoolClass'],
  ]
  for (const [path, rows, what] of bands) {
    rows.forEach((r, i) => {
      subjects++
      if (!isString(r.yearBand) || yearBands.indexOf(r.yearBand) === -1) {
        err(
          'E_REF_YEAR_BAND',
          fileLabel(path),
          i,
          r.id ?? null,
          `${what}.yearBand ${JSON.stringify(r.yearBand)} is not in meta.yearBands`,
        )
      }
    })
  }

  subtopics.forEach((s, i) => {
    const scopes: Row[] = rowsOf(s.boardScope)
    for (const bs of scopes) {
      subjects++
      if (!oneOf(bs.board, EXAM_BOARDS) || !oneOf(bs.tier, EXAM_TIERS)) {
        err(
          'E_REF_BOARD',
          fileLabel(SUBTOPICS_PATH),
          i,
          s.id ?? null,
          `boardScope { board: ${JSON.stringify(bs.board)}, tier: ${JSON.stringify(bs.tier)} } is not a valid (board, tier)`,
        )
      }
    }
  })

  return subjects
}

// ---------------------------------------------------------------------------
// CHECK 6 · dag-acyclicity
// ---------------------------------------------------------------------------

function checkGraphAcyclicity(path: string, rows: Row[]): void {
  const pairs: Array<[string, string]> = []
  const seenPair = new Set<string>()

  rows.forEach((e, i) => {
    if (!isString(e.from) || !isString(e.to)) return
    if (e.from === e.to) {
      err('E_SELF_EDGE', fileLabel(path), i, null, `"${e.from}" is its own prerequisite`)
      return
    }
    const key = `${e.from} ${e.to}`
    if (seenPair.has(key)) {
      // Warning, not error: build-plan §1.4 applies three verification sources
      // at different times, and merging into `evidence` is the intended fix.
      warn('W_DUPLICATE_EDGE', fileLabel(path), i, null, `(${e.from} → ${e.to}) appears more than once`)
    }
    seenPair.add(key)
    pairs.push([e.from, e.to])
  })

  // Kahn's algorithm. Whatever remains sits in, or downstream of, a cycle.
  const out = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const [from, to] of pairs) {
    if (!indeg.has(from)) indeg.set(from, 0)
    if (!indeg.has(to)) indeg.set(to, 0)
    indeg.set(to, indeg.get(to)! + 1)
    const list = out.get(from)
    if (list) list.push(to)
    else out.set(from, [to])
  }

  const queue: string[] = []
  for (const [node, d] of indeg) if (d === 0) queue.push(node)
  const removed = new Set<string>()
  while (queue.length > 0) {
    const node = queue.shift()!
    removed.add(node)
    for (const next of out.get(node) ?? []) {
      const d = indeg.get(next)! - 1
      indeg.set(next, d)
      if (d === 0) queue.push(next)
    }
  }

  const remaining = [...indeg.keys()].filter((n) => !removed.has(n))
  if (remaining.length === 0) return

  // Recover concrete cycles: a DFS from each remaining node, canonicalised by
  // rotation so the same cycle found from two entry points reports once.
  // Never auto-break one — build-plan §1.2 is explicit that a cycle is a bug.
  const inRemaining = new Set(remaining)
  const seenCycles = new Set<string>()
  for (const start of remaining) {
    const stack: string[] = []
    const onStack = new Set<string>()
    const visited = new Set<string>()
    let found: string[] | null = null

    const walk = (node: string): void => {
      if (found) return
      stack.push(node)
      onStack.add(node)
      visited.add(node)
      for (const next of out.get(node) ?? []) {
        if (found) break
        if (!inRemaining.has(next)) continue
        if (onStack.has(next)) {
          found = stack.slice(stack.indexOf(next))
          break
        }
        if (!visited.has(next)) walk(next)
      }
      onStack.delete(node)
      stack.pop()
    }
    walk(start)
    if (!found) continue

    const cycle: string[] = found
    let pivot = 0
    for (let i = 1; i < cycle.length; i++) if (cycle[i] < cycle[pivot]) pivot = i
    const rotated = cycle.slice(pivot).concat(cycle.slice(0, pivot))
    const key = rotated.join(' ')
    if (seenCycles.has(key)) continue
    seenCycles.add(key)
    const full = rotated.concat([rotated[0]])
    err('E_CYCLE', fileLabel(path), null, null, `cycle: ${full.join(' → ')}`, full)
  }
}

function checkDagAcyclicity(): number {
  checkGraphAcyclicity(TOPIC_EDGES_PATH, topicEdges)
  checkGraphAcyclicity(SUBTOPIC_EDGES_PATH, subtopicEdges)
  return topicEdges.length + subtopicEdges.length
}

// ---------------------------------------------------------------------------
// CHECK 7 · year-band-monotonicity
// ---------------------------------------------------------------------------

function checkYearBandGraph(path: string, rows: Row[], entities: Map<string, Row>): void {
  rows.forEach((e, i) => {
    if (!isString(e.from) || !isString(e.to)) return
    const from = entities.get(e.from)
    const to = entities.get(e.to)
    if (!from || !to) return
    const a = yearBands.indexOf(from.yearBand)
    const b = yearBands.indexOf(to.yearBand)
    if (a === -1 || b === -1) return // E_REF_YEAR_BAND already said so
    if (a > b) {
      warn(
        'W_YEAR_BAND',
        fileLabel(path),
        i,
        null,
        `${e.from} (${from.yearBand}) is a prerequisite of ${e.to} (${to.yearBand})`,
      )
    }
  })
}

function checkYearBandMonotonicity(): number {
  checkYearBandGraph(TOPIC_EDGES_PATH, topicEdges, topicById)
  checkYearBandGraph(SUBTOPIC_EDGES_PATH, subtopicEdges, subtopicById)
  return topicEdges.length + subtopicEdges.length
}

// ---------------------------------------------------------------------------
// CHECK 8 · reachability
// ---------------------------------------------------------------------------

function checkReachability(): number {
  const orders = new Map<number, string>()

  topics.forEach((t, i) => {
    const id = isString(t.id) ? t.id : null
    const onGraph = t.onGraph === true
    const placement = isPlainObject(t.graph) ? (t.graph as Row) : null

    if (placement !== null && !onGraph) {
      err(
        'E_GRAPH_PLACEMENT_ORPHAN',
        fileLabel(TOPICS_PATH),
        i,
        id,
        `${id} has authored graph coordinates but onGraph: false`,
      )
    }
    if (onGraph && placement === null) {
      warn('W_GRAPH_NO_PLACEMENT', fileLabel(TOPICS_PATH), i, id, `${id} is onGraph: true with no authored placement`)
    }
    if (placement !== null) {
      const order = placement.order
      if (!isInteger(order) || order < 1) {
        err(
          'E_GRAPH_ORDER_RANGE',
          fileLabel(TOPICS_PATH),
          i,
          id,
          `graph.order ${JSON.stringify(order)} must be an integer ≥ 1`,
        )
      } else {
        const prior = orders.get(order)
        if (prior !== undefined) {
          err('E_GRAPH_ORDER_DUPLICATE', fileLabel(TOPICS_PATH), i, id, `graph.order ${order} is already used by "${prior}"`)
        } else {
          orders.set(order, id ?? '?')
        }
      }
    }
    if (t.catalogue === true && !onGraph) {
      info('I_TOPIC_NOT_ON_GRAPH', fileLabel(TOPICS_PATH), i, id, `${id} is a catalogue topic with onGraph: false`)
    }
  })

  // Edges restricted to the graph-topic set.
  const pairs = edgePairs(topicEdges).filter(([a, b]) => onGraphIds.has(a) && onGraphIds.has(b))
  const outAdj = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const id of onGraphIds) indeg.set(id, 0)
  for (const [from, to] of pairs) {
    indeg.set(to, (indeg.get(to) ?? 0) + 1)
    const list = outAdj.get(from)
    if (list) list.push(to)
    else outAdj.set(from, [to])
  }
  const touched = new Set<string>()
  for (const [from, to] of pairs) {
    touched.add(from)
    touched.add(to)
  }

  const topicIndex = new Map<string, number>()
  topics.forEach((t, i) => {
    if (isString(t.id)) topicIndex.set(t.id, i)
  })

  for (const id of onGraphIds) {
    if (!touched.has(id)) {
      warn(
        'W_ORPHAN_GRAPH_TOPIC',
        fileLabel(TOPICS_PATH),
        topicIndex.get(id) ?? null,
        id,
        `${id} is on the graph but has neither an incoming nor an outgoing edge`,
      )
    }
  }

  const reachable = new Set<string>()
  const queue: string[] = []
  for (const id of onGraphIds) if ((indeg.get(id) ?? 0) === 0) queue.push(id)
  while (queue.length > 0) {
    const node = queue.shift()!
    if (reachable.has(node)) continue
    reachable.add(node)
    for (const next of outAdj.get(node) ?? []) if (!reachable.has(next)) queue.push(next)
  }
  for (const id of onGraphIds) {
    if (!reachable.has(id)) {
      warn(
        'W_UNREACHABLE',
        fileLabel(TOPICS_PATH),
        topicIndex.get(id) ?? null,
        id,
        `${id} is not reachable from any zero-in-degree graph topic`,
      )
    }
  }

  // W_SUBTOPIC_NO_QUESTIONS — `draft` subtopics are exempt (§8.5 rule 8).
  const questionCount = new Map<string, number>()
  for (const q of questions) {
    if (!isString(q.subtopicId)) continue
    questionCount.set(q.subtopicId, (questionCount.get(q.subtopicId) ?? 0) + 1)
  }
  subtopics.forEach((s, i) => {
    if (s.status === 'draft') return
    if ((questionCount.get(s.id) ?? 0) === 0) {
      warn('W_SUBTOPIC_NO_QUESTIONS', fileLabel(SUBTOPICS_PATH), i, s.id ?? null, `${s.id} has no questions`)
    }
  })

  return onGraphIds.size
}

// ---------------------------------------------------------------------------
// CHECK 9 · line-prereq-ancestry
// ---------------------------------------------------------------------------

function checkLinePrereqAncestry(): number {
  const ancestorsByTopic = buildAncestors(edgePairs(topicEdges))
  const ancestorsBySubtopic = buildAncestors(edgePairs(subtopicEdges))
  const tierA = subtopicEdges.length > 0
  let subjects = 0

  // Templates are checked alongside authored questions: they are the bulk of
  // what a student is served, and an out-of-ancestry tag on a template is a
  // wrong diagnosis repeated across every instance it generates.
  const taggedSources: Row[] = [...rowsOf(questions), ...rowsOf(questionTemplates)]
  taggedSources.forEach((q, qi) => {
    const lines: Row[] = rowsOf(q.lines)
    lines.forEach((line, li) => {
      const tags: unknown[] = isArray(line.prereqSubtopicIds) ? line.prereqSubtopicIds : []
      for (const tag of tags) {
        subjects++
        if (!isString(tag)) continue

        if (tag === q.subtopicId) {
          err(
            'E_ANCESTRY_SELF',
            fileLabel(QUESTIONS_PATH),
            qi,
            q.id ?? null,
            `line ${li} of ${q.id} tags its own subtopic ${tag}`,
          )
          continue
        }

        if (tierA) {
          const ancestors = ancestorsBySubtopic.get(q.subtopicId) ?? new Set<string>()
          if (!ancestors.has(tag)) {
            err(
              'E_ANCESTRY',
              fileLabel(QUESTIONS_PATH),
              qi,
              q.id ?? null,
              `line ${li} of ${q.id} tags ${tag}, which is not an ancestor of ${q.subtopicId} in the subtopic graph`,
            )
          }
          continue
        }

        // Tier B — the subtopic graph is empty. Same-topic sibling tags are
        // legal on purpose: build-plan §1.3 puts ~40 of a subtopic's ~160
        // candidate prerequisites inside its own topic.
        const tagTopic = parentOf(tag)
        const ancestors = ancestorsByTopic.get(q.topicId) ?? new Set<string>()
        if (tagTopic !== q.topicId && !ancestors.has(tagTopic)) {
          err(
            'E_ANCESTRY',
            fileLabel(QUESTIONS_PATH),
            qi,
            q.id ?? null,
            `line ${li} of ${q.id} tags ${tag}, but ${tagTopic} is neither ${q.topicId} nor an ancestor of it`,
          )
        }
      }
    })
  })

  return subjects
}

// ---------------------------------------------------------------------------
// CHECK 10 · question-structure
// ---------------------------------------------------------------------------

function checkStatusAndSource(row: Row, path: string, index: number, what: string): void {
  if (!oneOf(row.status, CONTENT_STATUSES)) {
    err('E_STATUS', fileLabel(path), index, row.id ?? null, `${what}.status ${JSON.stringify(row.status)} is not a ContentStatus`)
  }
  if (!oneOf(row.source, CONTENT_SOURCES)) {
    err('E_SOURCE', fileLabel(path), index, row.id ?? null, `${what}.source ${JSON.stringify(row.source)} is not a ContentSource`)
  }
}

function checkQuestionStructure(): number {
  strands.forEach((s, i) => {
    if (!isNonEmptyString(s.label)) {
      warn('W_EMPTY_STRING', fileLabel(STRANDS_PATH), i, s.id ?? null, 'Strand.label is empty')
    }
  })
  topics.forEach((t, i) => {
    checkStatusAndSource(t, TOPICS_PATH, i, 'Topic')
    if (!isNonEmptyString(t.label)) warn('W_EMPTY_STRING', fileLabel(TOPICS_PATH), i, t.id ?? null, 'Topic.label is empty')
    if (isPlainObject(t.graph) && !isNonEmptyString((t.graph as Row).label)) {
      warn('W_EMPTY_STRING', fileLabel(TOPICS_PATH), i, t.id ?? null, 'Topic.graph.label is empty')
    }
  })
  subtopics.forEach((s, i) => {
    checkStatusAndSource(s, SUBTOPICS_PATH, i, 'Subtopic')
    if (!isNonEmptyString(s.label)) {
      warn('W_EMPTY_STRING', fileLabel(SUBTOPICS_PATH), i, s.id ?? null, 'Subtopic.label is empty')
    }
  })
  graphFilters.forEach((f, i) => {
    if (!isNonEmptyString(f.label)) {
      warn('W_EMPTY_STRING', fileLabel(FILTERS_PATH), i, f.id ?? null, 'GraphFilter.label is empty')
    }
  })

  questions.forEach((q, i) => {
    const file = fileLabel(QUESTIONS_PATH)
    const id = isString(q.id) ? q.id : null
    checkStatusAndSource(q, QUESTIONS_PATH, i, 'Question')

    const lines: Row[] = rowsOf(q.lines)
    if (lines.length === 0) {
      err('E_QUESTION_NO_LINES', file, i, id, 'lines is empty')
    } else if (!isInteger(q.errorLineIndex) || q.errorLineIndex < 0 || q.errorLineIndex > lines.length - 1) {
      err(
        'E_ERR_LINE_INDEX',
        file,
        i,
        id,
        `errorLineIndex ${JSON.stringify(q.errorLineIndex)} is outside 0..${lines.length - 1}`,
      )
    }

    if (!oneOf(q.difficulty, DIFFICULTY_TIERS)) {
      err('E_DIFFICULTY', file, i, id, `difficulty ${JSON.stringify(q.difficulty)} is not a DifficultyTier`)
    }

    if (q.distractors !== undefined) {
      const ds: Row[] = rowsOf(q.distractors)
      if (ds.length < 3) {
        err('E_DISTRACTOR_COUNT', file, i, id, `distractors is present with ${ds.length} entries; PracticeLoop needs ≥ 3`)
      }
      for (const d of ds) {
        if (d.text === q.correctAnswer) {
          err('E_DISTRACTOR_COLLIDES', file, i, id, `distractor "${d.text}" equals correctAnswer`)
        }
        if (!isNonEmptyString(d.cause)) {
          warn('W_DISTRACTOR_NO_CAUSE', file, i, id, `distractor "${d.text}" has no named misconception`)
        }
      }
    }

    for (const field of ['prompt', 'statement', 'correctAnswer'] as const) {
      if (!isNonEmptyString(q[field])) warn('W_EMPTY_STRING', file, i, id, `${field} is empty`)
    }
  })

  return questions.length
}

// ---------------------------------------------------------------------------
// CHECK 11 · sample-integrity
// ---------------------------------------------------------------------------

function checkSampleIntegrity(): number {
  let subjects = 0

  const dupFiles: Array<[string, Row[]]> = [
    [NODE_STATES_PATH, nodeStates],
    [PROFILES_PATH, profiles],
    [ACTIVITY_PATH, activityLogs],
  ]
  for (const [path, rows] of dupFiles) {
    const seen = new Set<string>()
    rows.forEach((r, i) => {
      if (!isString(r.studentId)) return
      if (seen.has(r.studentId)) {
        err('E_SAMPLE_DUPLICATE_STUDENT', fileLabel(path), i, r.studentId, `studentId "${r.studentId}" appears twice`)
      }
      seen.add(r.studentId)
    })
  }

  nodeStates.forEach((ns, i) => {
    const nodes = isPlainObject(ns.nodes) ? (ns.nodes as Row) : {}
    const keys = Object.keys(nodes)
    subjects += keys.length
    for (const key of keys) {
      const state = nodes[key]
      if (!isPlainObject(state) || !oneOf(state.status, NODE_STATUSES)) {
        err(
          'E_SAMPLE_STATUS',
          fileLabel(NODE_STATES_PATH),
          i,
          ns.studentId ?? null,
          `${key}.status ${JSON.stringify(isPlainObject(state) ? state.status : state)} is not a NodeStatus`,
        )
      }
    }
    const missing = [...onGraphIds].filter((id) => keys.indexOf(id) === -1)
    if (missing.length > 0) {
      warn(
        'W_SAMPLE_COVERAGE',
        fileLabel(NODE_STATES_PATH),
        i,
        ns.studentId ?? null,
        `covers ${keys.length} of ${onGraphIds.size} graph topics; missing ${missing.join(', ')}`,
      )
    }
  })

  return subjects
}

// ---------------------------------------------------------------------------
// CHECK 12 · graph-version
// ---------------------------------------------------------------------------

function checkGraphVersion(): number {
  const pairs: Array<[string, string, string]> = [
    ['topic', TOPIC_EDGES_PATH, 'topicGraphVersion'],
    ['subtopic', SUBTOPIC_EDGES_PATH, 'subtopicGraphVersion'],
  ]
  const hashes = isPlainObject(meta.graphHashes) ? (meta.graphHashes as Row) : {}

  for (const [key, path, versionField] of pairs) {
    if (!isNonEmptyString(meta[versionField])) {
      err('E_GRAPH_VERSION_EMPTY', fileLabel(META_PATH), null, null, `${versionField} is empty`)
    }
    const recorded = hashes[key]
    if (recorded === '' || recorded === undefined || recorded === null) {
      warn('W_GRAPH_HASH_UNSET', fileLabel(META_PATH), null, null, `graphHashes.${key} is unset — run --write-hashes`)
      continue
    }
    const actual = hashEdgeFile(path)
    if (recorded !== actual) {
      err(
        'E_GRAPH_VERSION_STALE',
        fileLabel(META_PATH),
        null,
        null,
        `graphHashes.${key} is ${String(recorded).slice(0, 12)}… but ${path} hashes to ${actual.slice(0, 12)}… — re-run --write-hashes and bump ${versionField}`,
      )
    }
  }
  return pairs.length
}

// ---------------------------------------------------------------------------
// Run every check, in order. Nothing short-circuits.
// ---------------------------------------------------------------------------

const CHECKS: Array<{ name: string; unit: string; run: () => number }> = [
  { name: 'file-envelope', unit: 'files', run: checkFileEnvelope },
  { name: 'id-grammar', unit: 'ids', run: checkIdGrammar },
  { name: 'id-containment', unit: 'ids', run: checkIdContainment },
  { name: 'id-uniqueness', unit: 'ids', run: checkIdUniqueness },
  { name: 'referential-integrity', unit: 'references', run: checkReferentialIntegrity },
  { name: 'dag-acyclicity', unit: 'edges', run: checkDagAcyclicity },
  { name: 'year-band-monotonicity', unit: 'edges', run: checkYearBandMonotonicity },
  { name: 'reachability', unit: 'graph topics', run: checkReachability },
  { name: 'line-prereq-ancestry', unit: 'tags', run: checkLinePrereqAncestry },
  { name: 'question-structure', unit: 'questions', run: checkQuestionStructure },
  { name: 'sample-integrity', unit: 'node states', run: checkSampleIntegrity },
  { name: 'graph-version', unit: 'edge files', run: checkGraphVersion },
]

const reports: CheckReport[] = CHECKS.map((c) => {
  currentCheck = c.name
  const before = findings.length
  const subjects = c.run()
  const mine = findings.slice(before)
  return {
    name: c.name,
    unit: c.unit,
    subjects,
    errors: mine.filter((f) => f.severity === 'error').length,
    warnings: mine.filter((f) => f.severity === 'warning').length,
    infos: mine.filter((f) => f.severity === 'info').length,
  }
})
currentCheck = ''

// ---------------------------------------------------------------------------
// Counts for the header and for --json
// ---------------------------------------------------------------------------

let questionLines = 0
let lineTags = 0
let distractorCount = 0
for (const q of questions) {
  const lines: Row[] = rowsOf(q.lines)
  questionLines += lines.length
  for (const l of lines) lineTags += isArray(l.prereqSubtopicIds) ? l.prereqSubtopicIds.length : 0
  distractorCount += isArray(q.distractors) ? q.distractors.length : 0
}
let sampleNodeStateCount = 0
for (const ns of nodeStates) sampleNodeStateCount += isPlainObject(ns.nodes) ? Object.keys(ns.nodes).length : 0
let activityCount = 0
for (const a of activityLogs) activityCount += isArray(a.activities) ? a.activities.length : 0

const counts = {
  files: files.filter((f) => f.exists).length,
  strands: strands.length,
  topics: topics.length,
  subtopics: subtopics.length,
  questions: questions.length,
  questionLines,
  lineTags,
  distractors: distractorCount,
  topicEdges: topicEdges.length,
  subtopicEdges: subtopicEdges.length,
}

const errorCount = findings.filter((f) => f.severity === 'error').length
const warningCount = findings.filter((f) => f.severity === 'warning').length
const failed = errorCount > 0 || (opts.strict && warningCount > 0)

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

if (opts.json) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: !failed,
        dir: DIR_LABEL,
        counts,
        checks: reports.map((r) => ({ name: r.name, subjects: r.subjects, errors: r.errors, warnings: r.warnings })),
        findings: opts.verbose ? findings : findings.filter((f) => f.severity !== 'info'),
        errors: errorCount,
        warnings: warningCount,
      },
      null,
      2,
    )}\n`,
  )
  process.exit(failed ? 1 : 0)
}

const out: string[] = []
const pad = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length))

out.push(`anadromos · content validation · ${DIR_LABEL}/`)

const headerRow = (label: string, line: string) => out.push(`  ${pad(label, 14)}${line}`)
const headerCont = (line: string) => out.push(`  ${' '.repeat(14)}${line}`)

headerRow('meta', `schemaVersion ${meta.schemaVersion ?? '?'} · contentVersion ${meta.contentVersion ?? '?'}`)
headerCont(
  `topicGraphVersion ${meta.topicGraphVersion ?? '?'} · subtopicGraphVersion ${meta.subtopicGraphVersion ?? '?'}`,
)
headerRow(
  'curriculum',
  `${plural(strands.length, 'strand')} · ${plural(topics.length, 'topic')} (${onGraphIds.size} on graph, ${
    topics.filter((t) => t.catalogue === true).length
  } in catalogue) · ${plural(subtopics.length, 'subtopic')}`,
)
headerCont(
  `${plural(topicEdges.length, 'topic edge')} · ${plural(subtopicEdges.length, 'subtopic edge')} · ${plural(
    questions.length,
    'question',
  )} · ${plural(questionLines, 'line')} · ${plural(lineTags, 'line tag')}`,
)
headerCont(
  `${plural(distractorCount, 'distractor')} · ${plural(reteachCards.length, 'reteach card')} · ${plural(
    lessons.length,
    'lesson',
  )} · ${plural(graphFilters.length, 'graph filter')}`,
)
headerRow(
  'school',
  `${plural(teachers.length, 'teacher')} · ${plural(classes.length, 'class', 'classes')} · ${plural(
    roster.length,
    'roster name',
  )} · ${plural(basket.length, 'basket topic')}`,
)
headerRow(
  'samples',
  `${plural(nodeStates.length, 'student')} · ${plural(sampleNodeStateCount, 'node state')} · ${plural(
    profiles.length,
    'profile',
  )} · ${plural(activityCount, 'activity', 'activities')} · ${plural(oversight.length, 'oversight item')}`,
)
out.push('')

for (const r of reports) {
  const visible = findings.filter((f) => f.check === r.name && (opts.verbose || f.severity !== 'info'))
  const shownErrors = opts.strict ? r.errors + r.warnings : r.errors
  const shownWarnings = opts.strict ? 0 : r.warnings
  const symbol = shownErrors > 0 ? '✗' : shownWarnings > 0 ? '⚠' : '✓'
  const tail: string[] = []
  if (shownErrors > 0) tail.push(plural(shownErrors, 'error'))
  if (shownWarnings > 0) tail.push(plural(shownWarnings, 'warning'))
  if (opts.verbose && r.infos > 0) tail.push(plural(r.infos, 'info'))
  out.push(`  ${symbol} ${pad(r.name, 24)}${r.subjects} ${r.unit}${tail.length ? ` · ${tail.join(' · ')}` : ''}`)

  for (const f of visible) {
    const where = f.index === null ? f.file : `${f.file}[${f.index}]`
    const head = `      ${f.code}  `
    out.push(`${head}${where}`)
    out.push(`${' '.repeat(head.length)}${f.message}`)
  }
}

out.push('')
const summaryErrors = opts.strict ? errorCount + warningCount : errorCount
const summaryWarnings = opts.strict ? 0 : warningCount
out.push(
  `  ${plural(counts.files, 'file')} · ${plural(reports.length, 'check')} · ${plural(
    summaryErrors,
    'error',
  )} · ${plural(summaryWarnings, 'warning')}${opts.strict ? ' · --strict' : ''}`,
)
out.push('')

process.stdout.write(`${out.join('\n')}\n`)
process.exit(failed ? 1 : 0)
