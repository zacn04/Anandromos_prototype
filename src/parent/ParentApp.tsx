import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Logo } from '../components/Logo'
import { GraphSvg } from '../components/GraphSvg'
import { NodeInfoCard } from '../components/NodeInfoCard'
import { EDGES, NODES, ST, edgePath } from '../data/knowledgeGraph'
import { FONT_MONO, FONT_SERIF } from '../theme'

/**
 * Parent POV — read-only: child progress, previous sessions (what she
 * struggled with and why, never the mark), what's coming up, and her map.
 */

type Screen = 'overview' | 'psessions' | 'pmap'

interface ParentState {
  screen: Screen
  selectedNode: string | null
  openSession: number | null
}

const monoCap = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  color: '#8a7c63',
  ...extra,
})

const kindStyle = (k: string): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 5,
  flex: 'none',
  background: k === 'Review' ? '#e4edf3' : k === 'Problem set' ? '#f0e6d4' : '#fdf0e6',
  color: k === 'Review' ? '#1f4e75' : k === 'Problem set' ? '#8a6d3f' : '#b6531f',
})

const MASTERY = [
  { name: 'Negatives', pct: 96, label: 'Mastered', c: '#1f4e75' },
  { name: 'Fractions & percentages', pct: 78, label: 'Strong', c: '#1f4e75' },
  { name: 'Substitution', pct: 52, label: 'Building', c: '#3f82ab' },
  { name: 'Linear equations', pct: 34, label: 'Learning now', c: '#dd6a2f' },
  { name: 'Ratio & proportion', pct: 71, label: 'Strong', c: '#1f4e75' },
]

const DUE_LESSONS = [
  { kind: 'Lesson', name: 'Two-step equations' },
  { kind: 'Review', name: 'Negatives' },
  { kind: 'Lesson', name: 'Equations with brackets' },
]

const DUE_HOMEWORK = [
  { title: 'Fractions & percentages', topics: 'Fractions · Percentages', due: 'Fri 25 Jul', urgency: 'later' },
  { title: 'Ratio recap', topics: 'Ratio & proportion', due: 'today', urgency: 'urgent' },
]

interface ParentSession {
  kind: string
  title: string
  date: string
  parentSummary: string
  tag: string
  flag: 'attention' | 'ok'
  struggles: Array<{ what: string; why: string }>
}

// sessions — struggles + why only, NEVER marks
const SESSIONS: ParentSession[] = [
  {
    kind: 'Review',
    title: 'Linear equations · spaced review',
    date: 'Today',
    parentSummary: 'Found rearranging equations tricky.',
    tag: 'Found tricky',
    flag: 'attention',
    struggles: [
      {
        what: 'Moving a term across the equals sign',
        why: 'She kept the sign the same instead of flipping it (−7 should become +7). This points to inverse operations needing another look.',
      },
    ],
  },
  {
    kind: 'Problem set',
    title: 'Substitution into expressions',
    date: 'Yesterday',
    parentSummary: 'The harder two-term questions were a stretch.',
    tag: 'Found tricky',
    flag: 'attention',
    struggles: [
      {
        what: 'Substituting into two-term expressions',
        why: 'She put the same value into both terms. The single-term questions were comfortable — it is the multi-term step that needs practice.',
      },
    ],
  },
  {
    kind: 'Lesson',
    title: 'Solving two-step equations',
    date: 'Mon',
    parentSummary: 'Worked through it smoothly.',
    tag: 'Went well',
    flag: 'ok',
    struggles: [],
  },
  {
    kind: 'Problem set',
    title: 'Fractions to percentages',
    date: 'Last wk',
    parentSummary: 'One small slip, nothing to worry about.',
    tag: 'Went well',
    flag: 'ok',
    struggles: [
      {
        what: 'One conversion slip',
        why: 'A one-off — her wider record on this is strong, so no follow-up was needed.',
      },
    ],
  },
  {
    kind: 'Review',
    title: 'Negatives · spaced review',
    date: '2 wks',
    parentSummary: 'Held up well over time.',
    tag: 'Went well',
    flag: 'ok',
    struggles: [],
  },
]

const NODE_META: Record<string, { ret: string; retColor: string }> = {
  mastered: { ret: 'Mastered', retColor: '#1f4e75' },
  inprogress: { ret: 'Building', retColor: '#3f82ab' },
  frontier: { ret: 'Learning now', retColor: '#b6531f' },
  notready: { ret: 'Not started yet', retColor: '#8a7c63' },
  locked: { ret: 'Not started yet', retColor: '#8a7c63' },
}

