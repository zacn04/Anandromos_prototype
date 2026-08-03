/**
 * Hand-rolled structural predicates, the ID grammar, and the normative
 * `slugify()` producer. Spec §1.2, §1.3, §8.
 *
 * This module is compiled by BOTH `tsconfig.app.json` and `tsconfig.node.json`:
 * the browser loader's dev-only `assertContentBundle` and the offline CLI
 * (`scripts/validate-content.ts`) share one implementation, so the grammar and
 * the slugger can never drift apart (§1.3, §8.1).
 *
 * Zero dependencies and zero imports — not even type imports. Constraint 6 bans
 * a schema library in the browser bundle, and keeping this file import-free
 * means Node's native type stripping can run it with no resolution step at all.
 */

// ---------------------------------------------------------------------------
// §1.2 — the ID grammar. Every regex is built from one shared SEG constant so
// the four cannot drift.
// ---------------------------------------------------------------------------

export const SEG = '[a-z0-9]+(?:-[a-z0-9]+)*'

export const RE_SEGMENT = new RegExp(`^${SEG}$`)
export const RE_STRAND = new RegExp(`^${SEG}$`)
export const RE_TOPIC = new RegExp(`^${SEG}\\.${SEG}$`)
export const RE_SUBTOPIC = new RegExp(`^${SEG}\\.${SEG}\\.${SEG}$`)
export const RE_QUESTION = new RegExp(`^${SEG}\\.${SEG}\\.${SEG}\\.${SEG}$`)

/** Checked separately from the regexes so the error can name the segment. */
export const MAX_SEGMENT_LENGTH = 40

// §1.5 — the five id namespaces that deliberately sit outside the dotted
// hierarchy. Each has its own grammar.
export const RE_GRAPH_FILTER_ID = new RegExp(`^filter\\.${SEG}$`)
export const RE_TEACHER_ID = new RegExp(`^teacher\\.${SEG}$`)
export const RE_CLASS_ID = /^[0-9][A-Z][0-9A-Z]*$/
export const RE_STUDENT_ID = new RegExp(`^${SEG}$`)
export const RE_FAMILY_ID = new RegExp(`^${SEG}$`)

/** Number of dot-segments an entity id of each level carries (§1.1). */
export const ID_LEVELS = {
  strand: 1,
  topic: 2,
  subtopic: 3,
  question: 4,
} as const

export type IdLevel = keyof typeof ID_LEVELS

const LEVEL_REGEX: Record<IdLevel, RegExp> = {
  strand: RE_STRAND,
  topic: RE_TOPIC,
  subtopic: RE_SUBTOPIC,
  question: RE_QUESTION,
}

export function regexForLevel(level: IdLevel): RegExp {
  return LEVEL_REGEX[level]
}

export function segmentsOf(id: string): string[] {
  return id.split('.')
}

/** `num.fractions.to-decimal` → `num.fractions`. '' when there is no parent. */
export function parentOf(id: string): string {
  const i = id.lastIndexOf('.')
  return i === -1 ? '' : id.slice(0, i)
}

/** The final dot-segment of an id. */
export function lastSegmentOf(id: string): string {
  const i = id.lastIndexOf('.')
  return i === -1 ? id : id.slice(i + 1)
}

/** True when every segment of `id` matches SEGMENT, ignoring segment count. */
export function segmentsWellFormed(id: string): boolean {
  const segs = segmentsOf(id)
  return segs.length > 0 && segs.every((s) => RE_SEGMENT.test(s))
}

/** The first segment longer than MAX_SEGMENT_LENGTH, or null. */
export function overlongSegment(id: string): string | null {
  for (const s of segmentsOf(id)) {
    if (s.length > MAX_SEGMENT_LENGTH) return s
  }
  return null
}

// ---------------------------------------------------------------------------
// §1.3 — slugify(). Normative. Every generator from Phase 1 onward MUST use it.
// ---------------------------------------------------------------------------

/**
 * Transliteration table (§1.3, exhaustive). Extend it HERE, never at a call
 * site. Applied longest key first so a multi-character key can never be eaten
 * by a single-character one.
 */
export const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  'π': 'pi',
  '√': 'root',
  '∑': 'sum',
  '×': 'x',
  '÷': 'div',
  '≥': 'ge',
  '≤': 'le',
  '≠': 'ne',
  '°': 'deg',
  '£': 'gbp',
  '→': 'to',
  '%': 'percent',
  '&': 'and',
  '+': 'plus',
  '=': 'equals',
}

const TRANSLITERATION_KEYS = Object.keys(TRANSLITERATIONS).sort((a, b) => b.length - a.length)

/**
 * Produces a grammar-conformant segment from a human label (§1.3).
 *
 * Note: §2's hand-authored ids are NOT slugify() output and are not retro-
 * slugged (`Rounding & estimation` → `num.rounding`). From Phase 1, generated
 * ids must be.
 *
 * @throws when the label slugs to nothing — that entity needs a human.
 */
export function slugify(label: string): string {
  let s = label.normalize('NFKD')

  // 2. Transliterate, longest key first, padded so it never fuses with a word.
  for (const key of TRANSLITERATION_KEYS) {
    if (s.indexOf(key) === -1) continue
    s = s.split(key).join(` ${TRANSLITERATIONS[key]} `)
  }

  // 3-6. Strip combining marks, lowercase, collapse to hyphens, trim.
  s = s.replace(/\p{M}+/gu, '')
  s = s.toLowerCase()
  s = s.replace(/[^a-z0-9]+/g, '-')
  s = s.replace(/-+/g, '-').replace(/^-+/, '').replace(/-+$/, '')

  // 7. Empty is a human's problem, not a silent id.
  if (s === '') {
    throw new Error(`slugify(): "${label}" produced an empty segment`)
  }

  // 8. Truncate at the last '-' at or before index MAX_SEGMENT_LENGTH.
  if (s.length > MAX_SEGMENT_LENGTH) {
    const window = s.slice(0, MAX_SEGMENT_LENGTH + 1)
    const cut = window.lastIndexOf('-')
    s = cut > 0 ? s.slice(0, cut) : s.slice(0, MAX_SEGMENT_LENGTH)
    s = s.replace(/-+$/, '')
  }

  return s
}

