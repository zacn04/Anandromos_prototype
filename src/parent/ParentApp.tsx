import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { GraphSvg } from '../components/GraphSvg'
import { NodeInfoCard } from '../components/NodeInfoCard'
import {
  activityLogFor,
  edgePairs,
  edgePath,
  graphTopics,
  sampleNodeStats,
  sampleNodeStatus,
  topicLabel,
} from '../content'
import type { LogActivity, NodeStatus, TopicId } from '../content'
import { buildQueue, dueLabel } from '../data/schedule'
import { getLiveSessions } from '../data/liveSessions'
import { useStudentName } from '../data/profile'
import { getProblemSets } from '../data/teacherProblemSets'
import { refreshFor, useEngine } from '../data/students'
import type { EngineState } from '../data/students'
import { masteryAverage } from '../data/engine'
import { masteryBand } from '../data/xp'
import { FONT_MONO, FONT_SERIF, NODE_STYLE } from '../theme'

/**
 * Parent POV — read-only: child progress, previous sessions (what they
 * struggled with and why, never the mark), what's coming up, and their map.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ THE ONE INVIOLABLE RULE                                              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Never a mark, never a score, never a percentage, never a comparison to
 * another child. Everything on this route is derived from the same live engine
 * state the student and teacher POVs read, but the *numbers* stop at this
 * boundary: `LogActivity.result` ("2 of 5 correct"), `LogActivity.detail`
 * ("3 of 5 items failed on the same step") and the raw mastery fractions are
 * deliberately never rendered here. A mastery bar is fine — it is about this
 * child's own progress over time — but its percentage is never printed, and
 * `mentionsAMark` below is a belt-and-braces guard on the one authored string
 * this screen does pass through.
 */

/** ParentApp is always Aisha's parent's app — there's no "pick a child" concept here. */
const STUDENT_ID = 'aisha'

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
  background: k === 'Review' ? '#e4edf3' : k === 'Problem set' ? '#f0e6d4' : k === 'Free play' ? '#e9f0e9' : '#fdf0e6',
  color: k === 'Review' ? '#1f4e75' : k === 'Problem set' ? '#8a6d3f' : k === 'Free play' ? '#3d6b4a' : '#b6531f',
})

// ---------------------------------------------------------------------------
// derivations — engine state → parent-facing wording
// ---------------------------------------------------------------------------

interface ParentMasteryRow {
  topicId: TopicId
  name: string
  /** Bar width only. NEVER printed — see the file header. */
  pct: number
  label: string
  c: string
}

/**
 * The same average `engine.ts` promotes on — including its restriction to the
 * tiers the topic actually offers, so the bar a parent reads and the bar the
 * engine gates on can never drift apart. Feeds the bar's width, nothing else.
 */
function tierAverage(topicId: TopicId, mastery: EngineState['masteryByTopic'][string] | undefined): number {
  if (!mastery) return 0
  return masteryAverage(topicId, mastery)
}

/**
 * Parent-facing wording for one topic, from the engine's own two thresholds and
 * nothing else.
 *
 * `masteryBand` (data/xp.ts) gives three bands — relearn / building / mastered —
 * off `RELESSON_THRESHOLD` and `MASTERY_PROMOTE_THRESHOLD`. Those are the only
 * two bars that exist. The parent vocabulary has four words, so the fourth
 * ('Strong') is taken from the one genuinely distinct case the engine can
 * report: the numbers clear the mastery bar but the node has not been promoted
 * to 'mastered' yet (cross-topic credit raises mastery without promoting).
 * Inventing a third numeric threshold to manufacture a 'Strong' band would be
 * making up curriculum judgement the data does not support, so we don't.
 *
 * 'Learning now' is anchored on the node status the map already uses for it —
 * frontier is literally "the topic they are on now" — plus anything that has
 * decayed below the re-lesson bar, which is what the engine routes back to a
 * lesson.
 */
function parentBand(state: EngineState, topicId: TopicId): { label: string; c: string } {
  const band = masteryBand(topicId, state.masteryByTopic[topicId])
  const status = state.nodes[topicId]?.status
  if (status === 'frontier' || band === 'relearn') return { label: 'Learning now', c: '#dd6a2f' }
  if (band === 'mastered') {
    return status === 'mastered'
      ? { label: 'Mastered', c: '#1f4e75' }
      : { label: 'Strong', c: '#1f4e75' }
  }
  return { label: 'Building', c: '#3f82ab' }
}