const LAST_MAP: Record<string, string> = { n1: 'today · free play', n2: '12 days ago', n3: '15 days ago', n4: '7 days ago', n5: '6 days ago', n6: '2 days ago', n7: '8 days ago', n8: '4 days ago', n9: '2 days ago · free play', n10: '—', n11: 'today', n12: 'today', n13: '—', n14: '—', n15: '—' }
const NEXT_MAP: Record<string, string> = { n1: 'in 11 days', n2: 'in 14 days', n3: 'in 18 days', n4: 'in 9 days', n5: 'in 8 days', n6: 'tomorrow', n7: 'in 10 days', n8: 'in 5 days', n9: 'tomorrow', n10: 'when ready', n11: 'today', n12: 'today', n13: 'when ready', n14: 'when ready', n15: 'when ready' }

export default function ParentApp() {
  const [s, setS] = useState<ParentState>({ screen: 'overview', selectedNode: null, openSession: null })

  const go = (screen: Screen) => () => setS((st) => ({ ...st, screen, selectedNode: null }))

  const navRaw: Array<[string, Screen]> = [
    ['Overview', 'overview'],
    ['Sessions', 'psessions'],
    ['Map', 'pmap'],
  ]

  const selNode = s.selectedNode ? NODES.find((n) => n.id === s.selectedNode) : null

  const mapNodes = NODES.map((n) => {
    const st = ST[n.st]
    return {
      id: n.id,
      x: n.x,
      y: n.y,
      tx: n.x + 66,
      ty: n.y + 21,
      label: n.label,
      fill: st.fill,
      stroke: st.stroke,
      text: st.text,
      sw: st.sw,
      dash: st.dash,
      onClick: () => setS((st2) => ({ ...st2, selectedNode: n.id })),
    }
  })
  const mapEdges = EDGES.map(([a, b]) => ({ d: edgePath(a, b), stroke: '#d8cbb2', sw: 1.5 }))

  return (
    <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
      {/* top bar (shared) */}
      <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '0 22px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={26} />
            <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 17, color: '#fff' }}>Anadromos</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase', color: '#9fb4c7', background: 'rgba(255,255,255,.08)', padding: '2px 7px', borderRadius: 5, marginLeft: 2 }}>
              Parent
            </span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {navRaw.map(([label, scr]) => {
              const on = s.screen === scr
              return (
                <div
                  key={scr}
                  onClick={go(scr)}
                  style={{ fontSize: 13, fontWeight: on ? 600 : 500, color: on ? '#fff' : '#9fb4c7', background: on ? 'rgba(221,106,47,.16)' : 'transparent', padding: '7px 13px', borderRadius: 8, cursor: 'pointer' }}
                >
                  {label}
                </div>
              )
            })}
          </div>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1f4e75', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>
            MB
          </div>
        </div>
      </div>

      {/* ============ OVERVIEW ============ */}
      {s.screen === 'overview' && (
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '30px 24px 60px' }}>
          <div style={monoCap()}>Your child</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '8px 0 6px', flexWrap: 'wrap' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#dd6a2f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600, flex: 'none' }}>
              AB
            </div>
            <div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: 0, color: '#0e2a43' }}>Aisha Bello</h1>
              <div style={{ fontSize: 13, color: '#5c6773' }}>Year 8 · class 8M2 · maths with Ms. Okafor</div>
            </div>
          </div>
          <div style={{ background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 11, padding: '13px 16px', margin: '16px 0 26px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f4e75', marginTop: 6, flex: 'none' }} />
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#2b4a63', textWrap: 'pretty' }}>
              You can see where Aisha is growing, what she's found tricky and why, and what's coming up. To keep the focus on learning rather than marks, individual scores aren't shown here — those stay between Aisha and her teacher.
            </div>
          </div>

          {/* mastery */}
          <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '22px 24px', marginBottom: 22 }}>
            <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: '0 0 4px', color: '#0e2a43' }}>Where she's growing</h2>
            <p style={{ margin: '0 0 18px', fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>
              How secure each topic is, weighted by difficulty — not a test score. Longer bars mean the harder ideas are holding, too.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {MASTERY.map((t) => (
                <div key={t.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: '#1a2129' }}>{t.name}</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: t.c }}>{t.label}</span>
                  </div>
                  <div style={{ height: 9, background: '#efe7d9', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${t.pct}%`, height: '100%', background: t.c, borderRadius: 5 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* coming up */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
            <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '20px 22px' }}>
              <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: '#0e2a43' }}>Lessons coming up</h2>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: '#8a7c63', textWrap: 'pretty' }}>On her learning path this week.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {DUE_LESSONS.map((l) => (
                  <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 10, padding: '11px 13px' }}>
                    <span style={kindStyle(l.kind)}>{l.kind}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1a2129', minWidth: 0 }}>{l.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: '#fff', border: '1px solid #d3e0ea', borderRadius: 14, padding: '20px 22px' }}>
              <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: '#0e2a43' }}>Homework due</h2>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: '#8a7c63', textWrap: 'pretty' }}>Problem sets from Ms. Okafor.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {DUE_HOMEWORK.map((h) => (
                  <div key={h.title} style={{ background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 10, padding: '11px 13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: '#1a2129', minWidth: 0 }}>{h.title}</span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontFamily: FONT_MONO,
                          fontSize: 10.5,
                          fontWeight: 600,
                          padding: '3px 9px',
                          borderRadius: 20,
                          whiteSpace: 'nowrap',
                          background: h.urgency === 'urgent' ? '#fbe7d8' : '#eef3f7',
                          color: h.urgency === 'urgent' ? '#b6531f' : '#1f4e75',
                          border: `1px solid ${h.urgency === 'urgent' ? '#eecab0' : '#d3e0ea'}`,
                        }}
                      >
                        🗓 {h.due}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#8a7c63', marginTop: 3 }}>{h.topics}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ SESSIONS ============ */}
      {s.screen === 'psessions' && (
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '30px 24px 60px' }}>
          <div style={monoCap()}>Previous sessions</div>
          <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>What Aisha has been doing</h1>
          <p style={{ margin: '0 0 22px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 560, textWrap: 'pretty' }}>
            Every lesson, problem set and review she's completed. Open one to see what she found tricky and why — so you can support her at home. Marks aren't shown.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SESSIONS.map((a, i) => {
              const open = s.openSession === i
              return (
                <div key={i} style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '15px 18px' }}>
                  <div
                    onClick={() => setS((st) => ({ ...st, openSession: st.openSession === i ? null : i }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: a.flag === 'attention' ? '#dd6a2f' : '#1f4e75' }} />
                    <span style={kindStyle(a.kind)}>{a.kind}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2129' }}>{a.title}</div>
                      <div style={{ fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>{a.parentSummary}</div>
                    </div>
                    <span
                      style={
                        a.flag === 'attention'
                          ? { fontSize: 11, fontWeight: 600, color: '#b6531f', background: '#fbe7d8', border: '1px solid #eecab0', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }
                          : { fontSize: 11, fontWeight: 600, color: '#1f4e75', background: '#e4edf3', border: '1px solid #cddceb', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }
                      }
                    >
                      {a.tag}
                    </span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#a99e88', whiteSpace: 'nowrap' }}>{a.date}</span>
                    <span style={{ color: '#a99e88', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
                  </div>
                  {open && (
                    <div style={{ marginTop: 14, borderTop: '1px solid #f0eadd', paddingTop: 14 }}>
                      {a.struggles.length > 0 ? (
                        <>
                          <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase', color: '#b6531f', marginBottom: 10 }}>
                            What she found tricky
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {a.struggles.map((stg, j) => (
                              <div key={j} style={{ borderLeft: '3px solid #dd6a2f', padding: '2px 0 2px 12px' }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0e2a43' }}>{stg.what}</div>
                                <div style={{ fontSize: 12.5, color: '#5c6773', marginTop: 3, textWrap: 'pretty' }}>{stg.why}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ marginTop: 12, fontSize: 11.5, color: '#8a7c63', textWrap: 'pretty' }}>
                            Anadromos has already built the follow-up practice she needs into her path. You don't need to do anything — but talking it through can help.
                          </div>
                        </>
                      ) : (
                        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 9, padding: '12px 14px' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f4e75', marginTop: 6, flex: 'none' }} />
                          <div style={{ fontSize: 12.5, color: '#2b4a63', lineHeight: 1.5 }}>Nothing tricky came up here — this one went smoothly.</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ============ CHILD'S MAP ============ */}
      {s.screen === 'pmap' && (
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '30px 24px 60px' }}>
          <div style={monoCap()}>Knowledge profile</div>
          <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>Aisha's map of maths</h1>
          <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 600, textWrap: 'pretty' }}>
            What she's mastered and what's next. Tap a topic to see how secure it is and when she last worked on it — including her own free-play practice.
          </p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: '#8a7c63', marginBottom: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#1f4e75', display: 'inline-block' }} />
              Mastered
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#7fb0cd', display: 'inline-block' }} />
              Building
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#fdf0e6', border: '2px solid #dd6a2f', display: 'inline-block' }} />
              Learning now
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#efe7d9', border: '1px solid #d8cbb2', display: 'inline-block' }} />
              Not yet
            </span>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
            <GraphSvg edges={mapEdges} nodes={mapNodes} width="100%" style={{ minWidth: 760 }} />
          </div>
          {selNode && (
            <NodeInfoCard
              heading="Topic"
              title={selNode.label}
              fields={[
                { label: 'How secure', value: NODE_META[selNode.st].ret, color: NODE_META[selNode.st].retColor },
                { label: 'Last worked', value: LAST_MAP[selNode.id] || '—' },
                { label: 'Next review', value: NEXT_MAP[selNode.id] || '—' },
              ]}
              onClose={() => setS((st) => ({ ...st, selectedNode: null }))}
            />
          )}
          <p style={{ margin: '14px 4px 0', fontSize: 11.5, color: '#a99e88', lineHeight: 1.5, textWrap: 'pretty' }}>
            Free play sessions count towards how recently a subtopic was studied, so this stays current with everything Aisha does.
          </p>
        </div>
      )}
    </div>
  )
}