/**
 * §1.3's sibling collision rule. `taken` is the set of segments already claimed
 * under the same parent; the first claimant keeps the bare slug.
 */
export function slugifyUnique(label: string, taken: ReadonlySet<string>): string {
  const base = slugify(label)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    let stem = base
    if (stem.length + suffix.length > MAX_SEGMENT_LENGTH) {
      stem = stem.slice(0, MAX_SEGMENT_LENGTH - suffix.length).replace(/-+$/, '')
    }
    const candidate = `${stem}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

// ---------------------------------------------------------------------------
// Enum membership. Mirrors schema.ts's unions; kept as runtime arrays because
// a TypeScript union has no runtime form and the CLI must check parsed JSON.
// ---------------------------------------------------------------------------

export const CONTENT_STATUSES = [
  'draft',
  'generated',
  'in-review',
  'verified',
  'rejected',
  'retired',
] as const

export const CONTENT_SOURCES = ['ai', 'teacher', 'imported'] as const
export const DIFFICULTY_TIERS = ['foundations', 'core', 'stretch'] as const
export const NODE_STATUSES = ['mastered', 'inprogress', 'frontier', 'notready', 'locked'] as const
export const PREREQ_EDGE_SOURCES = ['ai', 'teacher', 'empirical'] as const
export const EXAM_BOARDS = ['aqa', 'edexcel', 'ocr', 'wjec'] as const
export const EXAM_TIERS = ['foundation', 'higher', 'both'] as const
export const RETEACH_SCOPES = [
  'Focused re-teach',
  'Quick reminder',
  'Full walk-back',
  'No re-teach needed',
] as const

/** §4.3's 17 `kind` values. `meta` and `class-defaults` carry no `items`. */
export const CONTENT_KINDS = [
  'meta',
  'class-defaults',
  'strand',
  'topic',
  'subtopic',
  'topic-prereq-edge',
  'subtopic-prereq-edge',
  'graph-filter',
  'question',
  'reteach-card',
  'lesson',
  'teacher',
  'school-class',
  'student-node-states',
  'student-profile',
  'student-activity-log',
  'oversight-item',
] as const

/** The two kinds exempt from the `items` envelope, and from nothing else. */
export const ENVELOPE_EXEMPT_KINDS = ['meta', 'class-defaults'] as const

export const SCHEMA_VERSION = 1

/** §4.1's 17 content files, in read order, with the `kind` each must declare. */
export const CONTENT_FILES = [
  { path: 'curriculum/meta.json', kind: 'meta' },
  { path: 'curriculum/strands.json', kind: 'strand' },
  { path: 'curriculum/topics.json', kind: 'topic' },
  { path: 'curriculum/subtopics.json', kind: 'subtopic' },
  { path: 'curriculum/prereq-edges.topic.json', kind: 'topic-prereq-edge' },
  { path: 'curriculum/prereq-edges.subtopic.json', kind: 'subtopic-prereq-edge' },
  { path: 'curriculum/graph-filters.json', kind: 'graph-filter' },
  { path: 'curriculum/lessons.json', kind: 'lesson' },
  { path: 'curriculum/questions.json', kind: 'question' },
  { path: 'curriculum/reteach-cards.json', kind: 'reteach-card' },
  { path: 'school/teachers.json', kind: 'teacher' },
  { path: 'school/classes.json', kind: 'school-class' },
  { path: 'school/class-defaults.json', kind: 'class-defaults' },
  { path: 'samples/node-states.json', kind: 'student-node-states' },
  { path: 'samples/student-profiles.json', kind: 'student-profile' },
  { path: 'samples/activity-log.json', kind: 'student-activity-log' },
  { path: 'samples/oversight.json', kind: 'oversight-item' },
] as const

// ---------------------------------------------------------------------------
// Structural predicates. Deliberately tiny and total: every one takes `unknown`
// and narrows, so both the CLI (parsed JSON) and the loader (untrusted bundle)
// can lean on them without a cast.
// ---------------------------------------------------------------------------

export function isString(v: unknown): v is string {
  return typeof v === 'string'
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function isInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

export function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v)
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString)
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === 'string' && (allowed as readonly string[]).indexOf(v) > -1
}

/** ISO-8601 date (`YYYY-MM-DD`) or null. `reviewedAt`'s shape. */
export function isIsoDateOrNull(v: unknown): v is string | null {
  return v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
}

/** 0..1 inclusive. `strength` and `confidence`. */
export function isUnitInterval(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

// ---------------------------------------------------------------------------
// Levenshtein distance — W_ID_NEAR_DUPLICATE (§8.5 rule 4). Two-row DP; the
// inputs are single id segments, so it is never asked for anything large.
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const swap = prev
    prev = curr
    curr = swap
  }
  return prev[b.length]
}

/** §8.5 rule 4's documented tuning knobs for W_ID_NEAR_DUPLICATE. */
export const NEAR_DUPLICATE_MIN_LENGTH = 6
export const NEAR_DUPLICATE_MAX_DISTANCE = 3
