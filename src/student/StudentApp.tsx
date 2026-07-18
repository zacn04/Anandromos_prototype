import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Logo } from '../components/Logo'
import { GraphSvg } from '../components/GraphSvg'
import { NodeInfoCard } from '../components/NodeInfoCard'
import { PracticeLoop } from '../components/PracticeLoop'
import { BASKETS, EDGES, NODES, ST, edgePath } from '../data/knowledgeGraph'
import { LOG_RAW } from '../data/activityLog'
import { FONT_MONO, FONT_SERIF } from '../theme'

/**
 * Student POV — a calm home of mastery-path lessons/reviews plus teacher-set
 * problem sets, the diagnostic practice loop, Free play over the whole
 * curriculum, a personal map, sessions history, and progress.
 */

type Screen =
  | 'shome'
  | 'sprogress'
  | 'ssessions'
  | 'ssessiondetail'
  | 'smap'
  | 'psolve'
  | 'freeplay'
  | 'fptopic'
  | 'practice'

interface StudentState {
  screen: Screen
  smapView: 'focused' | 'full'
  pathDone: number
  fpTopic: string | null
  fpLabel: string | null
  psIdx: number
  psAnswers: Record<number, string>
  psSubmitted: boolean
  psAttach: string | null
  selectedLog: number | null
  selectedNode: string | null
  graphFilter: string
  session: number
}

const monoCap = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  color: '#8a7c63',
  ...extra,
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

const PATH_RAW = [
  { kind: 'Lesson', subtopic: 'Inverse operations', detail: 'Moving a term across the =' },
  { kind: 'Lesson', subtopic: 'One-step equations', detail: 'Undoing + and −' },
  { kind: 'Review', subtopic: 'Negatives', detail: 'Spaced review' },
  { kind: 'Lesson', subtopic: 'Two-step equations', detail: 'Undo in the right order' },
  { kind: 'Review', subtopic: 'Fractions → %', detail: 'Spaced review' },
  { kind: 'Lesson', subtopic: 'Equations with brackets', detail: 'Expand, then solve' },
]

const PROBLEM_SETS = [
  {
    title: 'Linear equations mixed set',
    topics: 'Linear equations · Substitution',
    qs: '12 questions',
    due: 'Due Mon 21 Jul',
    urgency: 'soon',
    locked: true,
    lockNote: 'Unlocks when you finish “Inverse operations” and “Two-step equations”.',
  },
  {
    title: 'Fractions & percentages',
    topics: 'Fractions · Percentages',
    qs: '10 questions',
    due: 'Due Fri 25 Jul',
    urgency: 'later',
    locked: false,
    lockNote: '',
  },
  {
    title: 'Ratio recap',
    topics: 'Ratio & proportion',
    qs: '8 questions',
    due: 'Due today',
    urgency: 'urgent',
    locked: true,
    lockNote: 'Unlocks when you finish “Ratio basics”.',
  },
]

const PS_SET = {
  title: 'Fractions & percentages',
  topics: 'Fractions · Percentages',
  due: 'Due Fri 25 Jul',
  questions: [
    { topic: 'Fractions', q: 'Simplify 12⁄18 to its lowest terms.', hint: 'Divide top and bottom by their highest common factor.' },
    { topic: 'Fractions', q: 'Work out 2⁄3 + 1⁄6.', hint: 'Use a common denominator first.' },
    { topic: 'Percentages', q: 'Find 15% of 240.', hint: '' },
    { topic: 'Percentages', q: 'Write 0.45 as a percentage.', hint: '' },
    { topic: 'Fractions → %', q: 'Write 3⁄8 as a percentage.', hint: 'Divide, then multiply by 100.' },
    { topic: 'Percentages', q: 'A £60 coat is reduced by 20%. What is the new price?', hint: '' },
  ],
}

