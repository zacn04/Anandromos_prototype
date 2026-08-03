/**
 * Question templates: one authored item, unlimited instances.
 *
 * A template stores `{a}x − {b} = {a*x - b}` with constraints on a, b and x,
 * rather than the single frozen instance `3x − 7 = 11`. Instantiating it with a
 * seed produces an ordinary `Question` — the exact type the practice loop, the
 * engine and the activity log already consume — so nothing downstream knows or
 * cares that the question was computed rather than authored.
 *
 * Two consequences worth being explicit about:
 *
 * 1. **Marginal cost per student is zero.** A generated template is paid for
 *    once and serves an unbounded number of distinct questions forever. This is
 *    the difference between buying a question bank and buying a question
 *    *generator*.
 * 2. **Practice stops being exhaustible.** Free play toward automaticity, which
 *    the design brief wants and which a fixed bank makes impossible past a few
 *    dozen reps, becomes genuinely unlimited.
 *
 * Expressions are evaluated by the small recursive-descent parser below, not by
 * `eval` or `Function`. Template content is authored and AI-generated data, and
 * data must never become executable.
 */
import type {
  Distractor, DifficultyTier, ContentSource, ContentStatus,
  Question, QuestionLine, SubtopicId, TopicId,
} from './schema'

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface TemplateParam {
  name: string
  /** Inclusive integer range the parameter is drawn from. */
  min: number
  max: number
  /** Values to never draw — typically 0, or 1 where it would make a step vacuous. */
  exclude?: readonly number[]
}

export interface TemplateLine {
  /** May contain `{expr}` placeholders. */
  text: string
  note: string
  prereqSubtopicIds: readonly SubtopicId[]
}

export interface QuestionTemplate {
  id: string
  topicId: TopicId
  subtopicId: SubtopicId
  familyId: string
  difficulty: DifficultyTier
  params: readonly TemplateParam[]
  /**
   * Boolean expressions that must all hold for a draw to be accepted.
   * Rejection sampling: draws that fail are discarded and redrawn. Keep them
   * satisfiable — a constraint no draw can meet makes the template unusable,
   * which `validateTemplate` checks for rather than leaving to a student.
   */
  constraints: readonly string[]
  prompt: string
  statement: string
  answerLabel: string
  correctAnswer: string
  lines: readonly TemplateLine[]
  errorLineIndex: number
  distractors?: readonly { text: string; cause: string }[]
  boardStyle?: string | null
  source: ContentSource
  status: ContentStatus
}

// ---------------------------------------------------------------------------
// expression evaluation
// ---------------------------------------------------------------------------

type Env = Readonly<Record<string, number>>

/**
 * Recursive-descent evaluator for integer-ish arithmetic and comparisons.
 *
 * Grammar (loosest to tightest):
 *   or   := and ( '||' and )*
 *   and  := cmp ( '&&' cmp )*
 *   cmp  := sum ( ('=='|'!='|'<='|'>='|'<'|'>') sum )?
 *   sum  := prod ( ('+'|'-') prod )*
 *   prod := unary ( ('*'|'/'|'%') unary )*
 *   unary:= '-' unary | atom
 *   atom := number | ident | 'fn' '(' args ')' | '(' or ')'
 *
 * Booleans are 1/0 so comparisons compose with arithmetic without a second type.
 */
class ExprParser {
  private pos = 0
  // Written out rather than as constructor parameter properties, which
  // `erasableSyntaxOnly` (set in tsconfig) disallows.
  private readonly src: string
  private readonly env: Env

  constructor(src: string, env: Env) {
    this.src = src
    this.env = env
  }

  static evaluate(src: string, env: Env): number {
    const p = new ExprParser(src, env)
    const v = p.parseOr()
    p.skipSpace()
    if (p.pos < p.src.length) {
      throw new Error(`unexpected "${p.src.slice(p.pos)}" in expression "${src}"`)
    }
    return v
  }