interface ParentSession {
  kind: string
  title: string
  date: string
  parentSummary: string
  tag: string
  flag: 'attention' | 'ok'
  struggles: Array<{ what: string; why: string }>
}

/**
 * A last line of defence for the inviolable rule. Session summaries are
 * authored for the teacher and mostly read fine to a parent, but one sample
 * summary in the store ("Answered ... on 4 of 6 diagnostic prompts") and any
 * future one could carry a tally. If a summary reads like a mark, we show a
 * short honest derived sentence instead of passing it through.
 *
 * Deliberately applied to the summary ONLY. The per-question `why` strings are
 * worked mathematics ("3 ÷ 8 = 0.375 = 37.5%") and would trip any such test —
 * that is the maths, not a mark, and it is exactly what a parent needs in order
 * to help.
 */
const mentionsAMark = (text: string): boolean =>
  /\d+\s*(?:of|out of|\/)\s*\d+|\d+\s*%|\b(?:scored?|marks?|grade[ds]?|percentage points)\b/i.test(text)

/**
 * One activity-log entry as a parent sees it: what they found tricky and why.
 *
 * `LogQuestion.hit` is "a hiccup happened here" (the same reading TeacherApp and
 * StudentApp render it with), so the struggle list is the hit items — no count,
 * no total, no ratio. `result` and `detail` are dropped entirely: both carry
 * tallies by construction.
 */
function toParentSession(a: LogActivity): ParentSession {
  const struggles = a.items
    .filter((q) => q.hit)
    .map((q) => ({
      what: q.q,
      why: q.why && q.why.length > 0 ? q.why.join(' ') : q.note,
    }))
  const derivedSummary = a.flag === 'attention' ? 'Parts of this one were tricky.' : 'This one went smoothly.'
  return {
    kind: a.kind,
    title: a.title,
    date: a.date,
    parentSummary: a.summary && !mentionsAMark(a.summary) ? a.summary : derivedSummary,
    tag: a.flag === 'attention' ? 'Found tricky' : 'Went well',
    flag: a.flag,
    struggles,
  }
}

/**
 * Teacher-set due dates are free text (`data/teacherProblemSets.ts` does no
 * date parsing), so "is this urgent?" can only be a read of the words the
 * teacher typed. Anything that isn't plainly today or tomorrow gets the calm
 * treatment rather than a guessed-at deadline.
 */
const dueIsUrgent = (due: string): boolean => /\b(today|tomorrow)\b/i.test(due)

/** How many "coming up" rows the overview card shows before the quiet overflow line. */
const COMING_UP_SHOWN = 4

const NODE_META: Record<string, { ret: string; retColor: string }> = {
  mastered: { ret: 'Mastered', retColor: '#1f4e75' },
  inprogress: { ret: 'Building', retColor: '#3f82ab' },
  frontier: { ret: 'Learning now', retColor: '#b6531f' },
  notready: { ret: 'Not started yet', retColor: '#8a7c63' },
  locked: { ret: 'Not started yet', retColor: '#8a7c63' },
}