const FP_TOPICS = [
  {
    key: 'number',
    label: 'Number',
    subs: [
      { name: 'Negatives', unlocked: true, last: 'today · free play' },
      { name: 'Fractions', unlocked: true, last: '12 days ago' },
      { name: 'Decimals', unlocked: true, last: '15 days ago' },
      { name: 'Percentages', unlocked: false, last: '' },
    ],
  },
  {
    key: 'algebra',
    label: 'Algebra',
    subs: [
      { name: 'Algebra basics', unlocked: true, last: '8 days ago' },
      { name: 'Inverse operations', unlocked: true, last: 'today' },
      { name: 'One-step equations', unlocked: true, last: 'today' },
      { name: 'Substitution', unlocked: true, last: '2 days ago · free play' },
      { name: 'Linear equations', unlocked: false, last: '' },
      { name: 'Expanding brackets', unlocked: false, last: '' },
    ],
  },
  {
    key: 'ratio',
    label: 'Ratio & proportion',
    subs: [
      { name: 'Ratio', unlocked: true, last: '7 days ago' },
      { name: 'Proportion', unlocked: true, last: '10 days ago' },
      { name: 'Percentage change', unlocked: false, last: '' },
    ],
  },
  {
    key: 'geometry',
    label: 'Geometry & measures',
    subs: [
      { name: 'Area & perimeter', unlocked: true, last: '20 days ago' },
      { name: 'Angles', unlocked: false, last: '' },
      { name: 'Coordinates', unlocked: false, last: '' },
    ],
  },
  {
    key: 'stats',
    label: 'Statistics',
    subs: [
      { name: 'Averages', unlocked: true, last: '18 days ago' },
      { name: 'Charts & tables', unlocked: false, last: '' },
    ],
  },
  {
    key: 'probability',
    label: 'Probability',
    subs: [{ name: 'Basic probability', unlocked: false, last: '' }],
  },
]

const PROGRESS_TOPICS = [
  { name: 'Negatives', pct: 96, label: 'Mastered' },
  { name: 'Fractions & %', pct: 78, label: 'Strong' },
  { name: 'Substitution', pct: 52, label: 'Building' },
  { name: 'Linear equations', pct: 34, label: 'Learning now' },
]

const LAST_MAP: Record<string, string> = { n1: 'today · free play', n2: '12 days ago', n3: '15 days ago', n4: '7 days ago', n5: '6 days ago', n6: '2 days ago', n7: '8 days ago', n8: '4 days ago', n9: '2 days ago · free play', n10: '—', n11: 'today', n12: 'today', n13: '—', n14: '—', n15: '—' }
const NEXT_MAP: Record<string, string> = { n1: 'in 11 days', n2: 'in 14 days', n3: 'in 18 days', n4: 'in 9 days', n5: 'in 8 days', n6: 'tomorrow', n7: 'in 10 days', n8: 'in 5 days', n9: 'tomorrow', n10: 'when ready', n11: 'today', n12: 'today', n13: 'when ready', n14: 'when ready', n15: 'when ready' }
const REPS_MAP: Record<string, number> = { n1: 16, n2: 13, n3: 11, n4: 12, n5: 14, n6: 9, n7: 10, n8: 15, n9: 7, n10: 0, n11: 5, n12: 3, n13: 0, n14: 0, n15: 0 }

const NAV_ITEMS: Array<[string, Screen]> = [
  ['Home', 'shome'],
  ['Free play', 'freeplay'],
  ['Sessions', 'ssessions'],
  ['My map', 'smap'],
  ['Progress', 'sprogress'],
]

const INITIAL: StudentState = {
  screen: 'shome',
  smapView: 'focused',
  pathDone: 2,
  fpTopic: null,
  fpLabel: null,
  psIdx: 0,
  psAnswers: {},
  psSubmitted: false,
  psAttach: null,
  selectedLog: null,
  selectedNode: null,
  graphFilter: 'all',
  session: 1,
}

