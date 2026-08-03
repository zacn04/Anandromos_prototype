/**
 * The BANK tier — §3.12 of `docs/content-schema-spec.md`.
 *
 * `questions` reaches ~320,000 rows (~1.3M QuestionLines) and `reteachCards`
 * ~1.6M rows at Phase 2. Everything the app can ask of that bank goes through
 * the `QuestionBank` interface below, so the eventual swap from "it is all in
 * the JS bundle" to "fetch the topic-keyed shard" is one implementation of one
 * interface and NOT a single call-site change.
 *
 * There is deliberately no `all()` and no `questions()` accessor: "give me
 * every question" is the one operation a lazy bank cannot serve, and nothing
 * in the app asks for it.
 */
import type { Question, QuestionId, ReteachCardContent, SubtopicId, TopicId } from './schema.ts'
import { instantiate } from './template.ts'
import type { QuestionTemplate } from './template.ts'

export interface RawQuestionBank {
  questions: readonly Question[]
  reteachCards: readonly ReteachCardContent[]
  /**
   * Question templates (§ template.ts). One template expands to an unbounded
   * family of concrete questions, so a subtopic with a template never runs out
   * of practice. Expanded inside the bank rather than at any call site, which
   * is why nothing above this interface knows templates exist.
   */
  templates?: readonly QuestionTemplate[]
}

/**
 * How many instances each template contributes to the finite `forTopic` /
 * `forSubtopic` listings.
 *
 * Those two methods must stay finite — call sites index and count them — so a
 * template cannot simply be "infinite questions" there. 24 is enough that free
 * play stops repeating within a session while keeping the arrays small. The
 * genuinely unbounded paths are `at()` past the end of the pool and `similar()`,
 * both of which mint a fresh instance on demand.
 */
const INSTANCES_PER_TEMPLATE = 24

/** Deterministic, collision-resistant seed for the nth instance of a template. */
const seedFor = (templateId: string, n: number): number => {
  let h = 2166136261
  for (let i = 0; i < templateId.length; i++) {
    h ^= templateId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h ^ Math.imul(n + 1, 2654435761)) >>> 0) % 2147483647
}

/**
 * Everything the app can ask of the question bank. Six methods, all
 * synchronous. Today: createInMemoryBank, backed by the arrays above.
 * Tomorrow: a fetch-and-cache implementation over §4.2's topic-keyed shards.
 * Swapping the implementation must not change a single call site. §3.12.
 */
export interface QuestionBank {
  byId(id: QuestionId): Question | undefined
  forTopic(topicId: TopicId): readonly Question[]
  forSubtopic(subtopicId: SubtopicId): readonly Question[]
  at(topicId: TopicId, n: number): Question | undefined
  similar(id: QuestionId, exclude?: readonly QuestionId[]): Question | undefined
  reteachCardFor(questionId: QuestionId, lineIndex: number | 'all'): ReteachCardContent | undefined
}

/**
 * Stable empty result. Shared so a miss never allocates and never produces a
 * new array identity in a React dependency list. §5.6's fallback table
 * requires `[]`, not `undefined`, from forTopic/forSubtopic — call sites index
 * straight into the result (`pool[n % pool.length]`) and crash on undefined,
 * and `tsconfig.app.json` has no `strictNullChecks` to catch it.
 */
const NO_QUESTIONS: readonly Question[] = []

