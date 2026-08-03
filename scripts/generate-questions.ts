/**
 * Offline question-bank generation (build-plan §2).
 *
 * A CLI, deliberately not a service. It reads `ANTHROPIC_API_KEY` from the
 * environment, runs when you run it, and costs nothing sitting here. Nothing in
 * the app calls it; nothing bills while it is idle.
 *
 * Three things make this safe to point at a large budget:
 *
 * 1. **Dry-run by default.** Without `--confirm` it prints the plan and the
 *    estimated cost and exits. Spending money requires saying so.
 * 2. **Legal tags are structurally impossible to get wrong.** Each subtopic's
 *    prompt carries a JSON-schema `enum` of exactly the prerequisite subtopics
 *    that satisfy the validator's ancestry rule for that subtopic. The model
 *    cannot emit a tag that fails E_ANCESTRY, because the schema will not let it.
 * 3. **Output is staged, never merged.** Results land in a separate
 *    `questions.generated.json` for review. The hand-authored bank is not
 *    touched, and `npm run validate:content` still gates the real one.
 *
 * Usage:
 *   npm run generate:questions -- --strand num --per-subtopic 8        (dry run)
 *   npm run generate:questions -- --strand num --per-subtopic 8 --confirm
 *   npm run generate:questions -- --resume msgbatch_01ABC...          (collect)
 */
import Anthropic from '@anthropic-ai/sdk'
import { validateTemplate } from '../src/content/template.ts'
import type { QuestionTemplate } from '../src/content/template.ts'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content', 'curriculum')
const STATE_FILE = path.join(ROOT, '.generate-state.json')
const DEFAULT_OUT = path.join(CONTENT, 'question-templates.generated.json')

const MODEL = 'claude-opus-5'
/** Batch API is half price, and every request here is offline by construction. */
const USD_PER_MTOK_IN = 5 / 2
const USD_PER_MTOK_OUT = 25 / 2

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

interface Args {
  strand?: string
  topic?: string
  subtopic?: string
  perSubtopic: number
  limit?: number
  confirm: boolean
  resume?: string
  out: string
}

function parseArgs(argv: string[]): Args {
  const a: Args = { perSubtopic: 8, confirm: false, out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1]
    switch (argv[i]) {
      case '--strand': a.strand = v; i++; break
      case '--topic': a.topic = v; i++; break
      case '--subtopic': a.subtopic = v; i++; break
      case '--per-subtopic': a.perSubtopic = Number(v); i++; break
      case '--limit': a.limit = Number(v); i++; break
      case '--out': a.out = path.resolve(v); i++; break
      case '--resume': a.resume = v; i++; break
      case '--confirm': a.confirm = true; break
      case '--help':
        console.log(HELP); process.exit(0)
    }
  }
  return a
}

const HELP = `
generate-questions — offline question-bank generation

  --strand <id>          generate for every subtopic in a strand (e.g. num)
  --topic <id>           generate for every subtopic of one topic
  --subtopic <id>        generate for a single subtopic
  --per-subtopic <n>     TEMPLATES per subtopic (default 8)
  --limit <n>            cap the number of subtopics (useful for a first run)
  --out <path>           output file (default content/curriculum/questions.generated.json)
  --confirm              actually submit the batch and spend money
  --resume <batchId>     collect the results of an earlier batch
`

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

interface Subtopic { id: string; topicId: string; label: string; yearBand: string; status: string }
interface Topic { id: string; strandId: string; label: string; yearBand: string }
interface Edge { from: string; to: string }
const readItems = <T,>(file: string): T[] =>
  JSON.parse(fs.readFileSync(path.join(CONTENT, file), 'utf8')).items as T[]

const subtopics = readItems<Subtopic>('subtopics.json')
const topics = readItems<Topic>('topics.json')
const subtopicEdges = readItems<Edge>('prereq-edges.subtopic.json')
const existingTemplates = readItems<Record<string, unknown>>('question-templates.json')

const topicById = new Map(topics.map((t) => [t.id, t]))
const subtopicById = new Map(subtopics.map((s) => [s.id, s]))