export default function StudentApp() {
  const [s, setS] = useState<StudentState>(INITIAL)
  const psFileRef = useRef<HTMLInputElement>(null)
  const setState = (patch: Partial<StudentState> | ((st: StudentState) => Partial<StudentState>)) =>
    setS((st) => ({ ...st, ...(typeof patch === 'function' ? patch(st) : patch) }))

  const startPractice = (extra: Partial<StudentState> = {}) =>
    setState((st) => ({ screen: 'practice', session: st.session, ...extra }))

  if (s.screen === 'practice') {
    return (
      <PracticeLoop
        variant="student"
        fpLabel={s.fpLabel}
        backLabel={s.fpLabel ? '← Free play' : '← Home'}
        title={s.fpLabel || 'Linear equations'}
        onExit={() => setState({ screen: s.fpLabel ? 'fptopic' : 'shome', fpLabel: null })}
      />
    )
  }

  // top nav — the tab that stays lit for each screen
  const cur: string =
    (
      {
        shome: 'shome',
        freeplay: 'freeplay',
        fptopic: 'freeplay',
        ssessions: 'ssessions',
        ssessiondetail: 'ssessions',
        smap: 'smap',
        sprogress: 'sprogress',
        psolve: 'shome',
      } as Record<string, string>
    )[s.screen] || 'shome'

  const topBar = (maxWidth: number): ReactNode => (
    <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '0 22px' }}>
      <div style={{ maxWidth, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, height: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Logo size={26} />
          <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 17, color: '#fff' }}>Anadromos</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {NAV_ITEMS.map(([label, scr]) => {
            const on = cur === scr
            return (
              <div
                key={scr}
                onClick={() => setState({ screen: scr })}
                style={{ fontSize: 13, fontWeight: on ? 600 : 500, color: on ? '#fff' : '#9fb4c7', background: on ? 'rgba(221,106,47,.16)' : 'transparent', padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}
              >
                {label}
              </div>
            )
          })}
        </div>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#dd6a2f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
          AB
        </div>
      </div>
    </div>
  )

  // ---- knowledge graph (My map) ----
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
  const selNode = s.selectedNode ? NODES.find((n) => n.id === s.selectedNode) : null

  // ---- problem set (homework) ----
  const psIdx = s.psIdx
  const psAns = s.psAnswers
  const psAnsweredCount = PS_SET.questions.filter((_, i) => (psAns[i] || '').trim()).length
  const psCur = PS_SET.questions[psIdx] || PS_SET.questions[0]
  const psIsLast = psIdx === PS_SET.questions.length - 1

  const mapToggleStyle = (on: boolean): CSSProperties => ({
    cursor: 'pointer',
    fontSize: 12.5,
    fontWeight: 600,
    padding: '8px 15px',
    borderRadius: 8,
    background: on ? '#0e2a43' : '#efe7d9',
    color: on ? '#fff' : '#5c6773',
    border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd',
  })

  const selectedLog = s.selectedLog != null ? LOG_RAW[s.selectedLog] : null

  return (
    <>
      {/* ============ STUDENT HOME ============ */}
      {s.screen === 'shome' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(680)}
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>Friday · week 9</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 28, margin: '6px 0 22px', color: '#0e2a43' }}>Good afternoon, Aisha</h1>

            {/* your path: lessons + reviews */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Your path</h2>
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>{s.pathDone} of 6 done</span>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: '#5c6773', maxWidth: 520, textWrap: 'pretty' }}>
              Lessons and reviews on the subtopics next on your learning path. Finish all six and a fresh set unlocks.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {PATH_RAW.map((it, i) => {
                const complete = i < s.pathDone
                const isNext = i === s.pathDone
                const isReview = it.kind === 'Review'
                return (
                  <div
                    key={i}
                    onClick={() =>
                      startPractice({
                        fpLabel: null,
                        pathDone: i === s.pathDone ? Math.min(6, s.pathDone + 1) : s.pathDone,
                      })
                    }
                    style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: `1px solid ${isNext ? '#f0d3bc' : '#e4dccb'}`, borderRadius: 11, padding: '14px 16px', cursor: 'pointer', opacity: complete ? 0.6 : 1 }}
                  >
                    <span
                      style={{ width: 26, height: 26, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: complete ? '#1f4e75' : isNext ? '#dd6a2f' : '#efe7d9', color: complete || isNext ? '#fff' : '#a99e88' }}
                    >
                      {complete ? '✓' : i + 1}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase', fontWeight: 600, padding: '2px 8px', borderRadius: 5, flex: 'none', background: isReview ? '#e4edf3' : '#fdf0e6', color: isReview ? '#1f4e75' : '#b6531f' }}>
                          {it.kind}
                        </span>
                        <span style={{ fontSize: 14.5, fontWeight: 600, color: '#1a2129' }}>{it.subtopic}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: '#8a7c63', marginTop: 2 }}>
                        {it.detail} · {isReview ? '~4 min' : '~10 min'}
                      </div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', color: complete ? '#8a7c63' : '#dd6a2f' }}>
                      {complete ? 'Done' : isNext ? 'Start →' : 'Open'}
                    </span>
                  </div>
                )
              })}
            </div>
            {s.pathDone >= 6 && (
              <div style={{ marginTop: 12, background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 11, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13.5, color: '#2b4a63', textWrap: 'pretty' }}>
                  Nice work — you've cleared this set. A fresh batch of lessons and reviews is ready.
                </div>
                <button
                  onClick={() => setState((st) => ({ pathDone: 0, session: st.session + 1 }))}
                  style={{ marginLeft: 'auto', background: '#1f4e75', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  Load the next six →
                </button>
              </div>
            )}

            {/* problem sets: teacher-set homework */}
            <div style={{ marginTop: 30 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, fontWeight: 600, margin: 0, color: '#0e2a43' }}>Problem sets</h2>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#8a7c63' }}>homework from Ms. Okafor</span>
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: '#5c6773', maxWidth: 520, textWrap: 'pretty' }}>
                Set by your teacher, on their own deadlines. Some unlock only once you've finished the lessons they build on.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {PROBLEM_SETS.map((p) => (
                  <div key={p.title} style={{ background: '#fff', border: `1px solid ${p.locked ? '#e4dccb' : '#d3e0ea'}`, borderRadius: 12, padding: '16px 18px', opacity: p.locked ? 0.92 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2129' }}>{p.title}</div>
                        <div style={{ fontSize: 12.5, color: '#8a7c63', marginTop: 3 }}>
                          {p.topics} · {p.qs}
                        </div>
                      </div>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontFamily: FONT_MONO,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '4px 10px',
                          borderRadius: 20,
                          whiteSpace: 'nowrap',
                          background: p.urgency === 'urgent' ? '#fbe7d8' : p.urgency === 'soon' ? '#fdf0e6' : '#eef3f7',
                          color: p.urgency === 'urgent' || p.urgency === 'soon' ? '#b6531f' : '#1f4e75',
                          border: `1px solid ${p.urgency === 'urgent' ? '#eecab0' : p.urgency === 'soon' ? '#f0d3bc' : '#d3e0ea'}`,
                        }}
                      >
                        🗓 {p.due}
                      </span>
                    </div>
                    {p.locked && (
                      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start', background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 9, padding: '10px 12px' }}>
                        <span style={{ fontSize: 13, flex: 'none' }}>🔒</span>
                        <div style={{ fontSize: 12.5, color: '#5c6773', lineHeight: 1.5, textWrap: 'pretty' }}>{p.lockNote}</div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (!p.locked) setState({ screen: 'psolve', psIdx: 0, psAnswers: {}, psSubmitted: false })
                      }}
                      style={{ marginTop: 12, background: p.locked ? '#f2ece0' : '#dd6a2f', color: p.locked ? '#a99e88' : '#fff', border: 'none', borderRadius: 9, padding: '11px 16px', fontSize: 13.5, fontWeight: 600, cursor: p.locked ? 'not-allowed' : 'pointer' }}
                    >
                      {p.locked ? '🔒 Locked' : 'Start homework →'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ margin: '24px 4px 0', fontSize: 11.5, lineHeight: 1.5, color: '#a99e88', textAlign: 'center', textWrap: 'pretty' }}>
              No streaks, points, or rankings. Just the next right thing to work on, and your own progress over time.
            </p>
          </div>
        </div>
      )}

      {/* ============ STUDENT PROGRESS ============ */}
      {s.screen === 'sprogress' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(680)}
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>My progress</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>How you're doing</h1>
            <p style={{ margin: '0 0 22px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 520, textWrap: 'pretty' }}>
              This is only ever about you, then and now. It's never a comparison to anyone else in your class.
            </p>

            <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px' }}>
              <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 16px', color: '#0e2a43' }}>What you've built up</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {PROGRESS_TOPICS.map((t) => (
                  <div key={t.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: '#1a2129' }}>{t.name}</span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63' }}>{t.label}</span>
                    </div>
                    <div style={{ height: 12, background: '#f0e9dc', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${t.pct}%`, height: '100%', background: t.pct >= 85 ? '#1f4e75' : t.pct >= 60 ? '#4a86ad' : '#dd6a2f', borderRadius: 6 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 16, background: '#fdf0e6', border: '1px solid #f0d3bc', borderRadius: 12, padding: '18px 20px' }}>
              <div style={monoCap({ fontSize: 10.5, letterSpacing: '.6px', color: '#b6531f' })}>Working on now</div>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 600, color: '#0e2a43', margin: '6px 0 4px' }}>Linear equations</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#8a6b4f', textWrap: 'pretty' }}>
                You're most of the way through the ideas this builds on. Keep going, it gets less hand-held as you get stronger.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ============ STUDENT SESSIONS ============ */}
      {s.screen === 'ssessions' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(680)}
          <div style={{ maxWidth: 680, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>Past sessions</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>What you've worked on</h1>
            <p style={{ margin: '0 0 20px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 520, textWrap: 'pretty' }}>
              Every lesson, problem set and review you've done. Open one to see exactly where things clicked and where they didn't.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {LOG_RAW.map((a, i) => (
                <div
                  key={i}
                  onClick={() => setState({ screen: 'ssessiondetail', selectedLog: i })}
                  style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 11, padding: '15px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: a.flag === 'attention' ? '#dd6a2f' : '#1f4e75' }} />
                  <span style={kindStyle}>{a.kind}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2129', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                    <div style={{ fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>{a.summary}</div>
                  </div>
                  <span style={{ ...logFlag(a.flag), fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{a.result}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#a99e88', whiteSpace: 'nowrap' }}>{a.date}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============ STUDENT SESSION DETAIL ============ */}
      {s.screen === 'ssessiondetail' && selectedLog && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px' }}>
            <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div onClick={() => setState({ screen: 'ssessions' })} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>
                ← Past sessions
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 13, color: '#dbe6ef', fontFamily: FONT_SERIF }}>{selectedLog.title}</span>
            </div>
          </div>
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '26px 24px 60px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={kindStyle}>{selectedLog.kind}</span>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 23, margin: 0, color: '#0e2a43' }}>{selectedLog.title}</h1>
              <span style={{ ...logFlag(selectedLog.flag), fontSize: 12, fontWeight: 600, padding: '3px 11px', borderRadius: 20, whiteSpace: 'nowrap' }}>{selectedLog.result}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63' }}>{selectedLog.date}</span>
            </div>
            <p style={{ margin: '10px 0 18px', fontSize: 13, color: '#5c6773' }}>Where it went right, and the steps worth another look.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {selectedLog.items.map((it, qi) => (
                  <div
                    key={qi}
                    style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 14, padding: '13px 14px', borderRadius: 9, background: it.hit ? '#fdf0e6' : '#faf6ee', border: `1px solid ${it.hit ? '#f0d3bc' : '#ece3d2'}` }}
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
                      </div>
                      <div style={{ fontSize: 12.5, color: '#5c6773', marginTop: 4, textWrap: 'pretty' }}>{it.note}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px' }}>
                <div style={monoCap({ fontSize: 10.5, letterSpacing: '.5px', marginBottom: 10 })}>Your handwritten working</div>
                {selectedLog.upload ? (
                  <>
                    <div style={{ border: '1px solid #e4dccb', borderRadius: 10, height: 220, background: 'repeating-linear-gradient(#fffdf8,#fffdf8 30px,#eef0f2 31px)', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 14, left: 16, fontFamily: FONT_SERIF, fontSize: 17, color: '#33404b', transform: 'rotate(-1.5deg)' }}>3x − 7 = 11</div>
                      <div style={{ position: 'absolute', top: 44, left: 22, fontFamily: FONT_SERIF, fontSize: 17, color: '#33404b', transform: 'rotate(-1deg)' }}>3x = 11 − 7  ✗</div>
                      <div style={{ position: 'absolute', bottom: 0, width: '100%', padding: 7, background: 'rgba(14,42,67,.82)', color: '#dbe6ef', fontSize: 11, textAlign: 'center', fontFamily: FONT_MONO }}>
                        you uploaded this
                      </div>
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.5, color: '#8a7c63', textWrap: 'pretty' }}>
                      Only your teacher sees this. It isn't read by the AI.
                    </p>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#8a7c63' }}>You didn't upload handwriting for this one.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ STUDENT MAP ============ */}
      {s.screen === 'smap' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(840)}
          <div style={{ maxWidth: 840, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>My map</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 12px', color: '#0e2a43' }}>What you know, and what's next</h1>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setState({ smapView: 'focused' })} style={mapToggleStyle(s.smapView !== 'full')}>
                This year's topics
              </button>
              <button onClick={() => setState({ smapView: 'full' })} style={mapToggleStyle(s.smapView === 'full')}>
                All of maths
              </button>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: '#8a7c63', marginBottom: 6 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#1f4e75', display: 'inline-block' }} />
                Mastered
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#7fb0cd', display: 'inline-block' }} />
                Getting there
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#fdf0e6', border: '2px solid #dd6a2f', display: 'inline-block' }} />
                Working on now
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#efe7d9', border: '1px solid #d8cbb2', display: 'inline-block' }} />
                Not yet
              </span>
            </div>

            {s.smapView !== 'full' ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '10px 0 4px' }}>
                  <span style={monoCap({ fontSize: 10.5, letterSpacing: '.6px', marginRight: 2 })}>Filter</span>
                  {[{ key: 'all', label: 'All basket topics' }, ...BASKETS.map((b) => ({ key: b.key, label: b.label }))].map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setState({ graphFilter: c.key })}
                      style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 8, background: gf === c.key ? '#0e2a43' : '#efe7d9', color: gf === c.key ? '#fff' : '#5c6773' }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#8a7c63', margin: '6px 0 8px' }}>
                  Tap a topic to see when you last worked on it. Free play sessions count towards recency.
                </div>
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
                  <GraphSvg edges={focusedEdges} nodes={focusedNodes} width="100%" style={{ minWidth: 760 }} />
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#8a7c63', margin: '10px 0 8px' }}>
                  The whole curriculum, across all years. Tap a topic to see when you last worked on it.
                </div>
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: 16, overflow: 'auto', maxHeight: '66vh' }}>
                  <GraphSvg edges={graphEdges} nodes={graphNodes} width={1120} />
                </div>
              </>
            )}

            {selNode && (
              <NodeInfoCard
                heading="Topic"
                title={selNode.label}
                fields={[
                  { label: 'Last worked', value: LAST_MAP[selNode.id] || '—' },
                  { label: 'Next review', value: NEXT_MAP[selNode.id] || '—' },
                  { label: 'Times practised', value: REPS_MAP[selNode.id] || 0 },
                ]}
                onClose={() => setState({ selectedNode: null })}
              />
            )}
          </div>
        </div>
      )}

      {/* ============ STUDENT PROBLEM SET (homework) ============ */}
      {s.screen === 'psolve' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div onClick={() => setState({ screen: 'shome', psSubmitted: false })} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>
                ← Today
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 13, color: '#dbe6ef', fontFamily: FONT_SERIF }}>{PS_SET.title}</span>
            </div>
          </div>

          {s.psSubmitted ? (
            <div style={{ maxWidth: 560, margin: '0 auto', padding: '60px 24px' }}>
              <div style={{ background: '#fff', border: '1px solid #d3e0ea', borderRadius: 16, padding: '34px 30px', textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#e4edf3', color: '#1f4e75', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 16px' }}>✓</div>
                <h1 style={{ fontFamily: FONT_SERIF, fontSize: 24, fontWeight: 600, color: '#0e2a43', margin: '0 0 6px' }}>Homework submitted</h1>
                <p style={{ margin: '0 0 4px', fontSize: 14, color: '#5c6773', textWrap: 'pretty' }}>
                  Sent to Ms. Okafor · {psAnsweredCount} of {PS_SET.questions.length} answered
                </p>
                <p style={{ margin: '0 0 22px', fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>
                  You'll see it marked in Sessions once your teacher has reviewed it.
                </p>
                <button
                  onClick={() => setState({ screen: 'shome', psSubmitted: false })}
                  style={{ background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 26px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  Back to Today
                </button>
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: '0 auto', padding: '26px 24px 60px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={monoCap()}>Problem set · homework</div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, color: '#b6531f', background: '#fdf0e6', border: '1px solid #f0d3bc', padding: '4px 10px', borderRadius: 20 }}>
                  🗓 {PS_SET.due}
                </span>
              </div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 25, margin: '0 0 4px', color: '#0e2a43' }}>{PS_SET.title}</h1>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#5c6773' }}>
                {PS_SET.topics} · {psAnsweredCount} of {PS_SET.questions.length} answered
              </p>

              {/* question navigator: answered = blue, current = navy, unanswered = sand */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                {PS_SET.questions.map((_, i) => {
                  const answered = (psAns[i] || '').trim()
                  const on = i === psIdx
                  return (
                    <button
                      key={i}
                      onClick={() => setState({ psIdx: i })}
                      style={{ width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: on ? '#0e2a43' : answered ? '#dbe6ef' : '#efe7d9', color: on ? '#fff' : answered ? '#1f4e75' : '#a99e88' }}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>

              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '24px 26px', boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '.6px', textTransform: 'uppercase', color: '#1f4e75', background: '#e4edf3', border: '1px solid #cddceb', padding: '2px 9px', borderRadius: 20 }}>
                    {psCur.topic}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 12, color: '#a99e88' }}>
                    Q{psIdx + 1} / {PS_SET.questions.length}
                  </span>
                </div>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 600, color: '#0e2a43', lineHeight: 1.4, textWrap: 'pretty' }}>{psCur.q}</div>
                {!!psCur.hint && <div style={{ marginTop: 8, fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>Hint: {psCur.hint}</div>}

                <div style={{ marginTop: 18, fontSize: 12.5, color: '#8a7c63', marginBottom: 8 }}>
                  Type your final answer. Use the palette for notation a keyboard can't produce.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: '#f6f1e7', border: '1px solid #e4dccb', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  {(
                    [
                      ['x²', '²'],
                      ['xⁿ', '^'],
                      ['√', '√'],
                      ['a⁄b', '⁄'],
                      ['( )', '()'],
                      ['π', 'π'],
                      ['×', '×'],
                      ['÷', '÷'],
                      ['%', '%'],
                    ] as const
                  ).map(([label, ins]) => (
                    <button
                      key={label}
                      onClick={() => setState((st) => ({ psAnswers: { ...st.psAnswers, [psIdx]: (st.psAnswers[psIdx] || '') + ins } }))}
                      style={{ minWidth: 38, height: 36, background: '#fff', border: '1px solid #ddd2bd', borderRadius: 8, fontFamily: FONT_SERIF, fontSize: 15, color: '#1a2129', cursor: 'pointer' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  value={psAns[psIdx] || ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setState((st) => ({ psAnswers: { ...st.psAnswers, [psIdx]: v } }))
                  }}
                  placeholder="Your answer…"
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8cbb2', borderRadius: 10, padding: '14px 15px', fontSize: 18, fontFamily: FONT_SERIF, color: '#1a2129', background: '#fff' }}
                />

                <div style={{ marginTop: 16, border: '1px dashed #cdbfa6', borderRadius: 11, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0e2a43' }}>Handwritten working</span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: '#5c6773', background: '#eef0f2', border: '1px solid #dfe3e7', padding: '2px 9px', borderRadius: 20 }}>Optional</span>
                  </div>
                  {s.psAttach ? (
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, background: '#f6f1e7', border: '1px solid #e4dccb', borderRadius: 8, padding: '8px 12px' }}>
                      <span style={{ fontSize: 13 }}>📎</span>
                      <span style={{ fontSize: 13, color: '#1a2129', flex: 1 }}>{s.psAttach}</span>
                      <button onClick={() => setState({ psAttach: null })} style={{ border: 'none', background: 'transparent', color: '#8a7c63', fontSize: 12, cursor: 'pointer' }}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => psFileRef.current?.click()}
                      style={{ marginTop: 10, background: '#fff', border: '1px solid #cdbfa6', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, color: '#0e2a43', cursor: 'pointer' }}
                    >
                      📎 Add a photo or PDF
                    </button>
                  )}
                  <input
                    ref={psFileRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0]
                      if (f) setState({ psAttach: f.name })
                    }}
                    style={{ display: 'none' }}
                  />
                  <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.5, color: '#8a7c63', textWrap: 'pretty' }}>
                    Optional across the whole set — attach a photo of your written working so your teacher can see your method.
                  </p>
                </div>
              </div>

              <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  onClick={() => setState((st) => ({ psIdx: Math.max(0, st.psIdx - 1) }))}
                  disabled={psIdx === 0}
                  style={{ background: '#fff', color: '#0e2a43', border: '1px solid #cdbfa6', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  ← Previous
                </button>
                {psIsLast ? (
                  <button
                    onClick={() => setState({ psSubmitted: true })}
                    style={{ marginLeft: 'auto', background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 28px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Submit homework →
                  </button>
                ) : (
                  <button
                    onClick={() => setState((st) => ({ psIdx: Math.min(PS_SET.questions.length - 1, st.psIdx + 1) }))}
                    style={{ marginLeft: 'auto', background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 28px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Next question →
                  </button>
                )}
              </div>
              <p style={{ margin: '16px 4px 0', fontSize: 11.5, lineHeight: 1.5, color: '#a99e88', textAlign: 'center', textWrap: 'pretty' }}>
                Homework is submitted to your teacher as a whole set — you can move between questions freely before submitting.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ============ FREE PLAY: complete knowledge graph ============ */}
      {s.screen === 'freeplay' && (
        <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
          {topBar(840)}
          <div style={{ maxWidth: 840, margin: '0 auto', padding: '30px 24px 60px' }}>
            <div style={monoCap()}>Free play</div>
            <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>Practise anything you like</h1>
            <p style={{ margin: '0 0 20px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 560, textWrap: 'pretty' }}>
              The complete map of maths. Pick a topic to see its subtopics — you can free-play any subtopic whose lesson you've already done. Free play counts towards how recently you've studied a subtopic.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
              {FP_TOPICS.map((t) => {
                const unlocked = t.subs.filter((su) => su.unlocked).length
                return (
                  <div
                    key={t.key}
                    onClick={() => setState({ screen: 'fptopic', fpTopic: t.key, selectedNode: null })}
                    style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px', cursor: 'pointer' }}
                  >
                    <div style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 600, color: '#0e2a43' }}>{t.label}</div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#8a7c63', margin: '8px 0 8px' }}>
                      {unlocked} of {t.subs.length} unlocked
                    </div>
                    <div style={{ height: 6, background: '#efe7d9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${(unlocked / t.subs.length) * 100}%`, height: '100%', background: '#1f4e75', borderRadius: 4 }} />
                    </div>
                    <div style={{ marginTop: 12, fontSize: 12.5, color: '#dd6a2f', fontWeight: 600 }}>Open topic →</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ============ FREE PLAY: subtopics for a topic ============ */}
      {s.screen === 'fptopic' &&
        (() => {
          const curT = FP_TOPICS.find((t) => t.key === s.fpTopic) || FP_TOPICS[0]
          return (
            <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
              <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px' }}>
                <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div onClick={() => setState({ screen: 'freeplay', fpTopic: null })} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>
                    ← All topics
                  </div>
                  <span style={{ marginLeft: 'auto', fontSize: 13, color: '#dbe6ef', fontFamily: FONT_SERIF }}>Free play</span>
                </div>
              </div>
              <div style={{ maxWidth: 720, margin: '0 auto', padding: '26px 24px 60px' }}>
                <div style={monoCap()}>Free play · subtopics</div>
                <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 25, margin: '6px 0 4px', color: '#0e2a43' }}>{curT.label}</h1>
                <p style={{ margin: '0 0 18px', fontSize: 13, lineHeight: 1.5, color: '#5c6773', maxWidth: 520, textWrap: 'pretty' }}>
                  Each subtopic has unlimited practice problems. Locked subtopics open once you've done their lesson on Home — free play never gives you a lesson you haven't reached yet.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {curT.subs.map((su) => (
                    <div
                      key={su.name}
                      style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: `1px solid ${su.unlocked ? '#d3e0ea' : '#e4dccb'}`, borderRadius: 11, padding: '15px 17px', opacity: su.unlocked ? 1 : 0.85 }}
                    >
                      <span style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: su.unlocked ? '#1f4e75' : '#cdbfa6' }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 600, color: '#1a2129' }}>{su.name}</div>
                        {su.unlocked ? (
                          <div style={{ fontSize: 12, color: '#8a7c63', marginTop: 2 }}>Last studied: {su.last}</div>
                        ) : (
                          <div style={{ fontSize: 12, color: '#a99e88', marginTop: 2 }}>Lesson not done yet</div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (su.unlocked) startPractice({ fpLabel: su.name })
                        }}
                        style={{ marginLeft: 'auto', border: 'none', borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: su.unlocked ? 'pointer' : 'not-allowed', background: su.unlocked ? '#dd6a2f' : '#f2ece0', color: su.unlocked ? '#fff' : '#a99e88' }}
                      >
                        {su.unlocked ? 'Free play →' : '🔒 Do the lesson first'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}
    </>
  )
}