export default function ParentApp() {
  const [s, setS] = useState<ParentState>({ screen: 'overview', selectedNode: null, openSession: null })

  // Live engine state for this child, shared with every other POV
  // (data/students.ts). `refreshFor` on mount is that module's documented
  // escape hatch for the transitional period while StudentApp still keeps its
  // own useState copy write-through'd to the same `engine.aisha` key — without
  // it, a parent opening this route after a practice session would be served
  // whatever the store happened to read first. Idempotent, so it cannot loop.
  // The name the child set for themselves in their own view (data/profile.ts),
  // so this header follows a rename rather than staying on the seeded demo name.
  const childName = useStudentName(STUDENT_ID)
  const childFirstName = childName.split(' ')[0]
  const childInitials = childName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const engine = useEngine(STUDENT_ID)
  useEffect(() => {
    refreshFor(STUDENT_ID)
  }, [])

  const go = (screen: Screen) => () => setS((st) => ({ ...st, screen, selectedNode: null }))

  const navRaw: Array<[string, Screen]> = [
    ['Overview', 'overview'],
    ['Sessions', 'psessions'],
    ['Map', 'pmap'],
  ]

  /**
   * "Where they're growing" — every topic the engine holds mastery for, in the
   * order the engine holds them (authored profile order, then anything they have
   * since worked on). Deliberately not re-sorted by strength: a list that
   * reshuffles itself every time they answer a question is harder to read, and
   * ranking topics against each other is a step towards the league-table
   * framing this product refuses.
   */
  const masteryRows: ParentMasteryRow[] = useMemo(
    () =>
      Object.keys(engine.masteryByTopic).map((topicId) => ({
        topicId,
        name: topicLabel(topicId),
        pct: Math.round(tierAverage(topicId, engine.masteryByTopic[topicId]) * 100),
        ...parentBand(engine, topicId),
      })),
    [engine],
  )

  /**
   * What's next, straight from the scheduler — overdue reviews first, then
   * reviews due today, then frontier lessons. Problem sets are excluded because
   * they have their own card below; queueing them here would list the same
   * homework twice.
   */
  const queue = useMemo(() => buildQueue(engine), [engine])
  const pathItems = useMemo(() => queue.items.filter((it) => it.kind !== 'problemSet'), [queue])
  const comingUp = pathItems.slice(0, COMING_UP_SHOWN)
  // Quiet, never styled as a backlog — see data/schedule.ts on why an unpayable
  // pile of red is the failure mode this product exists to avoid.
  const comingUpOverflow = pathItems.length - comingUp.length + queue.deferred

  /**
   * Real teacher-set problem sets. Empty until Ms. Okafor creates one in the
   * teacher POV, and the card says so rather than showing invented homework.
   * Read per render: `data/teacherProblemSets.ts` is a module singleton with no
   * subscription, so a set created while this route is already open appears the
   * next time the parent navigates back to it.
   */
  const homework = getProblemSets()

  /**
   * Live sessions they have actually completed this tab, ahead of the sample
   * history — the same merge StudentApp and TeacherApp do for the same student.
   */
  const sessions = [...getLiveSessions(), ...activityLogFor(STUDENT_ID)].map(toParentSession)

  const statusOf = (topicId: TopicId): NodeStatus =>
    engine.nodes[topicId]?.status ?? sampleNodeStatus(STUDENT_ID, topicId)

  const statsOf = (topicId: TopicId): { last: string; next: string } => {
    const node = engine.nodes[topicId]
    if (node) return { last: node.last, next: node.next }
    return sampleNodeStats(STUDENT_ID, topicId)
  }

  const selNode = s.selectedNode ? graphTopics().find((n) => n.id === s.selectedNode) : null

  const mapNodes = graphTopics().map((n) => {
    const st = NODE_STYLE[statusOf(n.id)]
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
  const mapEdges = edgePairs().map(([a, b]) => ({ d: edgePath(a, b), stroke: '#d8cbb2', sw: 1.5 }))

  return (
    <div style={{ minHeight: '100vh', background: '#f6f1e7' }}>
      {/* top bar (shared) */}
      <div style={{ background: '#0e2a43', color: '#dbe6ef', padding: '0 22px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, height: 56 }}>
          <Link
            to="/"
            style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}
          >
            <Logo size={26} />
            <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 17, color: '#fff' }}>Anadromos</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase', color: '#9fb4c7', background: 'rgba(255,255,255,.08)', padding: '2px 7px', borderRadius: 5, marginLeft: 2 }}>
              Parent
            </span>
          </Link>
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
              {childInitials}
            </div>
            <div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: 0, color: '#0e2a43' }}>{childName}</h1>
              <div style={{ fontSize: 13, color: '#5c6773' }}>Year 8 · class 8M2 · maths with Ms. Okafor</div>
            </div>
          </div>
          <div style={{ background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 11, padding: '13px 16px', margin: '16px 0 26px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f4e75', marginTop: 6, flex: 'none' }} />
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#2b4a63', textWrap: 'pretty' }}>
              You can see where {childFirstName} is growing, what they've found tricky and why, and what's coming up. To keep the focus on learning rather than marks, individual scores aren't shown here — those stay between {childFirstName} and their teacher.
            </div>
          </div>

          {/* mastery */}
          <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '22px 24px', marginBottom: 22 }}>
            <h2 style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, margin: '0 0 4px', color: '#0e2a43' }}>Where {childFirstName} is growing</h2>
            <p style={{ margin: '0 0 18px', fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>
              How secure each topic is, weighted by difficulty — not a test score. Longer bars mean the harder ideas are holding, too.
            </p>
            {masteryRows.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {masteryRows.map((t) => (
                  <div key={t.topicId}>
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
            ) : (
              <div style={{ fontSize: 12.5, color: '#8a7c63', textWrap: 'pretty' }}>
                {childFirstName}'s topic-by-topic picture appears here once they've worked through a few sessions.
              </div>
            )}
          </div>

          {/* coming up */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
            <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '20px 22px' }}>
              <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: '#0e2a43' }}>Lessons coming up</h2>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: '#8a7c63', textWrap: 'pretty' }}>On {childFirstName}'s learning path this week.</p>
              {comingUp.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {comingUp.map((l) => {
                    const kind = l.kind === 'review' ? 'Review' : 'Lesson'
                    return (
                      <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 10, padding: '11px 13px' }}>
                        <span style={kindStyle(kind)}>{kind}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1a2129', minWidth: 0 }}>{l.label}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 11, color: '#a99e88', whiteSpace: 'nowrap' }}>{dueLabel(l)}</span>
                      </div>
                    )
                  })}
                  {comingUpOverflow > 0 && (
                    <div style={{ fontSize: 11.5, color: '#a99e88', textWrap: 'pretty' }}>
                      {comingUpOverflow} more waiting — they'll come round in their own time.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 9, padding: '12px 14px' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f4e75', marginTop: 6, flex: 'none' }} />
                  <div style={{ fontSize: 12.5, color: '#2b4a63', lineHeight: 1.5 }}>{childFirstName} is up to date — nothing due right now.</div>
                </div>
              )}
            </div>
            <div style={{ background: '#fff', border: '1px solid #d3e0ea', borderRadius: 14, padding: '20px 22px' }}>
              <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: '#0e2a43' }}>Homework due</h2>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: '#8a7c63', textWrap: 'pretty' }}>Problem sets from Ms. Okafor.</p>
              {homework.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {homework.map((h) => {
                    const urgent = dueIsUrgent(h.due)
                    return (
                      <div key={h.id} style={{ background: '#faf6ee', border: '1px solid #ece3d2', borderRadius: 10, padding: '11px 13px' }}>
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
                              background: urgent ? '#fbe7d8' : '#eef3f7',
                              color: urgent ? '#b6531f' : '#1f4e75',
                              border: `1px solid ${urgent ? '#eecab0' : '#d3e0ea'}`,
                            }}
                          >
                            🗓 {h.due}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#8a7c63', marginTop: 3 }}>{h.topics}</div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 9, padding: '12px 14px' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f4e75', marginTop: 6, flex: 'none' }} />
                  <div style={{ fontSize: 12.5, color: '#2b4a63', lineHeight: 1.5, textWrap: 'pretty' }}>
                    Nothing set at the moment. Anything Ms. Okafor assigns will show up here.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ SESSIONS ============ */}
      {s.screen === 'psessions' && (
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '30px 24px 60px' }}>
          <div style={monoCap()}>Previous sessions</div>
          <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>What {childFirstName} has been doing</h1>
          <p style={{ margin: '0 0 22px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 560, textWrap: 'pretty' }}>
            Every lesson, problem set and review {childFirstName} has completed. Open one to see what they found tricky and why — so you can support them at home. Marks aren't shown.
          </p>
          {sessions.length === 0 && (
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 9, padding: '12px 14px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f4e75', marginTop: 6, flex: 'none' }} />
              <div style={{ fontSize: 12.5, color: '#2b4a63', lineHeight: 1.5 }}>Nothing completed yet — {childFirstName}'s first session will appear here.</div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sessions.map((a, i) => {
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
                            What {childFirstName} found tricky
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
                            Anadromos has already built the follow-up practice {childFirstName} needs into their path. You don't need to do anything — but talking it through can help.
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
          <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 26, margin: '6px 0 4px', color: '#0e2a43' }}>{childFirstName}'s map of maths</h1>
          <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 600, textWrap: 'pretty' }}>
            What {childFirstName} has mastered and what's next. Tap a topic to see how secure it is and when they last worked on it — including their own free-play practice.
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
              topicId={selNode.id}
              heading="Topic"
              title={selNode.label}
              fields={[
                { label: 'How secure', value: NODE_META[statusOf(selNode.id)].ret, color: NODE_META[statusOf(selNode.id)].retColor },
                { label: 'Last worked', value: statsOf(selNode.id).last },
                { label: 'Next review', value: statsOf(selNode.id).next },
              ]}
              onClose={() => setS((st) => ({ ...st, selectedNode: null }))}
            />
          )}
          <p style={{ margin: '14px 4px 0', fontSize: 11.5, color: '#a99e88', lineHeight: 1.5, textWrap: 'pretty' }}>
            Free play sessions count towards how recently a subtopic was studied, so this stays current with everything {childFirstName} does.
          </p>
        </div>
      )}
    </div>
  )
}