  private skipSpace() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++
  }

  private eat(tok: string): boolean {
    this.skipSpace()
    if (this.src.startsWith(tok, this.pos)) {
      this.pos += tok.length
      return true
    }
    return false
  }

  private parseOr(): number {
    let left = this.parseAnd()
    for (;;) {
      if (this.eat('||')) {
        // Parse the right operand BEFORE combining. Writing this as
        // `left || this.parseAnd()` lets JS short-circuit when `left` is
        // truthy, which skips the parse and leaves the operand unconsumed.
        const right = this.parseAnd()
        left = left || right ? 1 : 0
      } else return left
    }
  }

  private parseAnd(): number {
    let left = this.parseCmp()
    for (;;) {
      if (this.eat('&&')) {
        const right = this.parseCmp()
        left = left && right ? 1 : 0
      } else return left
    }
  }

  private parseCmp(): number {
    const left = this.parseSum()
    // Longer operators first: '<=' must not be read as '<'.
    for (const op of ['==', '!=', '<=', '>=', '<', '>'] as const) {
      if (this.eat(op)) {
        const right = this.parseSum()
        switch (op) {
          case '==': return left === right ? 1 : 0
          case '!=': return left !== right ? 1 : 0
          case '<=': return left <= right ? 1 : 0
          case '>=': return left >= right ? 1 : 0
          case '<': return left < right ? 1 : 0
          case '>': return left > right ? 1 : 0
        }
      }
    }
    return left
  }

  private parseSum(): number {
    let left = this.parseProd()
    for (;;) {
      this.skipSpace()
      // Guard against consuming the '-' of '->' or the '=' of '=='.
      if (this.src[this.pos] === '+') { this.pos++; left += this.parseProd() }
      else if (this.src[this.pos] === '-') { this.pos++; left -= this.parseProd() }
      else return left
    }
  }

  private parseProd(): number {
    let left = this.parseUnary()
    for (;;) {
      this.skipSpace()
      const c = this.src[this.pos]
      if (c === '*') { this.pos++; left *= this.parseUnary() }
      else if (c === '/') {
        this.pos++
        const d = this.parseUnary()
        if (d === 0) throw new Error(`division by zero in "${this.src}"`)
        left /= d
      } else if (c === '%') {
        this.pos++
        const d = this.parseUnary()
        if (d === 0) throw new Error(`modulo by zero in "${this.src}"`)
        left %= d
      } else return left
    }
  }

  private parseUnary(): number {
    this.skipSpace()
    if (this.src[this.pos] === '-') { this.pos++; return -this.parseUnary() }
    if (this.src[this.pos] === '+') { this.pos++; return this.parseUnary() }
    return this.parseAtom()
  }

  private parseAtom(): number {
    this.skipSpace()
    if (this.eat('(')) {
      const v = this.parseOr()
      if (!this.eat(')')) throw new Error(`missing ) in "${this.src}"`)
      return v
    }

    const num = /^\d+(\.\d+)?/.exec(this.src.slice(this.pos))
    if (num) { this.pos += num[0].length; return Number(num[0]) }

    const ident = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(this.src.slice(this.pos))
    if (ident) {
      this.pos += ident[0].length
      const name = ident[0]
      if (this.eat('(')) {
        const args: number[] = [this.parseOr()]
        while (this.eat(',')) args.push(this.parseOr())
        if (!this.eat(')')) throw new Error(`missing ) after ${name}(`)
        return applyFn(name, args, this.src)
      }
      if (!(name in this.env)) throw new Error(`unknown parameter "${name}" in "${this.src}"`)
      return this.env[name]
    }

    throw new Error(`cannot parse "${this.src.slice(this.pos)}" in "${this.src}"`)
  }
}

function applyFn(name: string, args: number[], src: string): number {
  switch (name) {
    case 'abs': return Math.abs(args[0])
    case 'min': return Math.min(...args)
    case 'max': return Math.max(...args)
    case 'sign': return Math.sign(args[0])
    case 'round': return Math.round(args[0])
    case 'floor': return Math.floor(args[0])
    case 'ceil': return Math.ceil(args[0])
    case 'gcd': return gcd(Math.abs(args[0]), Math.abs(args[1]))
    case 'pow': return args[0] ** args[1]
    default: throw new Error(`unknown function "${name}" in "${src}"`)
  }
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

/** Exported for the validator and tests. Throws on a malformed expression. */
export function evaluateExpression(src: string, env: Env): number {
  return ExprParser.evaluate(src, env)
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/**
 * Numbers as a student would write them: integers bare, fractions to at most
 * three decimals with trailing zeros trimmed. A value like 0.30000000000000004
 * must never reach a question.
 */
export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  const rounded = Number(n.toFixed(3))
  return String(rounded)
}

/** Substitutes every `{expr}` in `text` with its evaluated, formatted value. */
export function renderTemplateString(text: string, env: Env): string {
  return text.replace(/\{([^}]+)\}/g, (_, expr: string) =>
    formatNumber(evaluateExpression(expr.trim(), env)),
  )
}

// ---------------------------------------------------------------------------
// instantiation
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and good enough for choosing question numbers. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MAX_DRAWS = 400

export class TemplateError extends Error {}

/**
 * Draws a parameter set satisfying every constraint.
 *
 * Rejection sampling. Deterministic in `seed`, so the same seed always yields
 * the same question — which is what lets a student reload mid-attempt, or a
 * teacher open the exact item a student saw, without storing the instance.
 */
