/**
 * Basket ordering: turning a teacher's selected set of topics into a suggested
 * teaching order, and telling them when their own order contradicts the graph.
 *
 * build-plan §5.1 frames the fork deliberately: the teacher either accepts
 * Anadromos's suggested order or sets their own. This module serves both. It
 * *suggests*, and it *warns* - it never blocks. Teachers have reasons for
 * teaching things out of dependency order (a mock exam next week, a topic the
 * class asked about), and the product's job is to make sure an out-of-order
 * choice is a choice rather than an accident.
 *
 * Pure logic - no React. Reads the prerequisite graph from the content store.
 */
import { prereqsOf, topicById, topicLabel } from '../content'
import type { TopicId, YearBand } from '../content'

/**
 * A suggested teaching order for a basket: a topological sort over the
 * prerequisite graph restricted to the basket itself.
 *
 * Restricted, because a basket is a slice of the year - prerequisites that sit
 * outside it are assumed already taught, not scheduled. `missingPrereqs` below
 * is what surfaces the ones that assumption may be wrong about.
 *
 * Ties are broken by year band, then alphabetically, so the same basket always
 * produces the same order rather than one that drifts with object key order.
 */
export function suggestedOrder(basket: readonly TopicId[]): readonly TopicId[] {
  const inBasket = new Set(basket)

  // Kahn's algorithm, with a deterministic tie-break at each step.
  const remaining = new Set(basket)
  const placed: TopicId[] = []

  const bandOf = (id: TopicId): number => {
    const band: YearBand | undefined = topicById(id)?.yearBand
    const n = band ? Number.parseInt(String(band).replace(/\D+/g, ''), 10) : NaN
    return Number.isNaN(n) ? 99 : n
  }

  const readyKey = (id: TopicId): string =>
    `${String(bandOf(id)).padStart(2, '0')}|${topicLabel(id)}|${id}`

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) =>
      prereqsOf(id).every((p) => !inBasket.has(p) || !remaining.has(p)),
    )

    // A cycle inside the basket would leave nothing ready. The graph validator
    // makes cycles a hard error, so this is defensive - but degrade by placing
    // the lowest-sorting remaining topic rather than looping forever.
    const batch = ready.length > 0 ? ready : [...remaining]
    batch.sort((a, b) => readyKey(a).localeCompare(readyKey(b)))

    const next = batch[0]
    placed.push(next)
    remaining.delete(next)
  }

  return placed
}

export interface OrderWarning {
  topicId: TopicId
  topicLabel: string
  /** The prerequisite that is taught later than the topic depending on it. */
  prereqId: TopicId
  prereqLabel: string
  /** 0-based positions in the order the teacher set. */
  position: number
  prereqPosition: number
}

/**
 * Prerequisites that appear *after* something depending on them.
 *
 * Rendered as a warning next to the offending row - never as a blocked save.
 */
export function orderWarnings(order: readonly TopicId[]): readonly OrderWarning[] {
  const positionOf = new Map<TopicId, number>()
  order.forEach((id, i) => positionOf.set(id, i))

  const warnings: OrderWarning[] = []
  order.forEach((id, position) => {
    for (const prereqId of prereqsOf(id)) {
      const prereqPosition = positionOf.get(prereqId)
      if (prereqPosition === undefined) continue // outside the basket; see missingPrereqs
      if (prereqPosition > position) {
        warnings.push({
          topicId: id,
          topicLabel: topicLabel(id),
          prereqId,
          prereqLabel: topicLabel(prereqId),
          position,
          prereqPosition,
        })
      }
    }
  })
  return warnings
}

export interface MissingPrereq {
  topicId: TopicId
  topicLabel: string
  prereqId: TopicId
  prereqLabel: string
}

/**
 * Prerequisites of basket topics that are not themselves in the basket.
 *
 * Not necessarily a mistake - a Year 9 basket legitimately assumes Year 8
 * material - but it is the single most useful thing to show a teacher building
 * one: "you've selected Equations with brackets, which depends on Expanding
 * brackets, which isn't in your basket." They can add it, or knowingly rely on
 * it having been taught already.
 */
export function missingPrereqs(basket: readonly TopicId[]): readonly MissingPrereq[] {
  const inBasket = new Set(basket)
  const seen = new Set<string>()
  const out: MissingPrereq[] = []

  for (const topicId of basket) {
    for (const prereqId of prereqsOf(topicId)) {
      if (inBasket.has(prereqId)) continue
      const key = `${topicId}->${prereqId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        topicId,
        topicLabel: topicLabel(topicId),
        prereqId,
        prereqLabel: topicLabel(prereqId),
      })
    }
  }
  return out
}
