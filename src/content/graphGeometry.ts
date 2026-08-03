/**
 * SVG geometry for the knowledge graph — §5.7. Geometry, not content, which is
 * why it lives beside the store rather than inside a JSON file. Lifted from
 * `knowledgeGraph.ts:79–87` unchanged except for the coordinate lookup.
 */
import type { TopicId } from './schema'
import { graphTopicById } from './accessors'

/**
 * Bezier path from the right edge of topic A's node to the left edge of B's.
 *
 * The magic numbers are the node rect's width and half-height, matched to
 * `GraphSvg.tsx`'s hardcoded `width={132} height={42}`. Keep them in step.
 */
export function edgePath(a: TopicId, b: TopicId): string {
  // `!` preserves today's behaviour exactly: `NODE_BY_ID[a]` was typed as
  // always-present and threw a TypeError on a dangling edge endpoint. The
  // validator's E_REF_EDGE_ENDPOINT is what stops that reaching runtime.
  const A = graphTopicById(a)!
  const B = graphTopicById(b)!
  const fx = A.x + 132
  const fy = A.y + 21
  const tx = B.x
  const ty = B.y + 21
  return `M ${fx} ${fy} C ${fx + 38} ${fy}, ${tx - 38} ${ty}, ${tx} ${ty}`
}
