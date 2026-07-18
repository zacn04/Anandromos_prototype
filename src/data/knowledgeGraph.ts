/**
 * The knowledge graph sample data shared by all three POVs: subtopic nodes,
 * prerequisite edges, and the visual style for each mastery status.
 */
export type NodeStatus = 'mastered' | 'inprogress' | 'frontier' | 'notready' | 'locked'

export interface KnowledgeNode {
  id: string
  x: number
  y: number
  st: NodeStatus
  label: string
}

export const NODES: KnowledgeNode[] = [
  { id: 'n1', x: 24, y: 44, st: 'mastered', label: 'Negatives' },
  { id: 'n2', x: 24, y: 134, st: 'mastered', label: 'Fractions' },
  { id: 'n3', x: 24, y: 224, st: 'mastered', label: 'Decimals' },
  { id: 'n4', x: 24, y: 314, st: 'mastered', label: 'Ratio' },
  { id: 'n5', x: 190, y: 44, st: 'mastered', label: 'Neg. arithmetic' },
  { id: 'n6', x: 190, y: 170, st: 'inprogress', label: 'Fractions → %' },
  { id: 'n7', x: 190, y: 314, st: 'mastered', label: 'Proportion' },
  { id: 'n8', x: 356, y: 44, st: 'mastered', label: 'Algebra basics' },
  { id: 'n9', x: 356, y: 170, st: 'inprogress', label: 'Substitution' },
  { id: 'n10', x: 356, y: 314, st: 'notready', label: '% change' },
  { id: 'n11', x: 522, y: 100, st: 'frontier', label: 'Linear equations' },
  { id: 'n12', x: 522, y: 220, st: 'frontier', label: 'Expanding ( )' },
  { id: 'n13', x: 522, y: 334, st: 'notready', label: 'Coordinates' },
  { id: 'n14', x: 688, y: 150, st: 'locked', label: 'Bracket eqns' },
  { id: 'n15', x: 688, y: 290, st: 'locked', label: 'Simultaneous' },
]

export const EDGES: Array<[string, string]> = [
  ['n1', 'n5'],
  ['n1', 'n9'],
  ['n2', 'n6'],
  ['n3', 'n6'],
  ['n2', 'n7'],
  ['n4', 'n7'],
  ['n5', 'n8'],
  ['n8', 'n9'],
  ['n8', 'n11'],
  ['n8', 'n13'],
  ['n9', 'n11'],
  ['n6', 'n10'],
  ['n7', 'n10'],
  ['n11', 'n14'],
  ['n12', 'n14'],
  ['n11', 'n15'],
  ['n13', 'n15'],
]

export interface NodeStyle {
  fill: string
  stroke: string
  text: string
  sw: number
  dash: string
}

export const ST: Record<NodeStatus, NodeStyle> = {
  mastered: { fill: '#1f4e75', stroke: '#1f4e75', text: '#ffffff', sw: 1.5, dash: '' },
  inprogress: { fill: '#7fb0cd', stroke: '#3f82ab', text: '#0e2a43', sw: 1.5, dash: '' },
  frontier: { fill: '#fdf0e6', stroke: '#dd6a2f', text: '#b6531f', sw: 2.5, dash: '' },
  notready: { fill: '#efe7d9', stroke: '#d8cbb2', text: '#8a7c63', sw: 1.5, dash: '' },
  locked: { fill: '#f2ede2', stroke: '#ddd2bd', text: '#a99e88', sw: 1.5, dash: '4 4' },
}

export const NODE_BY_ID: Record<string, KnowledgeNode> = Object.fromEntries(
  NODES.map((n) => [n.id, n]),
)

/** Bezier path from the right edge of node A to the left edge of node B. */
export function edgePath(a: string, b: string): string {
  const A = NODE_BY_ID[a]
  const B = NODE_BY_ID[b]
  const fx = A.x + 132
  const fy = A.y + 21
  const tx = B.x
  const ty = B.y + 21
  return `M ${fx} ${fy} C ${fx + 38} ${fy}, ${tx - 38} ${ty}, ${tx} ${ty}`
}

/** Basket topics used by the focused-graph filter (teacher + student map). */
export const BASKETS = [
  { key: 'number', label: 'Number', ids: ['n1', 'n2', 'n3', 'n5', 'n6'] },
  { key: 'ratio', label: 'Ratio & proportion', ids: ['n4', 'n7', 'n10'] },
  { key: 'algebra', label: 'Algebra', ids: ['n8', 'n9', 'n11', 'n12', 'n14'] },
  { key: 'geometry', label: 'Coordinates & graphs', ids: ['n13', 'n15'] },
]