/**
 * Strict ancestors of a subtopic in the prerequisite graph — exactly the set
 * the validator's tier-A ancestry rule accepts as a legal tag on a line of this
 * question's working. Offering the model anything else would be inviting a
 * validation failure we would then have to throw away tokens fixing.
 */
function ancestorsOf(subtopicId: string): string[] {
  const parents = new Map<string, string[]>()
  for (const e of subtopicEdges) {
    if (!parents.has(e.to)) parents.set(e.to, [])
    parents.get(e.to)!.push(e.from)
  }
  const seen = new Set<string>()
  const stack = [...(parents.get(subtopicId) ?? [])]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(parents.get(id) ?? []))
  }
  return [...seen].sort()
}

function selectTargets(a: Args): Subtopic[] {
  let out = subtopics
  if (a.subtopic) out = out.filter((s) => s.id === a.subtopic)
  else if (a.topic) out = out.filter((s) => s.topicId === a.topic)
  else if (a.strand) out = out.filter((s) => topicById.get(s.topicId)?.strandId === a.strand)
  out = [...out].sort((x, y) => x.id.localeCompare(y.id))
  return a.limit ? out.slice(0, a.limit) : out
}

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

/** The hand-authored templates, verbatim, as the house style. Cached across every request. */
function exemplars(): string {
  return existingTemplates.map((t) => JSON.stringify(t, null, 2)).join('\n\n')
}

const SYSTEM = `You write question TEMPLATES for Anadromos, a UK secondary-school maths
diagnostic platform.

A template is a question with its numbers left as parameters, so one template serves an
unlimited number of distinct questions. You are not writing a question; you are writing
the rule that generates a family of them.

## The format

\`params\` declares integer parameters with inclusive ranges. \`constraints\` are boolean
expressions that every accepted draw must satisfy. Every other field may contain
\`{expression}\` placeholders, evaluated against the drawn parameters and substituted in.

Expressions support + - * / % ( ), comparisons, && ||, and the functions abs, min, max,
sign, round, floor, ceil, gcd, pow. Nothing else — no variables you did not declare.

## Rules that matter more than fluency

1. **The maths must be exactly right for EVERY legal draw**, not just a typical one. This
   is the single thing to get right. Use constraints to exclude draws that would produce
   a non-integer answer, a negative where the year band expects none, a division by zero,
   or a degenerate question like "3x = 0".
2. **Constraints must be satisfiable.** If they are so tight that few or no draws pass,
   the template is useless. Prefer expressing the answer in terms of the parameters
   (\`{a*x - b}\`) over constraining a computed value to come out whole.
3. **Derive, do not constrain, where you can.** For a linear equation, draw the SOLUTION
   x and the coefficients, then compute the constant — that guarantees a whole-number
   answer with no constraint at all. This trick generalises; use it.
4. **Lines are separable steps.** Each is one manipulation a student could get wrong on
   its own. First line restates the problem, last line states the answer.
5. **\`note\` explains WHY the step is legal**, in a student's register, or '' for pure
   arithmetic. It may reference parameters: "−{b} crosses the =, so it becomes +{b}".
6. **\`prereqSubtopicIds\` names what a step TESTS**, only from the allowed list supplied.
   Empty is correct and common. Do not pad.
7. **\`distractors\` are wrong ANSWERS a real student would reach**, as expressions, each
   with the specific misconception in \`cause\`. A distractor must never be able to equal
   the correct answer for any legal draw.
8. **Surface form must stay stable across draws.** Constrain signs so you never render
   "x + -3". Plain Unicode maths (−, ×, ÷, ², ½), never LaTeX.

## Worked examples, in the exact output shape

${exemplars()}`

