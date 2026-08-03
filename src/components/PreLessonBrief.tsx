/**
 * The pre-lesson brief (build-plan §5.3).
 *
 * One calm screen before a lesson starts, answering three questions: what am I
 * about to learn, what does it build on, and how long will this take.
 *
 * The prerequisite checklist is the point. It is the one moment where the
 * knowledge graph is directly useful to the *student* rather than the teacher:
 * it sets expectations, and it gives a shaky prerequisite somewhere to be seen
 * before it causes a failure mid-lesson. A student who can see that "Expanding
 * brackets" is the thing they never quite got has a name for their difficulty.
 *
 * Deliberately undramatic, per the design brief's interaction principles. A
 * prerequisite that needs work is stated plainly and is never a blocker - the
 * student can always start the lesson anyway.
 */
import type { CSSProperties } from 'react'
import { color, FONT_MONO, FONT_SERIF, monoLabel, serifHeading } from '../theme'
import { prereqsOf, topicLabel } from '../content'
import type { Lesson, NodeStatus, TopicId } from '../content'

/** Roughly how long one prerequisite takes to teach and check. */
const MINUTES_PER_PREREQUISITE = 4

export interface PreLessonBriefProps {
  lesson: Lesson
  /** This student's status for any topic, for the prerequisite checklist. */
  statusOf: (topicId: TopicId) => NodeStatus
  /**
   * When the student last worked this topic, e.g. '12 days ago'. Omit (or pass
   * '—') for a topic they have never touched, which reads as "this is new"
   * rather than as a gap.
   */
  lastWorked?: string
  onStart: () => void
  onExit: () => void
  backLabel: string
}

interface PrereqRow {
  topicId: TopicId
  label: string
  status: NodeStatus
  ready: boolean
}

/** Plain-language gloss for a prerequisite's status. Never a score, never a percentage. */
function statusNote(status: NodeStatus): string {
  switch (status) {
    case 'mastered':
      return 'ready'
    case 'inprogress':
      return 'still building'
    case 'frontier':
      return 'just started'
    default:
      return 'not covered yet'
  }
}

export function PreLessonBrief({
  lesson,
  statusOf,
  lastWorked,
  onStart,
  onExit,
  backLabel,
}: PreLessonBriefProps) {
  const rows: PrereqRow[] = prereqsOf(lesson.topicId).map((topicId) => {
    const status = statusOf(topicId)
    return { topicId, label: topicLabel(topicId), status, ready: status === 'mastered' }
  })

  const shaky = rows.filter((r) => !r.ready)
  const minutes = Math.max(3, lesson.prerequisites.length * MINUTES_PER_PREREQUISITE)
  const isNew = !lastWorked || lastWorked === '—'

  return (
    <div style={wrap}>
      <button type="button" onClick={onExit} style={backBtn}>
        ← {backLabel}
      </button>

      <div style={card}>
        <div style={monoLabel(11, color.muted)}>Next</div>
        <h1 style={serifHeading(30, { margin: '6px 0 0', color: color.ink })}>
          {lesson.topicLabel}
        </h1>

        <div style={divider} />

        <div style={monoLabel(11, color.muted)}>You'll need</div>
        {rows.length === 0 ? (
          <p style={bodyText}>
            Nothing in particular — this is a starting point in the map.
          </p>
        ) : (
          <ul style={list}>
            {rows.map((r) => (
              <li key={r.topicId} style={listItem}>
                <span aria-hidden="true" style={r.ready ? tickReady : tickShaky}>
                  {r.ready ? '✓' : '·'}
                </span>
                <span style={{ color: color.ink }}>{r.label}</span>
                <span style={r.ready ? noteReady : noteShaky}>{statusNote(r.status)}</span>
              </li>
            ))}
          </ul>
        )}

        {shaky.length > 0 && (
          <p style={headsUp}>
            {shaky.length === 1
              ? `${shaky[0].label} isn't solid yet. You can still start — it's worth knowing that's the part to watch.`
              : `A few of these aren't solid yet. You can still start — they're the parts to watch.`}
          </p>
        )}

        <div style={divider} />

        <dl style={factGrid}>
          <dt style={factKey}>Last worked</dt>
          <dd style={factValue}>{isNew ? 'never — this is new' : lastWorked}</dd>
          <dt style={factKey}>About</dt>
          <dd style={factValue}>{minutes} minutes</dd>
        </dl>

        <button type="button" onClick={onStart} style={startBtn}>
          Start the lesson
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------

const wrap: CSSProperties = {
  maxWidth: 620,
  margin: '0 auto',
  padding: '28px 20px 48px',
}

const backBtn: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 12,
  letterSpacing: '.4px',
  color: color.body,
  background: 'none',
  border: 'none',
  padding: '4px 0',
  cursor: 'pointer',
  marginBottom: 14,
}

const card: CSSProperties = {
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: 10,
  padding: '26px 28px 28px',
}

const divider: CSSProperties = {
  height: 1,
  background: color.border2,
  margin: '22px 0 18px',
}

const bodyText: CSSProperties = {
  fontFamily: FONT_SERIF,
  fontSize: 15,
  lineHeight: 1.55,
  color: color.body,
  margin: '10px 0 0',
}

const list: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '12px 0 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
}

const listItem: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  fontFamily: FONT_SERIF,
  fontSize: 15.5,
}

const tickReady: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 13,
  color: color.navy2,
  width: 14,
  flexShrink: 0,
}

const tickShaky: CSSProperties = { ...tickReady, color: color.faint }

const noteReady: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '.4px',
  color: color.muted,
  marginLeft: 'auto',
}

// Orange is scarce and reserved for what needs attention - a prerequisite that
// isn't solid is exactly that, and is the only orange on this screen besides
// the primary action.
const noteShaky: CSSProperties = { ...noteReady, color: color.orangeDeep }

const headsUp: CSSProperties = {
  fontFamily: FONT_SERIF,
  fontSize: 14.5,
  lineHeight: 1.55,
  color: color.orangeDeep,
  background: color.orangeSoft,
  border: `1px solid ${color.orangeBorder}`,
  borderRadius: 7,
  padding: '11px 13px',
  margin: '16px 0 0',
}

const factGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: 16,
  rowGap: 7,
  margin: 0,
}

const factKey: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  color: color.muted,
}

const factValue: CSSProperties = {
  fontFamily: FONT_SERIF,
  fontSize: 15,
  color: color.ink,
  margin: 0,
}

const startBtn: CSSProperties = {
  marginTop: 24,
  width: '100%',
  fontFamily: FONT_MONO,
  fontSize: 13,
  letterSpacing: '.6px',
  color: '#fff',
  background: color.orange,
  border: `1px solid ${color.orangeDeep}`,
  borderRadius: 7,
  padding: '13px 18px',
  cursor: 'pointer',
}
