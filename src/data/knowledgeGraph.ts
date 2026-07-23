/**
 * The knowledge graph sample data shared by all three POVs: subtopic nodes,
 * prerequisite edges, and the visual style for each mastery status.
 *
 * Node *structure* (position, label, prerequisites) is shared curriculum
 * data. Node *status* and *stats* are per-student facts, so both are keyed
 * by student id rather than baked into the node itself — that's also what
 * keeps every POV showing the same numbers for the same student instead of
 * three independently hand-maintained copies drifting apart.
 */
export type NodeStatus = 'mastered' | 'inprogress' | 'frontier' | 'notready' | 'locked'

export interface KnowledgeNode {
  id: string
  x: number
  y: number
  label: string
}

export const NODES: KnowledgeNode[] = [
  { id: 'n1', x: 24, y: 44, label: 'Negatives' },
  { id: 'n2', x: 24, y: 134, label: 'Fractions' },
  { id: 'n3', x: 24, y: 224, label: 'Decimals' },
  { id: 'n4', x: 24, y: 314, label: 'Ratio' },
  { id: 'n5', x: 190, y: 44, label: 'Neg. arithmetic' },
  { id: 'n6', x: 190, y: 170, label: 'Fractions → %' },
  { id: 'n7', x: 190, y: 314, label: 'Proportion' },
  { id: 'n8', x: 356, y: 44, label: 'Algebra basics' },
  { id: 'n9', x: 356, y: 170, label: 'Substitution' },
  { id: 'n10', x: 356, y: 314, label: '% change' },
  { id: 'n11', x: 522, y: 100, label: 'Linear equations' },
  { id: 'n12', x: 522, y: 220, label: 'Expanding ( )' },
  { id: 'n13', x: 522, y: 334, label: 'Coordinates' },
  { id: 'n14', x: 688, y: 150, label: 'Bracket eqns' },
  { id: 'n15', x: 688, y: 290, label: 'Simultaneous' },
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

// ---------------------------------------------------------------------------
// Per-student status + stats overlay
// ---------------------------------------------------------------------------

export type NodeStatusMap = Record<string, NodeStatus>

/**
 * Aisha Bello's snapshot is the original, richly-detailed sample profile
 * (unchanged from the values every POV already displayed for her). Daniel
 * and Reuben are lighter snapshots consistent with their dashboard
 * `insight`/Oversight narratives in teacher/TeacherApp.tsx and data/oversight.ts:
 * Daniel clears easy items and avoids hard ones (strong on basics, stuck at
 * the Fractions → % frontier); Reuben understands things "in the moment" but
 * hasn't logged enough reps for anything past Substitution to be durable.
 */
export const NODE_STATUS_BY_STUDENT: Record<string, NodeStatusMap> = {
  aisha: {
    n1: 'mastered',
    n2: 'mastered',
    n3: 'mastered',
    n4: 'mastered',
    n5: 'mastered',
    n6: 'inprogress',
    n7: 'mastered',
    n8: 'mastered',
    n9: 'inprogress',
    n10: 'notready',
    n11: 'frontier',
    n12: 'frontier',
    n13: 'notready',
    n14: 'locked',
    n15: 'locked',
  },
  daniel: {
    n1: 'mastered',
    n2: 'mastered',
    n3: 'mastered',
    n4: 'inprogress',
    n5: 'mastered',
    n6: 'frontier',
    n7: 'notready',
    n8: 'mastered',
    n9: 'inprogress',
    n10: 'notready',
    n11: 'notready',
    n12: 'notready',
    n13: 'locked',
    n14: 'locked',
    n15: 'locked',
  },
  reuben: {
    n1: 'mastered',
    n2: 'mastered',
    n3: 'mastered',
    n4: 'mastered',
    n5: 'mastered',
    n6: 'inprogress',
    n7: 'inprogress',
    n8: 'mastered',
    n9: 'frontier',
    n10: 'notready',
    n11: 'notready',
    n12: 'notready',
    n13: 'notready',
    n14: 'locked',
    n15: 'locked',
  },
}

/** Falls back to 'notready' for a student/node with no recorded status. */
export function statusFor(studentId: string, nodeId: string): NodeStatus {
  return NODE_STATUS_BY_STUDENT[studentId]?.[nodeId] ?? 'notready'
}

export interface NodeStats {
  last: string
  next: string
  reps: number
}

export const NODE_STATS_BY_STUDENT: Record<string, Record<string, NodeStats>> = {
  aisha: {
    n1: { last: 'today · free play', next: 'in 11 days', reps: 16 },
    n2: { last: '12 days ago', next: 'in 14 days', reps: 13 },
    n3: { last: '15 days ago', next: 'in 18 days', reps: 11 },
    n4: { last: '7 days ago', next: 'in 9 days', reps: 12 },
    n5: { last: '6 days ago', next: 'in 8 days', reps: 14 },
    n6: { last: '2 days ago', next: 'tomorrow', reps: 9 },
    n7: { last: '8 days ago', next: 'in 10 days', reps: 10 },
    n8: { last: '4 days ago', next: 'in 5 days', reps: 15 },
    n9: { last: '2 days ago · free play', next: 'tomorrow', reps: 7 },
    n10: { last: '—', next: 'when ready', reps: 0 },
    n11: { last: 'today', next: 'today', reps: 5 },
    n12: { last: 'today', next: 'today', reps: 3 },
    n13: { last: '—', next: 'when ready', reps: 0 },
    n14: { last: '—', next: 'when ready', reps: 0 },
    n15: { last: '—', next: 'when ready', reps: 0 },
  },
  daniel: {
    n1: { last: '5 days ago', next: 'in 12 days', reps: 14 },
    n2: { last: '9 days ago', next: 'in 9 days', reps: 18 },
    n3: { last: '11 days ago', next: 'in 16 days', reps: 12 },
    n4: { last: '3 days ago', next: 'in 6 days', reps: 6 },
    n5: { last: '6 days ago', next: 'in 10 days', reps: 11 },
    n6: { last: 'today', next: 'today', reps: 8 },
    n7: { last: '—', next: 'when ready', reps: 0 },
    n8: { last: '4 days ago', next: 'in 7 days', reps: 13 },
    n9: { last: '8 days ago', next: 'in 5 days', reps: 5 },
    n10: { last: '—', next: 'when ready', reps: 0 },
    n11: { last: '—', next: 'when ready', reps: 0 },
    n12: { last: '—', next: 'when ready', reps: 0 },
    n13: { last: '—', next: 'when ready', reps: 0 },
    n14: { last: '—', next: 'when ready', reps: 0 },
    n15: { last: '—', next: 'when ready', reps: 0 },
  },
  reuben: {
    n1: { last: '10 days ago', next: 'in 9 days', reps: 7 },
    n2: { last: '14 days ago', next: 'in 11 days', reps: 6 },
    n3: { last: '16 days ago', next: 'in 13 days', reps: 5 },
    n4: { last: '9 days ago', next: 'in 8 days', reps: 6 },
    n5: { last: '12 days ago', next: 'in 10 days', reps: 6 },
    n6: { last: '7 days ago', next: 'in 6 days', reps: 4 },
    n7: { last: '9 days ago', next: 'in 7 days', reps: 4 },
    n8: { last: '6 days ago', next: 'in 9 days', reps: 7 },
    n9: { last: 'yesterday', next: 'in 2 days', reps: 3 },
    n10: { last: '—', next: 'when ready', reps: 0 },
    n11: { last: '—', next: 'when ready', reps: 0 },
    n12: { last: '—', next: 'when ready', reps: 0 },
    n13: { last: '—', next: 'when ready', reps: 0 },
    n14: { last: '—', next: 'when ready', reps: 0 },
    n15: { last: '—', next: 'when ready', reps: 0 },
  },
}

/** Falls back to '—'/0 for a student/node with no recorded stats. */
export function statsFor(studentId: string, nodeId: string): NodeStats {
  return NODE_STATS_BY_STUDENT[studentId]?.[nodeId] ?? { last: '—', next: '—', reps: 0 }
}
