import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Logo } from '../components/Logo'
import { GraphSvg } from '../components/GraphSvg'
import { NodeInfoCard } from '../components/NodeInfoCard'
import { PracticeLoop } from '../components/PracticeLoop'
import { BASKETS, EDGES, NODES, ST, edgePath } from '../data/knowledgeGraph'
import { LOG_RAW } from '../data/activityLog'
import type { LogQuestion } from '../data/activityLog'
import { CURRIC, DEFAULT_BASKET, DEFAULT_ROSTER, GRADES } from '../data/curriculum'
import { OVERSIGHT_KIND_META, OVERSIGHT_RAW } from '../data/oversight'
import type { OversightDetail } from '../data/oversight'
import { FONT_MONO, FONT_SERIF } from '../theme'

/**
 * Teacher POV — triage a class, drill into a student's knowledge profile,
 * pinpoint why a student is stuck, run the Oversight queue, keep an
 * "Address in person" list, and set up classes/baskets.
 */

type Screen =
  | 'dashboard'
  | 'student'
  | 'graphfull'
  | 'graphfocused'
  | 'logdetail'
  | 'oversight'
  | 'setup'
  | 'practice'

interface AddressItem {
  id: string
  student: string
  context: string
  note: string
}

interface LogDetailSource {
  kind: string
  title: string
  date: string
  result: string
  flag: 'attention' | 'ok'
  upload: boolean
  items: LogQuestion[]
}

interface TeacherState {
  screen: Screen
  layout: 'attention' | 'lanes' | 'roster'
  expOnTrack: boolean
  expAhead: boolean
  activeClass: string
  graphFilter: string
  openLog: number | null
  selectedNode: string | null
  selectedLog: number | null
  qOpen: number | null
  ovDetail: OversightDetail | null
  detailReturn: 'student' | 'oversight'
  addressList: AddressItem[]
  dismissedOv: string[]
  addSeq: number
  addingNote: boolean
  noteDraft: string
  menuOpen: string | null
  suClass: string
  suGrade: string
  suYear: string
  suSearch: string
  suRoster: string[]
  suDraft: string
  suBasket: Record<string, boolean>
}

const monoCap = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  color: '#8a7c63',
  ...extra,
})

const chip = (status: string): CSSProperties => {
  if (status === 'attention')
    return { background: '#fbe7d8', color: '#b6531f', border: '1px solid #eecab0', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }
  if (status === 'ahead')
    return { background: '#e8f0f4', color: '#2f6f92', border: '1px solid #cfe0e9', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }
  return { background: '#e4edf3', color: '#1f4e75', border: '1px solid #cddceb', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }
}

const avatar = (color?: string): CSSProperties => ({
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: color || '#0e2a43',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 600,
  fontSize: 12,
  flex: 'none',
})

const tierFill = (frac: number, color: string): CSSProperties => ({
  width: `${frac * 100}%`,
  height: '100%',
  background: color,
  borderRadius: 5,
})

const kindStyle: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '2px 7px',
  borderRadius: 5,
  background: '#efe7d9',
  color: '#8a7c63',
  flex: 'none',
}

const logFlag = (f: string): CSSProperties =>
  f === 'attention'
    ? { background: '#fbe7d8', color: '#b6531f', border: '1px solid #eecab0' }
    : { background: '#e4edf3', color: '#1f4e75', border: '1px solid #cddceb' }

const chipStyle = (bg: string, col: string, bd: string): CSSProperties => ({
  background: bg,
  color: col,
  border: `1px solid ${bd}`,
  fontSize: 12,
  fontWeight: 500,
  padding: '5px 11px',
  borderRadius: 7,
})

// difficulty-weighted tier triple: Foundations / Core / Stretch
const T = (f: number, c: number, st: number) => [
  { f, color: '#1f4e75' },
  { f: c, color: '#4a86ad' },
  { f: st, color: '#e8a06a' },
]

const CLASSES = [
  { key: '8M2', grade: 'Year 8', n: 24 },
  { key: '8M4', grade: 'Year 8', n: 26 },
  { key: '9S1', grade: 'Year 9', n: 22 },
]

const ATTENTION = [
  { id: 'aisha', initials: 'AB', name: 'Aisha Bello', trend: 'Stuck 3 sessions', topic: 'Linear equations', cause: 'Missing foundational knowledge', line: 'Rearranges equations as a memorised ritual - the prerequisite, inverse operations, never became solid.' },
  { id: 'daniel', initials: 'DK', name: 'Daniel Kovač', trend: 'Plateaued 2 weeks', topic: 'Fractions → percentages', cause: 'Ineffective practice method', line: 'Clears the easy items, avoids the hard ones - his average looks higher than his real mastery.' },
  { id: 'reuben', initials: 'RC', name: 'Reuben Clarke', trend: '2 sessions this fortnight', topic: 'Substitution', cause: 'Not enough practice', line: 'Understands it in the moment but has logged too few reps for it to become durable.' },
]

const ON_TRACK: Array<[string, string, string, string]> = [
  ['Priya Shah', 'Fractions → %', '2h ago', 'Steady across difficulties; ready to move to % change.'],
  ['Tom Weller', 'Linear equations', 'today', 'Solid on one-step; two-step just clicked this week.'],
  ['Grace Idowu', 'Proportion', 'yesterday', 'Strong recall on spaced reviews; retention holding.'],
  ['Marcus Lin', 'Expanding ( )', 'today', 'Careful with signs now — earlier slip is gone.'],
  ['Sofia Rossi', 'Substitution', '3h ago', 'Consistent method; times her own working well.'],
  ['Jack Enright', 'Linear equations', 'today', 'Back on pace after a slow fortnight.'],
  ['Amara Okoli', 'Ratio', '2d ago', 'Due a spaced review — last worked 8 days ago.'],
  ['Leo Marsh', 'Coordinates', 'today', 'Plotting confidently; negatives quadrant secure.'],
  ['Hana Ali', 'Fractions → %', 'yesterday', 'Improving on the harder non-calculator items.'],
  ['Noah Pratt', 'Substitution', 'today', 'Free-plays extra sets most evenings.'],
  ['Ivy Chen', 'Proportion', '4h ago', 'Reasoning shown clearly; explains her steps well.'],
  ['Ben Osei', 'Linear equations', 'today', 'On track; watch bracket equations next.'],
  ['Ruth Adeyemi', 'Expanding ( )', '2d ago', 'Strong start; a review is scheduled for Friday.'],
  ['Sam Doyle', 'Coordinates', 'today', 'Quietly consistent — no misconceptions flagged.'],
]

const AHEAD: Array<[string, string, string, string]> = [
  ['Elif Demir', 'Simultaneous eqns', 'today', 'A full term ahead; handling elimination cleanly.'],
  ['Oscar Reid', 'Bracket equations', 'today', 'Ready for stretch problem sets on brackets.'],
  ['Maya Kumar', 'Coordinates', 'yesterday', 'Extending into straight-line graphs early.'],
  ['Finn Walsh', 'Simultaneous eqns', 'today', 'Enjoys the hardest items; rarely uses hints.'],
  ['Zara Haq', 'Bracket equations', '3h ago', 'Accurate at speed; good to give harder stretch.'],
  ['Louis Berger', 'Coordinates', 'today', 'Midpoints and gradients already secure.'],
  ['Nina Petrov', 'Simultaneous eqns', '2d ago', 'Ahead on pace; a review keeps it durable.'],
]