function userPrompt(s: Subtopic, n: number, allowed: string[]): string {
  const topic = topicById.get(s.topicId)
  const allowedList = allowed.length
    ? allowed.map((id) => `  ${id}  (${subtopicById.get(id)?.label ?? '?'})`).join('\n')
    : '  (none — every line must use an empty prereqSubtopicIds array)'
  return `Write ${n} question templates for this subtopic.

Subtopic:   ${s.id}
Label:      ${s.label}
Topic:      ${s.topicId} (${topic?.label ?? '?'})
Year band:  ${s.yearBand}

Prerequisite subtopics you may tag lines with:
${allowedList}

Return ${n} templates. Each must be a genuinely different QUESTION TYPE for this
subtopic — different structure, different thing being asked — not the same shape with
different ranges. One template already covers unlimited numeric variation, so numeric
variety between templates is worthless.`
}

/** Per-subtopic output schema. The `enum` is what makes an illegal tag impossible. */
function outputSchema(n: number, allowed: string[]) {
  const tagField = allowed.length
    ? { type: 'array', items: { type: 'string', enum: allowed } }
    : { type: 'array', items: { type: 'string', enum: ['__none__'] }, maxItems: 0 }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['templates'],
    properties: {
      templates: {
        type: 'array',
        minItems: n,
        maxItems: n,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['familyId', 'difficulty', 'params', 'constraints', 'prompt',
                     'statement', 'answerLabel', 'correctAnswer', 'lines',
                     'errorLineIndex', 'distractors'],
          properties: {
            familyId: { type: 'string' },
            difficulty: { type: 'string', enum: ['foundations', 'core', 'stretch'] },
            params: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'min', 'max'],
                properties: {
                  name: { type: 'string', pattern: '^[a-z][a-zA-Z0-9_]*$' },
                  min: { type: 'integer' },
                  max: { type: 'integer' },
                  exclude: { type: 'array', items: { type: 'integer' } },
                },
              },
            },
            constraints: { type: 'array', items: { type: 'string' } },
            prompt: { type: 'string' },
            statement: { type: 'string' },
            answerLabel: { type: 'string' },
            correctAnswer: { type: 'string' },
            lines: {
              type: 'array',
              minItems: 2,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'note', 'prereqSubtopicIds'],
                properties: {
                  text: { type: 'string' },
                  note: { type: 'string' },
                  prereqSubtopicIds: tagField,
                },
              },
            },
            errorLineIndex: { type: 'integer', minimum: 0 },
            distractors: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'cause'],
                properties: { text: { type: 'string' }, cause: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// cost
// ---------------------------------------------------------------------------

const roughTokens = (s: string): number => Math.ceil(s.length / 3.6)

function estimate(targets: Subtopic[], perSubtopic: number) {
  const systemTokens = roughTokens(SYSTEM)
  let input = 0
  for (const s of targets) input += systemTokens + roughTokens(userPrompt(s, perSubtopic, ancestorsOf(s.id)))
  // ~340 output tokens per question, measured against the hand-authored bank,
  // plus adaptive thinking which is on by default on this model.
  const output = targets.length * perSubtopic * 340 * 1.6
  const usd = (input / 1e6) * USD_PER_MTOK_IN + (output / 1e6) * USD_PER_MTOK_OUT
  return { input, output, usd }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
const client = new Anthropic()

if (args.resume) {
  await collect(args.resume, args.out)
} else {
  const targets = selectTargets(args)
  if (targets.length === 0) {
    console.error('No subtopics matched. Use --strand / --topic / --subtopic.')
    process.exit(1)
  }

  const est = estimate(targets, args.perSubtopic)
  const totalQuestions = targets.length * args.perSubtopic

  console.log(`\n  subtopics       ${targets.length}`)
  console.log(`  per subtopic    ${args.perSubtopic}`)
  console.log(`  questions       ${totalQuestions}`)
  console.log(`  model           ${MODEL} (Batch API, 50% off)`)
  console.log(`  est. input      ${(est.input / 1e6).toFixed(2)}M tokens`)
  console.log(`  est. output     ${(est.output / 1e6).toFixed(2)}M tokens`)
  console.log(`  est. cost       ~$${est.usd.toFixed(2)}\n`)

  const untagged = targets.filter((s) => ancestorsOf(s.id).length === 0)
  if (untagged.length) {
    console.log(`  note: ${untagged.length} subtopic(s) have no prerequisite ancestors, so their`)
    console.log(`        lines will be untaggable. That is expected for graph roots.\n`)
  }

  if (!args.confirm) {
    console.log('  Dry run. Re-run with --confirm to submit.\n')
    process.exit(0)
  }

  const requests = targets.map((s) => {
    const allowed = ancestorsOf(s.id)
    return {
      custom_id: s.id.replace(/\./g, '_'),
      params: {
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } }],
        output_config: { format: { type: 'json_schema' as const, schema: outputSchema(args.perSubtopic, allowed) } },
        messages: [{ role: 'user' as const, content: userPrompt(s, args.perSubtopic, allowed) }],
      },
    }
  })

  console.log('  submitting batch…')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch = await client.messages.batches.create({ requests: requests as any })
  fs.writeFileSync(STATE_FILE, JSON.stringify({ batchId: batch.id, out: args.out, submittedAt: new Date().toISOString() }, null, 2))
  console.log(`  batch ${batch.id}`)
  console.log(`  state written to ${path.relative(ROOT, STATE_FILE)}\n`)
  await collect(batch.id, args.out)
}

