/**
 * Behavioural smoke test for the question-template engine.
 *
 * Proves the three claims the template design rests on: instances are
 * unlimited and varied, they are reproducible from a seed, and they are
 * mathematically correct — a template that renders a wrong worked solution is
 * far worse than no template at all.
 */
import {
  evaluateExpression, formatNumber, renderTemplateString,
  instantiate, drawParams, validateTemplate,
} from '../src/content/template.ts'
import type { QuestionTemplate } from '../src/content/template.ts'
// Imported rather than read from disk: this module lives in the app tsconfig
// project (it imports from src/), which has no node types.
import templateFile from '../content/curriculum/question-templates.json'
import { loadContent } from '../src/content/load.ts'
import {
  questionsForSubtopic, questionById, questionAt, similarQuestion,
} from '../src/content/accessors.ts'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  [32m✓[0m ${name}`)
  else { failures++; console.log(`  [31m✗[0m ${name}${detail ? `\n      ${detail}` : ''}`) }
}

const templates = templateFile.items as unknown as QuestionTemplate[]

// ---------------------------------------------------------------------------
console.log('\nexpression evaluator')
// ---------------------------------------------------------------------------
{
  const e = (s: string, env = {}) => evaluateExpression(s, env)
  check('arithmetic and precedence', e('2 + 3 * 4') === 14)
  check('parentheses', e('(2 + 3) * 4') === 20)
  check('unary minus', e('-5 + 2') === -3)
  check('modulo', e('100 % 8') === 4)
  check('variables', evaluateExpression('a * x - b', { a: 3, x: 5, b: 2 }) === 13)
  check('comparisons yield 1/0', e('3 > 2') === 1 && e('2 > 3') === 0)
  check('&& and ||', e('1 && 0') === 0 && e('1 || 0') === 1)
  check('<= is not read as <', e('3 <= 3') === 1)
  check('gcd', e('gcd(12, 18)') === 6)
  check('abs / min / max', e('abs(-4)') === 4 && e('min(3,7)') === 3 && e('max(3,7)') === 7)

  let threw = false
  try { e('a + 1') } catch { threw = true }
  check('unknown parameter is an error, not a silent 0', threw)

  threw = false
  try { e('1 / 0') } catch { threw = true }
  check('division by zero is an error', threw)

  threw = false
  // The evaluator must never execute anything — data is not code.
  try { e('process.exit(1)') } catch { threw = true }
  check('property access is rejected (no eval)', threw)

  check('integers render bare', formatNumber(6) === '6')
  check('floats are trimmed, not 0.30000000000000004',
    formatNumber(0.1 + 0.2) === '0.3', formatNumber(0.1 + 0.2))
  check('interpolation', renderTemplateString('{a}x − {b}', { a: 3, b: 7 }) === '3x − 7')
}

// ---------------------------------------------------------------------------
console.log('\ntemplates · validation')
// ---------------------------------------------------------------------------
{
  check(`${templates.length} templates loaded`, templates.length >= 3)
  for (const t of templates) {
    const problems = validateTemplate(t)
    check(`${t.id} validates`, problems.length === 0,
      problems.map((p) => p.message).join('; '))
  }
}

// ---------------------------------------------------------------------------
console.log('\ntemplates · instances are varied and reproducible')
// ---------------------------------------------------------------------------
{
  for (const t of templates) {
    const seen = new Set<string>()
    for (let seed = 0; seed < 200; seed++) seen.add(instantiate(t, seed).statement)
    check(`${t.id} yields many distinct questions`, seen.size > 20, `${seen.size} distinct in 200 draws`)

    const a = instantiate(t, 4242)
    const b = instantiate(t, 4242)
    check(`${t.id} is reproducible from its seed`,
      JSON.stringify(a) === JSON.stringify(b))
    check(`${t.id} encodes the seed in the id`, a.id.endsWith('#4242'), a.id)
  }
}

// ---------------------------------------------------------------------------
console.log('\ntemplates · the maths is actually right')
// ---------------------------------------------------------------------------
{
  // Linear: a*x - b = c, so solving must return x.
  const lin = templates.find((t) => t.id === 'alg.linear.cross-equals.t01')!
  let ok = true, sample = ''
  for (let seed = 0; seed < 300; seed++) {
    const env = drawParams(lin, seed)
    const q = instantiate(lin, seed)
    const lhs = env.a * env.x - env.b
    if (q.correctAnswer !== String(env.x) || !q.statement.includes(String(lhs))) {
      ok = false; sample = `${q.statement} => ${q.correctAnswer} (x=${env.x})`; break
    }
    if (q.lines[2].text !== `${env.a}x = ${env.a * env.x}`) {
      ok = false; sample = `line 2 was "${q.lines[2].text}"`; break
    }
  }
  check('linear template solves correctly across 300 draws', ok, sample)

  // Fraction → percent: n/d × 100 must be the stated answer, and must be exact.
  const pct = templates.find((t) => t.id === 'num.fractions-to-percent.convert.t01')!
  ok = true; sample = ''
  for (let seed = 0; seed < 300; seed++) {
    const env = drawParams(pct, seed)
    const q = instantiate(pct, seed)
    const expected = `${formatNumber((env.n * 100) / env.d)}%`
    if (q.correctAnswer !== expected) { ok = false; sample = `${q.statement} => ${q.correctAnswer}, expected ${expected}`; break }
    if (100 % env.d !== 0) { ok = false; sample = `denominator ${env.d} does not divide 100`; break }
  }
  check('percentage template converts correctly across 300 draws', ok, sample)

  // Substitution: p*a + q*b.
  const sub = templates.find((t) => t.id === 'alg.substitution.two-term.t01')!
  ok = true; sample = ''
  for (let seed = 0; seed < 300; seed++) {
    const env = drawParams(sub, seed)
    const q = instantiate(sub, seed)
    if (q.correctAnswer !== String(env.p * env.a + env.q * env.b)) {
      ok = false; sample = `${q.statement} => ${q.correctAnswer}`; break
    }
  }
  check('substitution template evaluates correctly across 300 draws', ok, sample)
}

// ---------------------------------------------------------------------------
console.log('\ntemplates · instances are safe to serve')
// ---------------------------------------------------------------------------
{
  let unrendered = '', collided = '', emptyish = ''
  for (const t of templates) {
    for (let seed = 0; seed < 300; seed++) {
      const q = instantiate(t, seed)
      const all = [q.statement, q.correctAnswer, ...q.lines.map((l) => l.text), ...q.lines.map((l) => l.note)]
      if (all.some((s) => /[{}]/.test(s))) unrendered ||= `${t.id}#${seed}`
      if (all.some((s) => s.includes('NaN') || s.includes('Infinity'))) emptyish ||= `${t.id}#${seed}`
      if (q.distractors?.some((d) => d.text === q.correctAnswer)) collided ||= `${t.id}#${seed}`
    }
  }
  check('no placeholder ever survives rendering', unrendered === '', unrendered)
  check('no instance renders NaN or Infinity', emptyish === '', emptyish)
  check('no distractor ever equals the correct answer', collided === '', collided)

  // Prerequisite tags must survive instantiation — they are what the
  // diagnostic loop reads, and losing them would silently disable it.
  const tagged = instantiate(
    templates.find((t) => t.id === 'num.fractions-to-percent.convert.t01')!, 7,
  )
  check('prerequisite tags survive instantiation',
    tagged.lines[1].prereqSubtopicIds.includes('num.fractions.to-decimal') &&
    tagged.lines[2].prereqSubtopicIds.includes('num.decimals.to-percent'),
    JSON.stringify(tagged.lines.map((l) => l.prereqSubtopicIds)))
}

// ---------------------------------------------------------------------------
console.log('\nbank · templates are served through the existing interface')
// ---------------------------------------------------------------------------
await loadContent()
{
  const authoredOnly = 4 // hand-authored cross-equals questions in questions.json
  const pool = questionsForSubtopic('alg.linear.cross-equals')
  check('a templated subtopic has far more questions than were authored',
    pool.length > authoredOnly + 20, `${pool.length} questions`)

  const instance = pool.find((q) => q.id.includes('#'))
  check('template instances appear in the pool', instance !== undefined)

  check('an instance resolves by id after the fact',
    instance !== undefined && questionById(instance.id)?.statement === instance.statement,
    'needed by the activity log and re-teach lookup')

  // An id that was never materialised in any index must still resolve.
  const ghostId = 'alg.linear.cross-equals.t01#987654'
  const ghost = questionById(ghostId)
  check('an on-demand instance id resolves even though no index holds it',
    ghost !== undefined && ghost.id === ghostId, String(ghost?.id))
  check('re-resolving the same id gives the identical question',
    JSON.stringify(questionById(ghostId)) === JSON.stringify(ghost))

  // Practice must not run out.
  const deep = questionAt('alg.linear', 500)
  check('questionAt past the authored pool still returns a question',
    deep !== undefined, 'unbounded practice')
  const deeper = new Set<string>()
  for (let n = 20; n < 220; n++) deeper.add(questionAt('alg.linear', n)?.statement ?? '')
  check('deep practice keeps producing distinct questions',
    deeper.size > 50, `${deeper.size} distinct from 200 draws`)

  // The silly-mistake retry needs a same-structure variant.
  if (instance) {
    const variant = similarQuestion(instance.id, [])
    check('similarQuestion mints a variant for a template instance',
      variant !== undefined && variant.statement !== instance.statement,
      `${instance.statement} -> ${variant?.statement}`)
    check('the variant stays in the same family',
      variant?.familyId === instance.familyId)
  }
}

if (failures === 0) console.log('\n[32mAll template smoke checks passed.[0m\n')
else throw new Error(`${failures} template smoke check(s) failed`)