/** Builds every bank index up front. Correct at 17 rows, wrong at 320,000. */
export function createInMemoryBank(raw: RawQuestionBank): QuestionBank {
  const reteachCards: readonly ReteachCardContent[] = raw?.reteachCards ?? []
  const templates: readonly QuestionTemplate[] = raw?.templates ?? []

  const templateById = new Map<string, QuestionTemplate>()
  for (const t of templates) templateById.set(t.id, t)

  // Templates expand into the finite listings alongside authored questions, so
  // every existing index below treats them identically. An instance carries the
  // id `${templateId}#${seed}`, which is what lets `byId` re-derive it later
  // without storing it.
  const expanded: Question[] = []
  for (const t of templates) {
    for (let n = 0; n < INSTANCES_PER_TEMPLATE; n++) {
      try {
        expanded.push(instantiate(t, seedFor(t.id, n)))
      } catch {
        // A template whose constraints cannot be met is caught offline by
        // `validate-content`; skip it here rather than taking the app down.
        break
      }
    }
  }

  const questions: readonly Question[] =
    expanded.length > 0 ? [...(raw?.questions ?? NO_QUESTIONS), ...expanded] : raw?.questions ?? NO_QUESTIONS

  const byId = new Map<QuestionId, Question>()
  const byTopic = new Map<TopicId, Question[]>()
  const bySubtopic = new Map<SubtopicId, Question[]>()

  for (const q of questions) {
    byId.set(q.id, q)

    const topicBucket = byTopic.get(q.topicId)
    if (topicBucket) topicBucket.push(q)
    else byTopic.set(q.topicId, [q])

    const subtopicBucket = bySubtopic.get(q.subtopicId)
    if (subtopicBucket) subtopicBucket.push(q)
    else bySubtopic.set(q.subtopicId, [q])
  }

  // Retired question ids that still resolve to a live question (§1.6). Built
  // in a second pass so a live id always wins over an alias, whatever order
  // the file is authored in. Question aliases live here rather than in
  // ContentIndex.aliasTo because buildStore must never iterate the bank
  // (§3.12) — the bank is the only thing that knows question identity.
  const aliasToQuestion = new Map<QuestionId, Question>()
  for (const q of questions) {
    for (const alias of q.aliases ?? []) {
      if (!byId.has(alias)) aliasToQuestion.set(alias, q)
    }
  }

  // `${questionId}#${lineIndex}`, where lineIndex is a number or the literal 'all'.
  const byQuestionLine = new Map<string, ReteachCardContent>()
  for (const card of reteachCards) {
    byQuestionLine.set(`${card.questionId}#${card.lineIndex}`, card)
  }

  /**
   * Resolves an id to a question, re-deriving template instances that were
   * never materialised.
   *
   * `at()` and `similar()` mint instances on demand, so a student can be
   * looking at `alg.linear.cross-equals.t01#918273` that appears in no index.
   * The activity log, the re-teach lookup and the teacher's drill-down all
   * resolve questions by id after the fact, and every one of them would show a
   * blank row without this. The seed is in the id, so the instance is exactly
   * reproducible.
   */
  function resolve(id: QuestionId): Question | undefined {
    const known = byId.get(id) ?? aliasToQuestion.get(id)
    if (known) return known

    const hash = id.lastIndexOf('#')
    if (hash < 0) return undefined
    const template = templateById.get(id.slice(0, hash))
    const seed = Number(id.slice(hash + 1))
    if (!template || !Number.isFinite(seed)) return undefined
    try {
      return instantiate(template, seed)
    } catch {
      return undefined
    }
  }

  const bank: QuestionBank = {
    byId(id: QuestionId): Question | undefined {
      return resolve(id)
    },

    forTopic(topicId: TopicId): readonly Question[] {
      return byTopic.get(topicId) ?? NO_QUESTIONS
    },

    forSubtopic(subtopicId: SubtopicId): readonly Question[] {
      return bySubtopic.get(subtopicId) ?? NO_QUESTIONS
    },

    /**
     * "Question N for a topic" = its 0-indexed position in forTopic — and past
     * the end of that pool, a freshly minted template instance rather than
     * `undefined`. This is what makes practice on a templated topic unbounded:
     * the caller keeps incrementing n and keeps getting new questions.
     */
    at(topicId: TopicId, n: number): Question | undefined {
      const pool = byTopic.get(topicId) ?? NO_QUESTIONS
      if (n < pool.length) return pool[n]

      const forThisTopic = templates.filter((t) => t.topicId === topicId)
      if (forThisTopic.length === 0) return undefined
      const overflow = n - pool.length
      const template = forThisTopic[overflow % forThisTopic.length]
      const cycle = INSTANCES_PER_TEMPLATE + Math.floor(overflow / forThisTopic.length)
      try {
        return instantiate(template, seedFor(template.id, cycle))
      } catch {
        return undefined
      }
    },

    /**
     * A same-(subtopic, family) "different numbers" variant. Deterministic —
     * the first match in authored order, never random, so demos reproduce.
     * Scoped by subtopic as well as family (§3.5): identical results to
     * today's global familyId match on the five seed families, and still
     * correct when Phase 2 reuses family slugs across subtopics.
     */
    similar(id: QuestionId, exclude?: readonly QuestionId[]): Question | undefined {
      const current = resolve(id)
      if (!current) return undefined
      const pool = bySubtopic.get(current.subtopicId) ?? NO_QUESTIONS
      for (const candidate of pool) {
        if (candidate.familyId !== current.familyId) continue
        if (candidate.id === current.id) continue
        if (exclude && exclude.indexOf(candidate.id) > -1) continue
        return candidate
      }

      // Nothing authored left. If this question came from a template, a
      // "same structure, different numbers" variant is exactly what a template
      // is for — mint one rather than giving up, which is the whole point of
      // the silly-mistake retry.
      const hash = current.id.lastIndexOf('#')
      const template = hash > -1 ? templateById.get(current.id.slice(0, hash)) : undefined
      if (template) {
        for (let bump = 1; bump <= 64; bump++) {
          const seed = seedFor(template.id, INSTANCES_PER_TEMPLATE + bump)
          try {
            const minted = instantiate(template, seed)
            if (minted.id === current.id) continue
            if (exclude && exclude.indexOf(minted.id) > -1) continue
            if (minted.statement === current.statement) continue
            return minted
          } catch {
            break
          }
        }
      }
      return undefined
    },

    reteachCardFor(questionId: QuestionId, lineIndex: number | 'all'): ReteachCardContent | undefined {
      return byQuestionLine.get(`${questionId}#${lineIndex}`)
    },
  }

  return bank
}