async function collect(batchId: string, out: string) {
  console.log(`  polling ${batchId} …`)
  for (;;) {
    const b = await client.messages.batches.retrieve(batchId)
    if (b.processing_status === 'ended') break
    const c = b.request_counts
    console.log(`    ${b.processing_status}  processing ${c.processing} · ok ${c.succeeded} · errored ${c.errored}`)
    await new Promise((r) => setTimeout(r, 30_000))
  }

  const generated: QuestionTemplate[] = []
  const problems: string[] = []
  let rejected = 0

  for await (const r of await client.messages.batches.results(batchId)) {
    const subtopicId = r.custom_id.replace(/_/g, '.')
    if (r.result.type !== 'succeeded') {
      problems.push(`${subtopicId}: ${r.result.type}`)
      continue
    }
    const block = r.result.message.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') { problems.push(`${subtopicId}: no text block`); continue }

    let parsed: { templates: Record<string, unknown>[] }
    try { parsed = JSON.parse(block.text) } catch { problems.push(`${subtopicId}: unparseable JSON`); continue }

    const sub = subtopicById.get(subtopicId)
    if (!sub) { problems.push(`${subtopicId}: unknown subtopic`); continue }

    parsed.templates.forEach((t, i) => {
      const candidate = {
        ...t,
        id: `${subtopicId}.t${String(i + 1).padStart(2, '0')}g`,
        topicId: sub.topicId,
        subtopicId,
        boardStyle: null,
        source: 'ai',
        // Never 'verified'. A human decides that, per build-plan §2.6.
        status: 'draft',
      } as unknown as QuestionTemplate

      // The decisive gate. A generated template is machine-checkable in a way a
      // generated question is not: instantiate it many times and confirm every
      // draw renders, satisfies its constraints, and produces no NaN, no
      // surviving placeholder and no distractor colliding with the answer. A
      // template that fails here would have failed in front of a student.
      const issues = validateTemplate(candidate, 40)
      if (issues.length) {
        rejected++
        problems.push(`${candidate.id}: ${issues.map((x) => x.message).join('; ')}`)
        return
      }
      generated.push(candidate)
    })
  }

  fs.writeFileSync(out, JSON.stringify({ schemaVersion: 1, kind: 'question-template', items: generated }, null, 2) + '\n')

  console.log(`\n  ${generated.length} templates written to ${path.relative(ROOT, out)}`)
  if (rejected) console.log(`  ${rejected} rejected by validateTemplate before writing`)
  if (problems.length) {
    console.log(`  ${problems.length} problem(s):`)
    for (const p of problems.slice(0, 20)) console.log(`    ${p}`)
  }
  console.log(`\n  Staged, not merged. Review, then merge into questions.json and re-run`)
  console.log(`  npm run validate:content before trusting any of it.\n`)
}