const CLASS_TOPICS = [
  { name: 'Negatives', t: T(1, 0.92, 0.7) },
  { name: 'Fractions & %', t: T(0.95, 0.6, 0.25) },
  { name: 'Algebra basics', t: T(0.88, 0.55, 0.2) },
  { name: 'Linear equations', t: T(0.7, 0.35, 0.05) },
  { name: 'Ratio & proportion', t: T(0.9, 0.7, 0.4) },
]

const PACE_RAW = [
  { topic: 'Ratio & proportion', tag: 'Ahead · +1 term', kind: 'ahead', a: 0.88, e: 0.6 },
  { topic: 'Negatives', tag: 'Ahead', kind: 'ahead', a: 1, e: 0.9 },
  { topic: 'Fractions & %', tag: 'On pace', kind: 'onpace', a: 0.78, e: 0.75 },
  { topic: 'Algebra basics', tag: 'Behind', kind: 'behind', a: 0.55, e: 0.78 },
  { topic: 'Linear equations', tag: 'Behind · ½ term', kind: 'behind', a: 0.32, e: 0.7 },
]

const MASTERY_RAW = [
  { name: 'Negatives', t: T(1, 0.9, 0.6) },
  { name: 'Substitution', t: T(0.8, 0.4, 0) },
  { name: 'Linear equations', t: T(0.5, 0.15, 0) },
  { name: 'Fractions & %', t: T(0.95, 0.75, 0.4) },
]

const NODE_META: Record<string, { ret: string; retColor: string }> = {
  mastered: { ret: 'Strong', retColor: '#1f4e75' },
  inprogress: { ret: 'Building', retColor: '#3f82ab' },
  frontier: { ret: 'Active now', retColor: '#b6531f' },
  notready: { ret: 'Not started', retColor: '#8a7c63' },
  locked: { ret: 'Not started', retColor: '#8a7c63' },
}
const LAST_MAP: Record<string, string> = { n1: '9 days ago', n2: '12 days ago', n3: '15 days ago', n4: '7 days ago', n5: '6 days ago', n6: '2 days ago', n7: '8 days ago', n8: '4 days ago', n9: '2 days ago', n10: '—', n11: 'today', n12: 'today', n13: '—', n14: '—', n15: '—' }
const NEXT_MAP: Record<string, string> = { n1: 'in 11 days', n2: 'in 14 days', n3: 'in 18 days', n4: 'in 9 days', n5: 'in 8 days', n6: 'tomorrow', n7: 'in 10 days', n8: 'in 5 days', n9: 'tomorrow', n10: 'when ready', n11: 'today', n12: 'today', n13: 'when ready', n14: 'when ready', n15: 'when ready' }
const REPS_MAP: Record<string, number> = { n1: 16, n2: 13, n3: 11, n4: 12, n5: 14, n6: 9, n7: 10, n8: 15, n9: 7, n10: 0, n11: 5, n12: 3, n13: 0, n14: 0, n15: 0 }

const FRONTIER_GROUPS = [
  { label: 'Mastered', color: '#1f4e75', chips: ['Negatives', 'Fractions', 'Algebra basics', 'Neg. arithmetic'].map((n) => ({ name: n, style: chipStyle('#e4edf3', '#1f4e75', '#cddceb') })) },
  { label: 'Ready to learn now', color: '#b6531f', chips: ['Linear equations', 'Expanding ( )'].map((n) => ({ name: n, style: chipStyle('#fdf0e6', '#b6531f', '#f0d3bc') })) },
  { label: 'Not ready yet', color: '#8a7c63', chips: ['Coordinates', 'Bracket eqns', 'Simultaneous'].map((n) => ({ name: n, style: chipStyle('#f2ede2', '#8a7c63', '#ddd2bd') })) },
]

const INITIAL: TeacherState = {
  screen: 'dashboard',
  layout: 'attention',
  expOnTrack: false,
  expAhead: false,
  activeClass: '8M2',
  graphFilter: 'all',
  openLog: null,
  selectedNode: null,
  selectedLog: null,
  qOpen: null,
  ovDetail: null,
  detailReturn: 'student',
  addressList: [],
  dismissedOv: [],
  addSeq: 0,
  addingNote: false,
  noteDraft: '',
  menuOpen: null,
  suClass: '8M2',
  suGrade: 'Year 8',
  suYear: 'all',
  suSearch: '',
  suRoster: [...DEFAULT_ROSTER],
  suDraft: '',
  suBasket: { ...DEFAULT_BASKET },
}