export function drawParams(template: QuestionTemplate, seed: number): Env {
  const next = rng(seed)
  for (let attempt = 0; attempt < MAX_DRAWS; attempt++) {
    const env: Record<string, number> = {}
    for (const p of template.params) {
      const span = p.max - p.min + 1
      let v = p.min + Math.floor(next() * span)
      // Redraw excluded values rather than clamping, which would bias the ends.
      let guard = 0
      while (p.exclude?.includes(v) && guard++ < 50) {
        v = p.min + Math.floor(next() * span)
      }
      env[p.name] = v
    }
    if (template.constraints.every((c) => evaluateExpression(c, env) !== 0)) return env
  }
  throw new TemplateError(
    `template ${template.id}: no parameter draw satisfied the constraints in ${MAX_DRAWS} attempts`,
  )
}

/**
 * Produces a concrete `Question` from a template.
 *
 * The returned object is indistinguishable from a hand-authored one — same
 * shape, same fields — so `PracticeLoop`, `ReviewSession`, the engine and the
 * activity log need no changes at all. The generated id encodes the seed so an
 * instance a student saw can always be reproduced exactly.
 */
export function instantiate(template: QuestionTemplate, seed: number): Question {
  const env = drawParams(template, seed)

  const lines: QuestionLine[] = template.lines.map((l) => ({
    text: renderTemplateString(l.text, env),
    note: renderTemplateString(l.note, env),
    prereqSubtopicIds: l.prereqSubtopicIds,
  }))

  const distractors: Distractor[] | undefined = template.distractors?.map((d) => ({
    text: renderTemplateString(d.text, env),
    cause: renderTemplateString(d.cause, env),
  }))

  // A distractor that collides with the right answer teaches nothing and, in the
  // MCQ retry, would mark a correct choice wrong. Drop collisions rather than
  // shipping them; the loop already tolerates a question with no distractors.
  const correctAnswer = renderTemplateString(template.correctAnswer, env)
  const cleanDistractors = distractors?.filter(
    (d, i, all) => d.text !== correctAnswer && all.findIndex((o) => o.text === d.text) === i,
  )

  return {
    id: `${template.id}#${seed}`,
    topicId: template.topicId,
    subtopicId: template.subtopicId,
    familyId: template.familyId,
    difficulty: template.difficulty,
    // Rendered like every other authored string: a template may legitimately
    // put a parameter in the prompt ("Round {n} to the nearest 10"), and
    // leaving these two unrendered leaked raw {placeholders} onto the screen.
    prompt: renderTemplateString(template.prompt, env),
    statement: renderTemplateString(template.statement, env),
    answerLabel: renderTemplateString(template.answerLabel, env),
    correctAnswer,
    lines,
    errorLineIndex: template.errorLineIndex,
    distractors: cleanDistractors && cleanDistractors.length >= 3 ? cleanDistractors : undefined,
    boardStyle: template.boardStyle ?? null,
    aliases: [],
    source: template.source,
    reviewedAt: null,
    status: template.status,
  }
}

export interface TemplateProblem {
  templateId: string
  message: string
}

/**
 * Static checks for one template, run offline by the content validator.
 *
 * The important one is satisfiability: a template whose constraints no draw can
 * meet is a runtime failure in front of a student, and there is no reason to
 * discover that in production when it can be discovered at build time.
 */
export function validateTemplate(template: QuestionTemplate, samples = 24): TemplateProblem[] {
  const problems: TemplateProblem[] = []
  const fail = (message: string) => problems.push({ templateId: template.id, message })

  const names = new Set(template.params.map((p) => p.name))
  if (names.size !== template.params.length) fail('duplicate parameter names')
  for (const p of template.params) {
    if (p.min > p.max) fail(`parameter ${p.name} has min > max`)
  }
  if (template.errorLineIndex < 0 || template.errorLineIndex >= template.lines.length) {
    fail(`errorLineIndex ${template.errorLineIndex} is outside lines[0..${template.lines.length - 1}]`)
  }

  let drawn = 0
  const seen = new Set<string>()
  for (let i = 0; i < samples; i++) {
    try {
      const q = instantiate(template, 1000 + i * 7919)
      drawn++
      seen.add(q.statement)
      if (!q.statement.trim()) fail('renders an empty statement')
      if (!q.correctAnswer.trim()) fail('renders an empty answer')
      if (/[{}]/.test(q.statement + q.correctAnswer + q.lines.map((l) => l.text).join())) {
        fail('rendered output still contains { } — an unclosed placeholder')
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
      break
    }
  }

  // A template that always renders the same question is a fixed question with
  // extra steps — worth flagging, since it usually means over-tight constraints.
  if (drawn >= samples && seen.size === 1) {
    fail('every draw renders an identical question — constraints may be too tight')
  }

  return problems
}