export default function TeacherApp() {
  const [s, setS] = useState<TeacherState>(INITIAL)
  const setState = (patch: Partial<TeacherState> | ((st: TeacherState) => Partial<TeacherState>)) =>
    setS((st) => ({ ...st, ...(typeof patch === 'function' ? patch(st) : patch) }))

  const pushAddress = (p: Omit<AddressItem, 'id'>) =>
    setState((st) => ({
      addressList: [...st.addressList, { id: `a${st.addSeq}`, ...p }],
      addSeq: st.addSeq + 1,
      addingNote: false,
      noteDraft: '',
    }))

  const openStudent = () => setState({ screen: 'student' })

  const dismissOv = (id: string) => setState((st) => ({ dismissedOv: [...st.dismissedOv, id] }))

  // Both Resolve and Address in person dismiss a flag; prototype-local, resets on reload.
  const ovList = OVERSIGHT_RAW.map((it, i) => ({ ...it, id: `ov${i}` })).filter(
    (it) => !s.dismissedOv.includes(it.id),
  )

  if (s.screen === 'practice') {
    return (
      <PracticeLoop
        variant="preview"
        backLabel="← Exit preview"
        onExit={() => setState({ screen: 'student' })}
      />
    )
  }

  // ---- nav ----
  const activeNav =
    s.screen === 'student' || s.screen === 'logdetail' || s.screen === 'graphfull' || s.screen === 'graphfocused'
      ? 'students'
      : s.screen === 'oversight'
        ? 'oversight'
        : s.screen === 'setup'
          ? 'setup'
          : 'dash'
  const navItems: Array<{ key: string; label: string; go: () => void }> = [
    { key: 'dash', label: 'Dashboard', go: () => setState({ screen: 'dashboard' }) },
    { key: 'students', label: 'Students', go: openStudent },
    { key: 'oversight', label: 'Oversight', go: () => setState({ screen: 'oversight' }) },
    { key: 'setup', label: 'Class setup', go: () => setState({ screen: 'setup' }) },
  ]

  // ---- class switcher ----
  const ac = CLASSES.find((c) => c.key === s.activeClass) || CLASSES[0]

  // ---- roster / lanes data ----
  const mkStudent = (name: string, topic: string, status: string, last: string, insight = '') => {
    const initials = name
      .split(' ')
      .map((w) => w[0])
      .join('')
    const color = status === 'ahead' ? '#2f6f92' : status === 'attention' ? '#dd6a2f' : '#1f4e75'
    return {
      name,
      topic,
      sub: topic,
      last,
      insight,
      initials,
      status,
      statusLabel: status === 'attention' ? 'Needs attention' : status === 'ahead' ? 'Ahead' : 'On track',
      avatarStyle: avatar(color),
      chipStyle: chip(status),
    }
  }
  const onTrackStudents = ON_TRACK.map(([n, t, l, ins]) => mkStudent(n, t, 'ontrack', l, ins))
  const aheadStudents = AHEAD.map(([n, t, l, ins]) => mkStudent(n, t, 'ahead', l, ins))
  const lanes = [
    { title: 'Needs attention', count: 3, dot: '#dd6a2f', students: ATTENTION.map((a) => mkStudent(a.name, a.topic, 'attention', 'stuck', a.line)) },
    { title: 'On track', count: 14, dot: '#1f4e75', students: onTrackStudents.slice(0, 6) },
    { title: 'Ahead', count: 7, dot: '#2f6f92', students: aheadStudents.slice(0, 5) },
  ]
  const rosterAll = [
    ...ATTENTION.map((a) => mkStudent(a.name, a.topic, 'attention', 'stuck', a.line)),
    ...onTrackStudents,
    ...aheadStudents,
  ]
  const collapsed = [
    { title: 'On track', count: 14, open: s.expOnTrack, toggle: () => setState({ expOnTrack: !s.expOnTrack }), dot: '#1f4e75', students: onTrackStudents },
    { title: 'Ahead of pace', count: 7, open: s.expAhead, toggle: () => setState({ expAhead: !s.expAhead }), dot: '#2f6f92', students: aheadStudents },
  ]

  // ---- knowledge graph (student drill-down) ----
  const graphNodes = NODES.map((n) => {
    const st = ST[n.st]
    const sel = s.selectedNode === n.id
    return {
      id: n.id,
      x: n.x,
      y: n.y,
      tx: n.x + 66,
      ty: n.y + 22,
      label: n.label,
      fill: st.fill,
      stroke: sel ? '#dd6a2f' : st.stroke,
      sw: sel ? 3 : st.sw,
      dash: st.dash,
      text: st.text,
      onClick: () => setState((prev) => ({ selectedNode: prev.selectedNode === n.id ? null : n.id })),
    }
  })
  const graphEdges = EDGES.map(([a, b]) => {
    const frontier = NODES.find((n) => n.id === b)!.st === 'frontier'
    return { d: edgePath(a, b), stroke: frontier ? '#e8a06a' : '#d3c6ab', sw: frontier ? 2 : 1.4 }
  })
  const gf = s.graphFilter
  const activeBasket = gf === 'all' ? null : BASKETS.find((b) => b.key === gf)
  const inFocus = (id: string) => !activeBasket || activeBasket.ids.indexOf(id) > -1
  const focusedNodes = graphNodes.map((n) => ({ ...n, op: inFocus(n.id) ? 1 : 0.14 }))
  const focusedEdges = graphEdges.map((e, idx) => {
    const [a, b] = EDGES[idx]
    return { ...e, op: inFocus(a) && inFocus(b) ? 1 : 0.1 }
  })
  const filterChips = [{ key: 'all', label: 'All basket topics' }, ...BASKETS.map((b) => ({ key: b.key, label: b.label }))]

  const selNode = s.selectedNode ? NODES.find((n) => n.id === s.selectedNode) : null
  const nodeInfoCard = selNode && (
    <NodeInfoCard
      heading="Subtopic"
      title={selNode.label}
      fields={[
        { label: 'Last worked', value: LAST_MAP[selNode.id] || '—' },
        { label: 'Next review', value: NEXT_MAP[selNode.id] || '—' },
        { label: 'Times practised', value: REPS_MAP[selNode.id] || 0 },
        { label: 'Retention', value: NODE_META[selNode.st].ret, color: NODE_META[selNode.st].retColor },
      ]}
      onClose={() => setState({ selectedNode: null })}
    />
  )

  const tagStyleFor = (k: string): CSSProperties => {
    const base: CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20 }
    if (k === 'ahead') return { ...base, color: '#2f6f92', background: '#e8f0f4' }
    if (k === 'behind') return { ...base, color: '#b6531f', background: '#fbe7d8' }
    return { ...base, color: '#1f4e75', background: '#e4edf3' }
  }

  // ---- log detail (shared with oversight "Go to the question") ----
  const ld: LogDetailSource | null = s.ovDetail ? s.ovDetail : s.selectedLog != null ? LOG_RAW[s.selectedLog] : null

  // ---- class setup ----
  const q = s.suSearch.toLowerCase()
  const matchTopic = (t: [string, string, string]) =>
    (s.suYear === 'all' || t[2] === s.suYear) && (!q || t[1].toLowerCase().indexOf(q) > -1)
  const basketGroups = CURRIC.map((g) => ({ group: g.group, topics: g.topics.filter(matchTopic) })).filter(
    (g) => g.topics.length > 0,
  )
  const basketCount = Object.values(s.suBasket).filter(Boolean).length

  return (
    <div style={{ minHeight: '100vh', background: '#fbf9f5' }}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Left nav rail */}
        <nav style={{ width: 212, flex: 'none', background: '#0e2a43', color: '#dbe6ef', display: 'flex', flexDirection: 'column', padding: '22px 14px', position: 'sticky', top: 0, height: '100vh' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 24px' }}>
            <Logo size={30} />
            <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 19, color: '#fff', letterSpacing: '.2px' }}>Anadromos</span>
          </div>
          {navItems.map((n) => {
            const active = n.key === activeNav
            return (
              <div
                key={n.key}
                onClick={n.go}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, fontSize: 13.5, fontWeight: active ? 600 : 500, cursor: 'pointer', color: active ? '#fff' : '#9fb4c7', background: active ? 'rgba(221,106,47,.16)' : 'transparent', marginBottom: 2 }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#dd6a2f' : 'transparent', flex: 'none' }} />
                {n.label}
              </div>
            )
          })}
          <div style={{ marginTop: 'auto', padding: '14px 10px 4px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
            <div style={{ fontSize: 12, color: '#9fb4c7' }}>Ms. Okafor</div>
            <div style={{ fontSize: 11, color: '#6f8aa2', marginTop: 2 }}>Maths · 8M2, 8M4, 9S1</div>
          </div>
        </nav>

        <main style={{ flex: 1, minWidth: 0 }}>
          {/* ---------- DASHBOARD ---------- */}
          {s.screen === 'dashboard' && (
            <div style={{ padding: '30px 40px 60px', maxWidth: 1180 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <span style={monoCap({ letterSpacing: '.6px', marginRight: 4 })}>Your classes</span>
                {CLASSES.map((c) => {
                  const on = c.key === s.activeClass
                  return (
                    <button
                      key={c.key}
                      onClick={() => setState({ activeClass: c.key })}
                      style={{ cursor: 'pointer', textAlign: 'left', padding: '8px 15px', borderRadius: 9, background: on ? '#0e2a43' : '#efe7d9', color: on ? '#fff' : '#5c6773', border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd' }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13.5, display: 'block', lineHeight: 1.2 }}>{c.key}</span>
                      <span style={{ fontSize: 10.5, opacity: 0.75, display: 'block' }}>{c.grade}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Class overview</div>
                  <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 30, margin: '6px 0 4px', color: '#0e2a43' }}>
                    {ac.key} · {ac.grade} Mathematics
                  </h1>
                  <div style={{ fontSize: 14, color: '#5c6773' }}>{ac.n} students · Autumn term, week 9 · updated live from practice</div>
                </div>
                <div style={{ display: 'flex', background: '#efe7d9', border: '1px solid #e0d4bd', borderRadius: 11, padding: 3, gap: 2 }}>
                  {(
                    [
                      ['attention', 'Attention first'],
                      ['lanes', 'Three lanes'],
                      ['roster', 'Full roster'],
                    ] as const
                  ).map(([k, l]) => {
                    const on = s.layout === k
                    return (
                      <button
                        key={k}
                        onClick={() => setState({ layout: k })}
                        style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 8, background: on ? '#fff' : 'transparent', color: on ? '#0e2a43' : '#8a7c63', boxShadow: on ? '0 1px 2px rgba(20,48,74,.12)' : 'none' }}
                      >
                        {l}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Address in person to-do */}
              <div style={{ marginTop: 24, background: '#fdf0e6', border: '1px solid #f0d3bc', borderRadius: 12, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#dd6a2f', flex: 'none' }} />
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Address in person</h2>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#b6531f' }}>{s.addressList.length} to do</span>
                  <button
                    onClick={() => setState((st) => ({ addingNote: !st.addingNote, noteDraft: '' }))}
                    title="Add a note"
                    style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, border: '1px solid #e0b997', background: '#fff', color: '#b6531f', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
                  >
                    +
                  </button>
                </div>

                {s.addingNote && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <input
                      value={s.noteDraft}
                      onChange={(e) => setState({ noteDraft: e.target.value })}
                      placeholder="e.g. Check in with Marcus about missed homework"
                      style={{ flex: 1, minWidth: 0, border: '1px solid #e0b997', borderRadius: 8, background: '#fff', padding: '10px 12px', fontSize: 13.5, color: '#1a2129', outline: 'none' }}
                    />
                    <button
                      onClick={() => {
                        const d = s.noteDraft.trim()
                        if (d) pushAddress({ student: 'General', context: 'Note to self', note: d })
                      }}
                      style={{ background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Add
                    </button>
                  </div>
                )}

                {s.addressList.length > 0 ? (
                  <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
                    {s.addressList.map((c) => (
                      <div key={c.id} style={{ background: '#fff', border: '1px solid #f0d3bc', borderRadius: 10, padding: '12px 14px', position: 'relative' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0e2a43' }}>{c.student}</span>
                          <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: '#8a7c63', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.context}</span>
                          <button
                            onClick={() => setState((st) => ({ menuOpen: st.menuOpen === c.id ? null : c.id }))}
                            style={{ border: 'none', background: 'transparent', color: '#a99e88', fontSize: 16, lineHeight: 1, cursor: 'pointer', flex: 'none' }}
                          >
                            ···
                          </button>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.45, color: '#5c6773', textWrap: 'pretty' }}>{c.note}</p>
                        {s.menuOpen === c.id && (
                          <div style={{ position: 'absolute', top: 34, right: 10, background: '#fff', border: '1px solid #e4dccb', borderRadius: 8, boxShadow: '0 4px 14px rgba(20,48,74,.14)', overflow: 'hidden', zIndex: 5 }}>
                            <button
                              onClick={() => setState((st) => ({ addressList: st.addressList.filter((x) => x.id !== c.id), menuOpen: null }))}
                              style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '9px 16px', fontSize: 12.5, color: '#b6531f', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              Remove from list
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#8a6b4f', textWrap: 'pretty' }}>
                    Nothing flagged for a face-to-face yet. Add items from a student's activity log or the Oversight list, or hit + for a quick note.
                  </p>
                )}
              </div>

              {/* ATTENTION FIRST layout */}
              {s.layout === 'attention' && (
                <div style={{ marginTop: 26 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#dd6a2f', display: 'inline-block' }} />
                    <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Needs attention first</h2>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>3 students</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 16 }}>
                    {ATTENTION.map((a) => (
                      <div key={a.id} style={{ background: '#fff', border: '1px solid #eecab0', borderTop: '3px solid #dd6a2f', borderRadius: 12, padding: '18px 18px 16px', boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#0e2a43', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, flex: 'none' }}>{a.initials}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 15, color: '#1a2129' }}>{a.name}</div>
                            <div style={{ fontSize: 12.5, color: '#8a7c63' }}>{a.trend}</div>
                          </div>
                          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#b6531f', background: '#fbe7d8', border: '1px solid #eecab0', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>Stuck</span>
                        </div>
                        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                            <span style={monoCap({ width: 56, flex: 'none' })}>Topic</span>
                            <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1a2129' }}>{a.topic}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                            <span style={monoCap({ width: 56, flex: 'none' })}>Cause</span>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: '#b6531f' }}>{a.cause}</span>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, color: '#5c6773', textWrap: 'pretty' }}>{a.line}</p>
                        </div>
                        <button
                          onClick={openStudent}
                          style={{ marginTop: 15, width: '100%', background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 9, padding: 10, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}
                        >
                          Open profile →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* THREE LANES layout */}
              {s.layout === 'lanes' && (
                <div style={{ marginTop: 26, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  {lanes.map((lane) => (
                    <div key={lane.title} style={{ background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 12, padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: lane.dot, display: 'inline-block', flex: 'none' }} />
                        <h2 style={{ fontFamily: FONT_SERIF, fontSize: 15, fontWeight: 600, margin: 0, color: '#0e2a43' }}>{lane.title}</h2>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63', marginLeft: 'auto' }}>{lane.count}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {lane.students.map((st) => (
                          <div key={st.name} onClick={openStudent} style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 9, padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={st.avatarStyle}>{st.initials}</div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1a2129', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.name}</div>
                              <div style={{ fontSize: 11.5, color: '#8a7c63', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.sub}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ROSTER layout */}
              {s.layout === 'roster' && (
                <div style={{ marginTop: 22, background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.4fr 1fr 0.8fr', gap: 12, padding: '11px 18px', background: '#efe7d9', fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.6px', textTransform: 'uppercase', color: '#8a7c63' }}>
                    <div>Student</div>
                    <div>Current topic</div>
                    <div>Status</div>
                    <div style={{ textAlign: 'right' }}>Last active</div>
                  </div>
                  {rosterAll.map((st) => (
                    <div key={st.name} onClick={openStudent} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.4fr 1fr 0.8fr', gap: 12, padding: '12px 18px', borderTop: '1px solid #f0e9dc', cursor: 'pointer', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={st.avatarStyle}>{st.initials}</div>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{st.name}</span>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, color: '#5c6773' }}>{st.topic}</div>
                        {!!st.insight && <div style={{ fontSize: 11.5, color: '#a99e88', marginTop: 2, textWrap: 'pretty' }}>{st.insight}</div>}
                      </div>
                      <div>
                        <span style={st.chipStyle}>{st.statusLabel}</span>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 12.5, color: '#8a7c63' }}>{st.last}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Collapsed rest (shown only in attention layout) */}
              {s.layout === 'attention' && (
                <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {collapsed.map((grp) => (
                    <div key={grp.title} style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, overflow: 'hidden' }}>
                      <div onClick={grp.toggle} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', cursor: 'pointer' }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: grp.dot, display: 'inline-block', flex: 'none' }} />
                        <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 15, color: '#0e2a43' }}>{grp.title}</span>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{grp.count} students</span>
                        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: '#8a7c63' }}>{grp.open ? 'Hide ▲' : 'Show ▾'}</span>
                      </div>
                      {grp.open && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '2px 18px 18px' }}>
                          {grp.students.map((st) => (
                            <div key={st.name} onClick={openStudent} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 20, padding: '5px 12px 5px 5px', cursor: 'pointer' }}>
                              <div style={avatar(grp.dot)}>{st.initials}</div>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{st.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Class mastery by topic (difficulty-weighted) */}
              <div style={{ marginTop: 30, background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Class mastery by topic</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11.5, color: '#8a7c63' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 26, height: 9, borderRadius: 2, background: '#1f4e75', display: 'inline-block' }} />
                      Foundations
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 26, height: 9, borderRadius: 2, background: '#4a86ad', display: 'inline-block' }} />
                      Core
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 26, height: 9, borderRadius: 2, background: '#e8a06a', display: 'inline-block' }} />
                      Stretch
                    </span>
                  </div>
                </div>
                <p style={{ margin: '6px 0 18px', fontSize: 12.5, color: '#8a7c63', maxWidth: 640 }}>
                  Weighted by item difficulty, so a class can't look finished on a topic by only clearing its easy items. Thin stretch bars are where the hardest work still sits.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {CLASS_TOPICS.map((t) => (
                    <div key={t.name} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 16, alignItems: 'center' }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1a2129' }}>{t.name}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {t.t.map((tier, i) => (
                          <div key={i} style={{ flex: 1, height: 22, borderRadius: 5, background: '#f0e9dc', overflow: 'hidden', position: 'relative' }}>
                            <div style={tierFill(tier.f, tier.color)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ---------- STUDENT DRILL-DOWN ---------- */}
          {s.screen === 'student' && (
            <div style={{ padding: '26px 40px 60px', maxWidth: 1180 }}>
              <div onClick={() => setState({ screen: 'dashboard' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5c6773', cursor: 'pointer', marginBottom: 16 }}>
                ← 8M2 class overview
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#0e2a43', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 19, flex: 'none' }}>AB</div>
                <div>
                  <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 27, margin: 0, color: '#0e2a43' }}>Aisha Bello</h1>
                  <div style={{ fontSize: 13.5, color: '#5c6773' }}>Year 8 · 8M2 · joined September</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#b6531f', background: '#fbe7d8', border: '1px solid #eecab0', padding: '5px 12px', borderRadius: 20 }}>Needs attention</span>
                <button
                  onClick={() => setState({ screen: 'practice' })}
                  style={{ marginLeft: 'auto', background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 18px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}
                >
                  Preview her practice view →
                </button>
              </div>

              {/* "Where to start" — deliberately bulleted to avoid AI-narrative prose */}
              <div style={{ marginTop: 8, background: '#fdf0e6', border: '1px solid #f0d3bc', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dd6a2f', flex: 'none' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: '#b6531f', fontFamily: FONT_MONO }}>Where to start</span>
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    'At the linear-equations frontier, but rearranging is a memorised ritual, not understood.',
                    'Likely root cause: the prerequisite - inverse operations (substitution) - never became solid.',
                    'Best next move: a short re-teach of that step, not more equation practice.',
                  ].map((b, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.5, color: '#5c3a24' }}>
                      <span style={{ color: '#dd6a2f', flex: 'none' }}>•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 20, alignItems: 'start' }}>
                {/* Pace ribbon */}
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '20px 22px' }}>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 3px', color: '#0e2a43' }}>Against expected pace</h2>
                  <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#8a7c63' }}>
                    Where a Year 8 is expected to be by week 9 (marker) vs. where Aisha actually is. Mixed is normal - she's ahead on some, behind on others.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                    {PACE_RAW.map((p) => (
                      <div key={p.topic}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#1a2129' }}>{p.topic}</span>
                          <span style={tagStyleFor(p.kind)}>{p.tag}</span>
                        </div>
                        <div style={{ position: 'relative', height: 14, background: '#f0e9dc', borderRadius: 7 }}>
                          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${p.a * 100}%`, background: p.kind === 'behind' ? '#c98a63' : '#1f4e75', borderRadius: 7 }} />
                          <div title="expected" style={{ position: 'absolute', top: -3, left: `calc(${p.e * 100}% - 1px)`, width: 2, height: 20, background: '#0e2a43', borderRadius: 1 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 14, display: 'flex', gap: 18, fontSize: 11.5, color: '#8a7c63' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 20, height: 8, borderRadius: 2, background: '#1f4e75', display: 'inline-block' }} />
                      Aisha now
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 2, height: 14, background: '#0e2a43', display: 'inline-block' }} />
                      Expected by wk 9
                    </span>
                  </div>
                </div>

                {/* Difficulty-weighted mastery */}
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '20px 22px' }}>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 3px', color: '#0e2a43' }}>Mastery, difficulty-weighted</h2>
                  <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#8a7c63' }}>No place to hide: solid on the easy items, thin where it gets hard.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {MASTERY_RAW.map((t) => (
                      <div key={t.name}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#1a2129', marginBottom: 6 }}>{t.name}</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {t.t.map((tier, i) => (
                            <div key={i} style={{ flex: 1, height: 20, borderRadius: 5, background: '#f0e9dc', overflow: 'hidden' }}>
                              <div style={tierFill(tier.f, tier.color)} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Knowledge graph access (opened on purpose, never auto-loaded) */}
              <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <button
                  onClick={() => setState({ screen: 'graphfocused', graphFilter: 'all' })}
                  style={{ textAlign: 'left', background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px', cursor: 'pointer' }}
                >
                  <div style={monoCap({ letterSpacing: '.6px', color: '#b6531f' })}>Day to day</div>
                  <div style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, color: '#0e2a43', margin: '5px 0 5px' }}>Focused knowledge graph →</div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#5c6773', textWrap: 'pretty' }}>
                    Scoped to 8M2's basket of topics for the year, plus every prerequisite subtopic. Filter by topic.
                  </p>
                </button>
                <button
                  onClick={() => setState({ screen: 'graphfull' })}
                  style={{ textAlign: 'left', background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px', cursor: 'pointer' }}
                >
                  <div style={monoCap({ letterSpacing: '.6px', color: '#1f4e75' })}>Full picture</div>
                  <div style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, color: '#0e2a43', margin: '5px 0 5px' }}>All of mathematics →</div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#5c6773', textWrap: 'pretty' }}>
                    Every topic Anadromos has assessed Aisha on, across all years, not just this class.
                  </p>
                </button>
              </div>

              <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
                {/* Activity log */}
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '20px 22px' }}>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: '#0e2a43' }}>Activity log</h2>
                  <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#8a7c63' }}>
                    Every lesson, problem set and review she's completed. Click one for the detail behind the summary.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {LOG_RAW.map((a, i) => {
                      const open = s.openLog === i
                      return (
                        <div key={i} style={{ borderTop: '1px solid #f0e9dc' }}>
                          <div
                            onClick={() => setState((st) => ({ openLog: st.openLog === i ? null : i }))}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 0', cursor: 'pointer' }}
                          >
                            <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: a.flag === 'attention' ? '#dd6a2f' : '#1f4e75' }} />
                            <span style={kindStyle}>{a.kind}</span>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1a2129', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                              <div style={{ fontSize: 12.5, color: '#8a7c63', marginTop: 1, textWrap: 'pretty' }}>{a.summary}</div>
                            </div>
                            <span style={{ ...logFlag(a.flag), fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{a.result}</span>
                            <span style={{ color: '#b1a58c', fontSize: 12, width: 14, flex: 'none', textAlign: 'center' }}>{open ? '▾' : '▸'}</span>
                          </div>
                          {open && (
                            <div style={{ padding: '2px 0 16px 26px' }}>
                              <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: '#a99e88', marginBottom: 8 }}>{a.date}</div>
                              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                                {a.detail.map((d, j) => (
                                  <li key={j} style={{ display: 'flex', gap: 9, fontSize: 12.5, lineHeight: 1.5, color: '#5c6773' }}>
                                    <span style={{ color: '#c3b8a1', flex: 'none' }}>-</span>
                                    <span style={{ textWrap: 'pretty' }}>{d}</span>
                                  </li>
                                ))}
                              </ul>
                              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button
                                  onClick={() => setState({ screen: 'logdetail', selectedLog: i, ovDetail: null, detailReturn: 'student', selectedNode: null, qOpen: null })}
                                  style={{ background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                                >
                                  Open where it happened →
                                </button>
                                <button
                                  onClick={() => pushAddress({ student: 'Aisha Bello', context: `${a.kind} · ${a.title}`, note: a.summary })}
                                  style={{ background: '#fff', color: '#b6531f', border: '1px solid #eecab0', borderRadius: 8, padding: '9px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                                >
                                  + Address in person
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Frontier / working on now */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '20px 22px' }}>
                    <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 14px', color: '#0e2a43' }}>Frontier</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {FRONTIER_GROUPS.map((g) => (
                        <div key={g.label}>
                          <div style={monoCap({ letterSpacing: '.6px', marginBottom: 8, color: g.color })}>{g.label}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                            {g.chips.map((c) => (
                              <span key={c.name} style={c.style}>
                                {c.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ background: '#fdf0e6', border: '1px solid #f0d3bc', borderRadius: 12, padding: '18px 20px' }}>
                    <div style={monoCap({ letterSpacing: '.6px', color: '#b6531f' })}>Working on now</div>
                    <div style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 600, color: '#0e2a43', margin: '6px 0 4px' }}>Linear equations</div>
                    <p style={{ margin: '0 0 10px', fontSize: 13, color: '#5c3a24' }}>Two-step equations with the unknown on one side.</p>
                    <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#8a6b4f', textWrap: 'pretty' }}>
                      Scaffolding is still high here - hints show full worked steps, and will fade automatically as her mastery of this topic rises.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---------- FULL KNOWLEDGE GRAPH ---------- */}
          {s.screen === 'graphfull' && (
            <div style={{ padding: '26px 40px 60px' }}>
              <div onClick={() => setState({ screen: 'student' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5c6773', cursor: 'pointer', marginBottom: 14 }}>
                ← Aisha's profile
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
                <div>
                  <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Full picture</div>
                  <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '5px 0 3px', color: '#0e2a43' }}>Aisha Bello · all of mathematics</h1>
                  <div style={{ fontSize: 13, color: '#5c6773' }}>
                    Every topic Anadromos has assessed her on, across all years. Scroll to explore; click a subtopic for its last-worked and review dates.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: '#8a7c63' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: '#1f4e75', display: 'inline-block' }} />
                    Mastered
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: '#7fb0cd', display: 'inline-block' }} />
                    In progress
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: '#fdf0e6', border: '2px solid #dd6a2f', display: 'inline-block' }} />
                    Frontier
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: '#efe7d9', border: '1px solid #d8cbb2', display: 'inline-block' }} />
                    Not ready
                  </span>
                </div>
              </div>
              <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: 16, overflow: 'auto', maxHeight: '72vh' }}>
                <GraphSvg edges={graphEdges} nodes={graphNodes} width={1120} />
              </div>
              {nodeInfoCard}
            </div>
          )}

          {/* ---------- FOCUSED KNOWLEDGE GRAPH ---------- */}
          {s.screen === 'graphfocused' && (
            <div style={{ padding: '26px 40px 60px' }}>
              <div onClick={() => setState({ screen: 'student' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5c6773', cursor: 'pointer', marginBottom: 14 }}>
                ← Aisha's profile
              </div>
              <div>
                <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Day to day</div>
                <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '5px 0 3px', color: '#0e2a43' }}>Focused profile · 8M2 basket</h1>
                <div style={{ fontSize: 13, color: '#5c6773', maxWidth: 640, textWrap: 'pretty' }}>
                  The topics 8M2 should master this year, expanded to every prerequisite subtopic (shared subtopics shown once). Filter to a single basket topic and its prerequisite chain.
                </div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={monoCap({ letterSpacing: '.6px', marginRight: 2 })}>Filter</span>
                {filterChips.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setState({ graphFilter: c.key })}
                    style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 8, background: gf === c.key ? '#0e2a43' : '#efe7d9', color: gf === c.key ? '#fff' : '#5c6773' }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#8a7c63' }}>
                Click a subtopic to see when Aisha last worked on it and when it's next due for review.
              </div>
              <div style={{ marginTop: 8, background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
                <GraphSvg edges={focusedEdges} nodes={focusedNodes} width="100%" style={{ minWidth: 760 }} />
              </div>
              {nodeInfoCard}
            </div>
          )}

          {/* ---------- ACTIVITY LOG DETAIL ---------- */}
          {s.screen === 'logdetail' && ld && (
            <div style={{ padding: '26px 40px 60px', maxWidth: 960 }}>
              <div
                onClick={() => setState({ screen: s.detailReturn || 'student', ovDetail: null })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#5c6773', cursor: 'pointer', marginBottom: 14 }}
              >
                {s.detailReturn === 'oversight' ? '← Oversight' : "← Aisha's profile"}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={kindStyle}>{ld.kind}</span>
                <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 24, margin: 0, color: '#0e2a43' }}>{ld.title}</h1>
                <span style={{ ...logFlag(ld.flag), fontSize: 12, fontWeight: 600, padding: '3px 11px', borderRadius: 20, whiteSpace: 'nowrap' }}>{ld.result}</span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63' }}>{ld.date}</span>
              </div>
              <p style={{ margin: '10px 0 18px', fontSize: 13, color: '#5c6773' }}>
                Every item in this activity, with the hiccups flagged. Orange rows are where it went wrong.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {ld.items.map((it, qi) => {
                    const canOpen = !!(it.hit && it.work)
                    const isOpen = s.qOpen === qi
                    return (
                      <div
                        key={qi}
                        onClick={() => {
                          if (canOpen) setState((st) => ({ qOpen: st.qOpen === qi ? null : qi }))
                        }}
                        style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 14, padding: '13px 14px', borderRadius: 9, background: it.hit ? '#fdf0e6' : '#faf6ee', border: `1px solid ${it.hit ? '#f0d3bc' : '#ece3d2'}`, cursor: canOpen ? 'pointer' : 'default' }}
                      >
                        <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, color: it.hit ? '#b6531f' : '#8a7c63' }}>{it.label}</span>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: FONT_SERIF, fontSize: 15, color: '#1a2129' }}>{it.q}</span>
                            <span
                              style={
                                it.hit
                                  ? { fontSize: 10.5, fontWeight: 600, color: '#b6531f', background: '#fbe7d8', border: '1px solid #eecab0', padding: '2px 8px', borderRadius: 20 }
                                  : { fontSize: 10.5, fontWeight: 600, color: '#1f4e75', background: '#e4edf3', border: '1px solid #cddceb', padding: '2px 8px', borderRadius: 20 }
                              }
                            >
                              {it.hit ? 'Hiccup here' : 'OK'}
                            </span>
                            {canOpen && (
                              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#b6531f', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {isOpen ? 'Hide working ▾' : 'See working ▸'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12.5, color: '#5c6773', marginTop: 4, textWrap: 'pretty' }}>{it.note}</div>
                          {isOpen && (
                            <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e4dccb', borderRadius: 10, padding: '14px 16px' }}>
                              <div style={monoCap({ fontSize: 10, marginBottom: 8 })}>Her full working — flagged lines highlighted</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {(it.work || []).map((tex, li) => {
                                  const wrong = (it.wrong || []).includes(li)
                                  return (
                                    <div
                                      key={li}
                                      style={
                                        wrong
                                          ? { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 12px', borderRadius: 8, background: '#fdf0e6', border: '1px solid #f0d3bc' }
                                          : { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 12px' }
                                      }
                                    >
                                      <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#a99e88', width: 16, flex: 'none' }}>{li + 1}</span>
                                      <span style={{ fontFamily: FONT_SERIF, fontSize: 18, color: wrong ? '#b6531f' : '#1a2129' }}>{tex}</span>
                                    </div>
                                  )
                                })}
                              </div>
                              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {(it.wrong || []).map((li, k) => (
                                  <div key={li} style={{ borderLeft: '3px solid #dd6a2f', padding: '2px 0 2px 12px' }}>
                                    <div style={{ fontFamily: FONT_SERIF, fontSize: 15, color: '#b6531f' }}>
                                      Line {li + 1}: {(it.work || [])[li] || ''}
                                    </div>
                                    <div style={{ fontSize: 12.5, color: '#5c6773', marginTop: 3, textWrap: 'pretty' }}>{(it.why || [])[k] || ''}</div>
                                  </div>
                                ))}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  pushAddress({ student: 'Aisha Bello', context: `${ld.kind} · ${ld.title} · ${it.label}`, note: (it.why && it.why[0]) || it.note })
                                }}
                                style={{ marginTop: 14, background: '#fff', color: '#b6531f', border: '1px solid #eecab0', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                              >
                                Address in person →
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px' }}>
                  <div style={monoCap({ marginBottom: 10 })}>Handwritten working</div>
                  {ld.upload ? (
                    <>
                      <div style={{ border: '1px solid #e4dccb', borderRadius: 10, height: 260, background: 'repeating-linear-gradient(#fffdf8,#fffdf8 30px,#eef0f2 31px)', position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 14, left: 16, fontFamily: FONT_SERIF, fontSize: 18, color: '#33404b', transform: 'rotate(-1.5deg)' }}>3x − 7 = 11</div>
                        <div style={{ position: 'absolute', top: 44, left: 22, fontFamily: FONT_SERIF, fontSize: 18, color: '#33404b', transform: 'rotate(-1deg)' }}>3x = 11 − 7  ✗</div>
                        <div style={{ position: 'absolute', top: 74, left: 20, fontFamily: FONT_SERIF, fontSize: 18, color: '#33404b', transform: 'rotate(-2deg)' }}>3x = 4</div>
                        <div style={{ width: '100%', padding: 8, background: 'rgba(14,42,67,.82)', color: '#dbe6ef', fontSize: 11, textAlign: 'center', fontFamily: FONT_MONO }}>
                          aisha_working.jpg · uploaded today · click to enlarge
                        </div>
                      </div>
                      <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.5, color: '#8a7c63', textWrap: 'pretty' }}>
                        She uploaded this for reference. It isn't read by the AI or used in the diagnosis - it's here so you can confirm the working was done by hand.
                      </p>
                    </>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: '#8a7c63', textWrap: 'pretty' }}>No handwritten working was uploaded for this activity.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---------- OVERSIGHT ---------- */}
          {s.screen === 'oversight' && (
            <div style={{ padding: '30px 40px 60px', maxWidth: 900 }}>
              <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Oversight</div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 28, margin: '6px 0 4px', color: '#0e2a43' }}>What the AI wants your eyes on</h1>
              <p style={{ margin: '0 0 8px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 640, textWrap: 'pretty' }}>
                A short, triaged list of flagged moments, not a transcript archive. Only diagnoses that look uncertain or interactions worth a teacher's judgement surface here, so the list stays short enough to actually clear.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 14px' }}>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{ovList.length} flagged this week</span>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#c3b8a1' }} />
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>nothing older is kept for you to audit</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {ovList.map((o) => {
                  const m = OVERSIGHT_KIND_META[o.kind]
                  return (
                    <div key={o.id} style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: m.color }} />
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: m.color, background: m.bg, border: `1px solid ${m.bd}`, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{m.label}</span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#1a2129' }}>{o.title}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63' }}>{o.context}</span>
                      </div>
                      <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.55, color: '#5c6773', textWrap: 'pretty' }}>{o.body}</p>
                      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid #f0e9dc' }}>
                        <span style={monoCap()}>Your call</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#0e2a43' }}>{o.asks}</span>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => {
                              pushAddress({ student: o.student, context: o.context, note: o.title })
                              dismissOv(o.id)
                            }}
                            style={{ background: '#fff', border: '1px solid #eecab0', borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: '#b6531f', cursor: 'pointer' }}
                          >
                            + Address in person
                          </button>
                          <button
                            onClick={() => setState({ screen: 'logdetail', ovDetail: o.detail, selectedLog: null, detailReturn: 'oversight', selectedNode: null, qOpen: null })}
                            style={{ background: '#fff', border: '1px solid #cdbfa6', borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: '#0e2a43', cursor: 'pointer' }}
                          >
                            Go to the question →
                          </button>
                          {/* Resolve = defer to the AI's judgement */}
                          <button
                            onClick={() => dismissOv(o.id)}
                            style={{ background: '#0e2a43', border: 'none', borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: '#fff', cursor: 'pointer' }}
                          >
                            Resolve
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {ovList.length === 0 && (
                  <div style={{ background: '#fff', border: '1px dashed #d8cfbb', borderRadius: 12, padding: '30px 20px', textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0e2a43' }}>All clear</p>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8a7c63', textWrap: 'pretty' }}>
                      Every flag has been resolved or moved to your address-in-person list. New ones will appear here as the AI raises them.
                    </p>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'flex-start', background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 10, padding: '14px 16px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f4e75', marginTop: 6, flex: 'none' }} />
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#2b4a63', textWrap: 'pretty' }}>
                  Deliberately not a full log. Research on AI oversight found unstructured monitoring makes reviewers measurably worse and more likely to burn out, so Anadromos triages for you and keeps this list short.
                </p>
              </div>
            </div>
          )}

          {/* ---------- CLASS SETUP ---------- */}
          {s.screen === 'setup' && (
            <div style={{ padding: '30px 40px 60px', maxWidth: 880 }}>
              <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>Class setup</div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 28, margin: '6px 0 4px', color: '#0e2a43' }}>Set up a class</h1>
              <p style={{ margin: '0 0 24px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 620, textWrap: 'pretty' }}>
                A few minutes, once. Name the class, bring in the roster, and choose the topics you want this class to master this year, that basket is what builds each student's focused knowledge graph.
              </p>

              {/* 1. Basics */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: '#fff', background: '#0e2a43', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>1</span>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Class basics</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'start' }}>
                  <div>
                    <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Class name</label>
                    <input
                      value={s.suClass}
                      onChange={(e) => setState({ suClass: e.target.value })}
                      style={{ width: '100%', border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '10px 12px', fontSize: 14, color: '#1a2129', outline: 'none' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Grade band</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {GRADES.map((g) => {
                        const on = s.suGrade === g
                        return (
                          <button
                            key={g}
                            onClick={() => setState({ suGrade: g })}
                            style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, background: on ? '#0e2a43' : '#f2ece0', color: on ? '#fff' : '#5c6773', border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd' }}
                          >
                            {g}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Roster */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: '#fff', background: '#0e2a43', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>2</span>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Roster</h2>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{s.suRoster.length} students</span>
                </div>
                <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#8a7c63' }}>Import from your school's MIS, or add students by hand.</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <input
                    value={s.suDraft}
                    onChange={(e) => setState({ suDraft: e.target.value })}
                    placeholder="Add a student by name"
                    style={{ flex: 1, minWidth: 180, border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '10px 12px', fontSize: 14, color: '#1a2129', outline: 'none' }}
                  />
                  <button
                    onClick={() => {
                      const d = s.suDraft.trim()
                      if (d) setState((st) => ({ suRoster: [...st.suRoster, d], suDraft: '' }))
                    }}
                    style={{ background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 8, padding: '0 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setState((st) => ({ suRoster: [...st.suRoster, 'Maya Kumar', 'Finn Walsh', 'Zara Haq', 'Noah Pratt'] }))}
                    style={{ background: '#fff', color: '#0e2a43', border: '1px solid #cdbfa6', borderRadius: 8, padding: '10px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Import from MIS / CSV
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {s.suRoster.map((name, i) => (
                    <div key={`${name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 20, padding: '5px 8px 5px 5px' }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#0e2a43', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flex: 'none' }}>
                        {name
                          .split(' ')
                          .map((w) => w[0])
                          .join('')
                          .slice(0, 2)}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#1a2129' }}>{name}</span>
                      <button
                        onClick={() => setState((st) => ({ suRoster: st.suRoster.filter((_, j) => j !== i) }))}
                        style={{ border: 'none', background: 'transparent', color: '#b1a58c', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. Basket of topics */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: '#fff', background: '#0e2a43', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>3</span>
                  <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Basket of topics for the year</h2>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#b6531f' }}>{basketCount} selected</span>
                </div>
                <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#8a7c63', maxWidth: 600, textWrap: 'pretty' }}>
                  We carry every maths topic Anadromos offers; you work with us to map which map to which year group. Pick what this class should master by year's end, Anadromos expands each choice into its prerequisite subtopics automatically, and that expanded set is the focused knowledge graph you'll use day to day.
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
                  {[{ k: 'all', l: 'All years' }, ...GRADES.map((g) => ({ k: g, l: g }))].map((o) => {
                    const on = s.suYear === o.k
                    return (
                      <button
                        key={o.k}
                        onClick={() => setState({ suYear: o.k })}
                        style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 8, background: on ? '#dd6a2f' : '#f2ece0', color: on ? '#fff' : '#5c6773', border: on ? '1px solid #dd6a2f' : '1px solid #e0d4bd' }}
                      >
                        {o.l}
                      </button>
                    )
                  })}
                  <input
                    value={s.suSearch}
                    onChange={(e) => setState({ suSearch: e.target.value })}
                    placeholder="Search topics…"
                    style={{ marginLeft: 'auto', minWidth: 180, border: '1px solid #e0d4bd', borderRadius: 8, background: '#faf6ee', padding: '9px 12px', fontSize: 13.5, color: '#1a2129', outline: 'none' }}
                  />
                </div>
                {basketGroups.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {basketGroups.map((grp) => (
                      <div key={grp.group}>
                        <div style={monoCap({ marginBottom: 8 })}>{grp.group}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {grp.topics.map(([key, label]) => {
                            const on = !!s.suBasket[key]
                            return (
                              <button
                                key={key}
                                onClick={() => setState((st) => ({ suBasket: { ...st.suBasket, [key]: !st.suBasket[key] } }))}
                                style={{ cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 500, padding: '8px 13px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 7, background: on ? '#0e2a43' : '#f2ece0', color: on ? '#fff' : '#5c6773', border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd' }}
                              >
                                <span style={{ fontSize: 12, opacity: on ? 1 : 0.6 }}>{on ? '✓' : '+'}</span>
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#8a7c63' }}>No topics match that filter. Try another year group or search term.</p>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 20 }}>
                <button style={{ background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 9, padding: '12px 22px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}>Create class</button>
                <span style={{ fontSize: 12.5, color: '#8a7c63' }}>You can change the roster and basket any time, the graph updates with them.</span>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
