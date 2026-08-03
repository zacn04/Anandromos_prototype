import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { FONT_MONO, FONT_SERIF } from '../theme'
import { buildReteach } from '../data/reteach'
import type { Question } from '../content'
import { topicLabel } from '../content'
import { TeachingCard } from './TeachingCard'
import { normalizeAnswer } from '../content/answer'
import { studentFirstName } from '../data/profile'

/**
 * The diagnostic practice loop: solve (final answer only) → correct, or
 * solution (pinpoint the wrong lines, multi-select) → reason (one pass per
 * flagged line) → re-teach (one scoped card per flagged line).
 *
 * PracticeLoop drives exactly one problem attempt and knows nothing about
 * what comes next - it reports the outcome via `onComplete` and stops. The
 * caller (Free play, the Lesson/Review session wrappers, or the teacher
 * preview) decides what problem to show next and remounts with a new `key`.
 *
 * Used by the Student POV (full loop, incl. the "Other" free-text reason)
 * and by the Teacher POV as "Preview practice view" (no "Other").
 */
export interface AttemptResult {
  problemId: string
  correct: boolean
  flaggedLines: number[] | 'all'
  reasons: Record<number, string>
  notes: Record<number, string>
  attach: string | null
}

export interface PracticeLoopProps {
  variant: 'student' | 'preview'
  problem: Question
  /** Teacher-set flag: block "Check my answer" until handwriting is attached. */
  requireHandwriting?: boolean
  /** Free-play banner label; null when not in free play. */
  fpLabel?: string | null
  backLabel: string
  title?: string
  /**
   * Who the preview is standing in for, shown in the preview strip. The strip
   * used to name Aisha unconditionally, which was wrong the moment a teacher
   * opened it from anyone else's profile.
   */
  previewSubject?: string
  /**
   * When set, every flagged line's re-teach is shown as if this reason had
   * been picked, regardless of what the student actually chooses - used by
   * the silly-mistake retry ("get it wrong again" escalates to the full
   * re-teach). The student's real self-report is still captured in the
   * AttemptResult passed to onComplete.
   */
  forceReason?: string
  /**
   * When true, the solve step renders four tappable options (the correct
   * answer plus `problem.distractors`, shuffled) instead of the free-type
   * input and notation palette, and tapping an option advances straight to
   * checking - no separate "Check my answer" press. Used for the MCQ
   * confidence-rebuild retry: the second attempt at a similar question
   * after a self-reported silly mistake. Falls back to the ordinary
   * free-typed input whenever the problem has no (or an incomplete)
   * `distractors` array, so a problem that hasn't been authored for MCQ
   * never renders a broken or partial multiple-choice.
   */
  mcq?: boolean
  onExit: () => void
  onComplete: (result: AttemptResult) => void
}

const PALETTE_DEFS: Array<[string, string, string]> = [
  ['x²', '²', 'Square'],
  ['xⁿ', '^', 'Power'],
  ['√', '√', 'Square root'],
  ['∛', '∛', 'Cube root'],
  ['a⁄b', '⁄', 'Fraction'],
  ['( )', '()', 'Brackets'],
  ['π', 'π', 'Pi'],
  ['θ', 'θ', 'Theta'],
  ['×', '×', 'Multiply'],
  ['÷', '÷', 'Divide'],
  ['≤', '≤', 'Less or equal'],
  ['≥', '≥', 'Greater or equal'],
  ['±', '±', 'Plus-minus'],
  ['[ ]', '[  ]', 'Matrix'],
]

const monoCap = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  color: '#8a7c63',
  ...extra,
})

const normalize = normalizeAnswer

/**
 * Builds the shuffled MCQ option set for the solve step: the correct answer
 * plus the problem's first three distractors, in random order. Returns null
 * whenever `mcq` wasn't requested or the problem has no (or an incomplete)
 * `distractors` array, so the caller can cleanly fall back to the ordinary
 * free-typed input rather than ever rendering a partial multiple-choice.
 */
function buildMcqOptions(mcq: boolean, problem: Question): string[] | null {
  if (!mcq || !problem.distractors || problem.distractors.length < 3) return null
  const options = [problem.correctAnswer, ...problem.distractors.slice(0, 3).map((d) => d.text)]
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return options
}

type Step = 'solve' | 'correct' | 'solution' | 'reason' | 'reteach'

interface PState {
  pStep: Step
  pLines: number[]
  pAllWrong: boolean
  pReasons: Record<number, string>
  pNotes: Record<number, string>
  pOtherOpen: boolean
  pOtherDraft: string
  pIdx: number
  answer: string
  attach: string | null
}

const FRESH: PState = {
  pStep: 'solve',
  pLines: [],
  pAllWrong: false,
  pReasons: {},
  pNotes: {},
  pOtherOpen: false,
  pOtherDraft: '',
  pIdx: 0,
  answer: '',
  attach: null,
}

export function PracticeLoop({
  variant,
  problem,
  requireHandwriting = false,
  fpLabel = null,
  backLabel,
  title,
  previewSubject,
  forceReason,
  mcq = false,
  onExit,
  onComplete,
}: PracticeLoopProps) {
  const [s, setS] = useState<PState>(FRESH)
  const [mcqOptions] = useState<string[] | null>(() => buildMcqOptions(mcq, problem))
  const fileRef = useRef<HTMLInputElement>(null)
  const setState = (patch: Partial<PState> | ((st: PState) => Partial<PState>)) =>
    setS((st) => ({ ...st, ...(typeof patch === 'function' ? patch(st) : patch) }))

  const blocked = requireHandwriting && !s.attach
  const clickable = s.pStep === 'solution'

  /** MCQ solve step: tapping an option both answers and checks in one tap - no separate "Check my answer" press. */
  const pickMcqOption = (opt: string) => {
    if (blocked) return
    const correct = normalize(opt) === normalize(problem.correctAnswer)
    setState({ answer: opt, pStep: correct ? 'correct' : 'solution' })
  }

  const curLine = s.pLines.length ? s.pLines[Math.min(s.pIdx, s.pLines.length - 1)] : 0
  const advanceReason = (st: PState, patch: Partial<PState>): Partial<PState> => {
    const last = st.pIdx >= st.pLines.length - 1
    return last
      ? { ...patch, pStep: 'reteach', pOtherOpen: false, pOtherDraft: '' }
      : { ...patch, pIdx: st.pIdx + 1, pOtherOpen: false, pOtherDraft: '' }
  }

  const reasons: Array<{ key: string; icon: string; label: string }> = [
    { key: 'slip', icon: '⌨', label: 'A typing or clicking slip' },
    { key: 'silly', icon: '🙂', label: 'A silly mistake - I actually know this' },
    { key: 'hard', icon: '⛰', label: 'The question was genuinely too hard' },
    { key: 'notlearned', icon: '🌱', label: "I haven't really learned this yet" },
    ...(variant === 'student'
      ? [{ key: 'other', icon: '✎', label: 'Something else - let me explain' }]
      : []),
  ]

  const pickReason = (key: string) => {
    if (key === 'other') {
      setState({ pOtherOpen: true })
      return
    }
    setState((st) => advanceReason(st, { pReasons: { ...st.pReasons, [curLine]: key } }))
  }
  const submitOther = () => {
    const txt = s.pOtherDraft.trim()
    if (!txt) return
    // "Other" is coded as lack of understanding for the recommendation
    // engine; the free text is kept as extra teacher context ("In your words").
    setState((st) =>
      advanceReason(st, {
        pReasons: { ...st.pReasons, [curLine]: 'notlearned' },
        pNotes: { ...st.pNotes, [curLine]: txt },
      }),
    )
  }

  const reasonPrompt = `Line ${curLine + 1}: ${problem.lines[curLine]?.text ?? ''}`
  const reasonCounter =
    s.pLines.length > 1
      ? `Line ${Math.min(s.pIdx, s.pLines.length - 1) + 1} of ${s.pLines.length} you flagged`
      : 'The line you flagged'

  const effectiveReason = (li: number) => forceReason ?? s.pReasons[li]

  interface ReteachItem {
    key: string
    isAllWrong: boolean
    line: number
    lineTex: string
    note: string
    hasNote: boolean
    scope: string
    scopeStyle: CSSProperties
    heading: string
    body: string[]
    hasExample: boolean
    exampleTitle?: string
    exampleSteps?: string[]
    route: string
    cta: string
  }

  const reteachList: ReteachItem[] = s.pAllWrong
    ? [{ key: 'all', isAllWrong: true, line: 0, lineTex: '', note: '', hasNote: false, ...buildReteach('all', undefined, problem) }]
    : (s.pLines.length ? s.pLines : [0]).map((li) => ({
        key: String(li),
        isAllWrong: false,
        line: li + 1,
        lineTex: problem.lines[li]?.text ?? '',
        note: s.pNotes[li] || '',
        hasNote: !!s.pNotes[li],
        ...buildReteach(li, effectiveReason(li), problem),
      }))
  const reteach = reteachList[reteachList.length - 1]
  const selCount = s.pLines.length
  const continueLabel = selCount > 1 ? `Continue with ${selCount} lines →` : 'Continue →'

  const toggleLine = (i: number) => {
    if (s.pStep !== 'solution') return
    setState((st) => {
      const has = st.pLines.includes(i)
      return {
        pLines: has ? st.pLines.filter((x) => x !== i) : [...st.pLines, i].sort((a, b) => a - b),
      }
    })
  }

  const finish = (correct: boolean) =>
    onComplete({
      problemId: problem.id,
      correct,
      flaggedLines: s.pAllWrong ? 'all' : s.pLines,
      reasons: s.pReasons,
      notes: s.pNotes,
      attach: s.attach,
    })

  const hwBadgeStyle: CSSProperties = requireHandwriting
    ? { fontSize: 10.5, fontWeight: 600, padding: '2px 9px', borderRadius: 20, color: '#b6531f', background: '#fbe7d8', border: '1px solid #eecab0' }
    : { fontSize: 10.5, fontWeight: 600, padding: '2px 9px', borderRadius: 20, color: '#5c6773', background: '#eef0f2', border: '1px solid #dfe3e7' }

  const workingLine = (i: number, interactive: boolean): ReactNode => {
    const tex = problem.lines[i].text
    const note = problem.lines[i].note
    if (!interactive) {
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#a99e88', width: 16, flex: 'none' }}>{i + 1}</span>
          <span style={{ fontFamily: FONT_SERIF, fontSize: 20, color: '#1a2129' }}>{tex}</span>
          {!!note && <span style={{ fontSize: 12, color: '#8a7c63' }}>{note}</span>}
        </div>
      )
    }
    const selected = s.pLines.includes(i)
    let bg = '#fff'
    let border = '1px solid #e4dccb'
    if (clickable) border = '1px solid #d8cbb2'
    if (selected) {
      bg = '#fdf0e6'
      border = '2px solid #dd6a2f'
    }
    return (
      <div
        key={i}
        className="wline"
        onClick={() => toggleLine(i)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 16px',
          borderRadius: 10,
          background: bg,
          border,
          cursor: clickable ? 'pointer' : 'default',
          transition: 'border-color .12s',
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            background: selected ? '#dd6a2f' : '#fff',
            border: selected ? '2px solid #dd6a2f' : '2px solid #cdbfa6',
          }}
        >
          {selected ? '✓' : ''}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#a99e88', width: 16, flex: 'none' }}>{i + 1}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: FONT_SERIF, fontSize: 19, color: '#1a2129' }}>{tex}</span>
          {!!note && <span style={{ fontSize: 12, color: '#8a7c63', marginLeft: 10 }}>{note}</span>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f6f1e7', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* slim top bar */}
      {variant === 'preview' ? (
        <div style={{ width: '100%', background: '#0e2a43', color: '#dbe6ef', padding: '10px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={onExit} style={{ fontSize: 12.5, color: '#9fb4c7', cursor: 'pointer' }}>{backLabel}</div>
          <span style={{ fontSize: 12, color: '#6f8aa2', marginLeft: 'auto', fontFamily: FONT_MONO }}>
            Student view · {previewSubject ?? studentFirstName('aisha')}{title ? ` · ${title}` : ''}
          </span>
        </div>
      ) : (
        <div style={{ width: '100%', background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={onExit} style={{ fontSize: 13, color: '#9fb4c7', cursor: 'pointer' }}>{backLabel}</div>
          <span style={{ fontSize: 13, color: '#dbe6ef', marginLeft: 'auto', fontFamily: FONT_SERIF }}>{title}</span>
        </div>
      )}

      {!!fpLabel && (
        <div style={{ width: '100%', background: '#e4edf3', borderBottom: '1px solid #cddceb', padding: '9px 22px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: '#1f4e75' }}>
            <span style={{ fontWeight: 700, fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.5px', textTransform: 'uppercase', background: '#1f4e75', color: '#fff', padding: '2px 8px', borderRadius: 5 }}>
              Free play
            </span>
            Unlimited practice on {fpLabel} · counts towards your recency, never graded against you.
          </div>
        </div>
      )}

      <div style={{ width: '100%', maxWidth: 680, padding: '26px 24px 60px' }}>
        {/* informational topic label (never a score / comparison) */}
        <div style={{ marginBottom: 20 }}>
          <div style={monoCap({ fontSize: 11, letterSpacing: '.8px' })}>{topicLabel(problem.topicId)}</div>
        </div>

        {/* PROBLEM CARD */}
        <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '26px 28px', boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}>
          <div style={monoCap({ fontSize: 11, letterSpacing: '.8px', marginBottom: 8 })}>{problem.prompt}</div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 30, fontWeight: 600, color: '#0e2a43', letterSpacing: '.5px' }}>{problem.statement}</div>

          {/* SOLVE step */}
          {s.pStep === 'solve' && (
            <div style={{ marginTop: 22 }}>
              {mcqOptions ? (
                <>
                  <div style={{ fontSize: 12.5, color: '#8a7c63', marginBottom: 8 }}>Pick the answer you think is right.</div>
                  {/* MCQ confidence-rebuild retry: tapping an option both answers and checks in one tap */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {mcqOptions.map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => pickMcqOption(opt)}
                        disabled={blocked}
                        style={{
                          textAlign: 'left',
                          background: '#faf6ee',
                          border: '1px solid #e4dccb',
                          borderRadius: 10,
                          padding: '14px 16px',
                          fontFamily: FONT_SERIF,
                          fontSize: 18,
                          color: blocked ? '#a99e88' : '#1a2129',
                          cursor: blocked ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {problem.answerLabel} {opt}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: '#8a7c63', marginBottom: 8 }}>
                    Type your final answer. Use the palette for notation a keyboard can't produce.
                  </div>

                  {/* notation palette */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 9, background: '#f2ece0', border: '1px solid #e4dccb', borderBottom: 'none', borderRadius: '10px 10px 0 0' }}>
                    {PALETTE_DEFS.map(([label, ins, hint]) => (
                      <button
                        key={label}
                        onClick={() => setState((st) => ({ answer: (st.answer || '') + ins }))}
                        title={hint}
                        style={{ minWidth: 36, height: 34, padding: '0 9px', background: '#fff', border: '1px solid #ddd2bd', borderRadius: 7, fontFamily: FONT_SERIF, fontSize: 16, color: '#0e2a43', cursor: 'pointer' }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* single final-answer input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #e4dccb', borderRadius: '0 0 10px 10px', padding: '2px 14px' }}>
                    {!!problem.answerLabel && (
                      <span style={{ fontFamily: FONT_SERIF, fontSize: 19, color: '#a99e88', flex: 'none' }}>{problem.answerLabel}</span>
                    )}
                    <input
                      value={s.answer}
                      onChange={(e) => setState({ answer: e.target.value })}
                      placeholder="your answer"
                      style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT_SERIF, fontSize: 22, color: '#1a2129', padding: '12px 0' }}
                    />
                  </div>
                </>
              )}

              {/* optional handwriting upload */}
              <div style={{ marginTop: 12, background: '#faf6ee', border: '1px dashed #cdbfa6', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0e2a43' }}>Handwritten working</span>
                  <span style={hwBadgeStyle}>{requireHandwriting ? 'Required for this assignment' : 'Optional'}</span>
                </div>
                {s.attach ? (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #e4dccb', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ fontSize: 16 }}>📄</span>
                    <span style={{ fontSize: 13, color: '#1a2129', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.attach}</span>
                    <button onClick={() => setState({ attach: null })} style={{ border: 'none', background: 'transparent', color: '#8a7c63', fontSize: 12, cursor: 'pointer' }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    style={{ marginTop: 10, background: '#fff', border: '1px solid #cdbfa6', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, color: '#0e2a43', cursor: 'pointer' }}
                  >
                    📎 Add a photo or PDF
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0]
                    if (f) setState({ attach: f.name })
                  }}
                  style={{ display: 'none' }}
                />
                <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.5, color: '#8a7c63', textWrap: 'pretty' }}>
                  Not read by the AI and not part of the diagnosis - saved to your record so your teacher can check the working was done by hand.
                </p>
              </div>

              {mcqOptions ? (
                blocked && (
                  <p style={{ margin: '12px 0 0', textAlign: 'center', fontSize: 12, color: '#b6531f' }}>
                    Your teacher has asked for a photo of your handwritten working on this assignment.
                  </p>
                )
              ) : (
                <>
                  <button
                    onClick={() => {
                      if (blocked) return
                      const correct = normalize(s.answer) === normalize(problem.correctAnswer)
                      setState({ pStep: correct ? 'correct' : 'solution' })
                    }}
                    style={{ marginTop: 18, width: '100%', color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 600, fontSize: 15, background: blocked ? '#e7c3ab' : '#dd6a2f', cursor: blocked ? 'not-allowed' : 'pointer' }}
                  >
                    Check my answer
                  </button>
                  {blocked ? (
                    <p style={{ margin: '8px 0 0', textAlign: 'center', fontSize: 12, color: '#b6531f' }}>
                      Your teacher has asked for a photo of your handwritten working on this assignment.
                    </p>
                  ) : (
                    <p style={{ margin: '12px 0 0', textAlign: 'center', fontSize: 12, color: '#a99e88' }}>
                      You attempt it on your own first - help only comes after.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* CORRECT step */}
          {s.pStep === 'correct' && (
            <div style={{ marginTop: 22 }}>
              <div style={{ background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 10, padding: '16px 18px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1f4e75', marginTop: 5, flex: 'none' }} />
                <div style={{ fontSize: 13.5, color: '#2b4a63', lineHeight: 1.5 }}>
                  That's right{!!problem.answerLabel && ` - ${problem.answerLabel} ${problem.correctAnswer}`}.
                </div>
              </div>
              <button
                onClick={() => finish(true)}
                style={{ marginTop: 16, width: '100%', background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: 14, fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}
              >
                Continue →
              </button>
            </div>
          )}

          {/* SOLUTION step: answers side-by-side, worked solution, multi-line select */}
          {s.pStep === 'solution' && (
            <div style={{ marginTop: 22 }}>
              <div style={{ background: '#fbf3ea', border: '1px solid #efd9c3', borderRadius: 10, padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dd6a2f', marginTop: 5, flex: 'none' }} />
                <div style={{ fontSize: 13.5, color: '#5c3a24', lineHeight: 1.5 }}>
                  Not quite. Compare your answer with the correct one, then read the worked solution.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
                <div style={{ flex: 1, minWidth: 150, background: '#faf6ee', border: '1px solid #e4dccb', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={monoCap({ marginBottom: 8 })}>Your answer</div>
                  <div style={{ fontFamily: FONT_SERIF, fontSize: 24, color: '#1a2129' }}>
                    {problem.answerLabel} {s.answer}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: '#b6531f', fontWeight: 600 }}>✗ not correct</div>
                </div>
                <div style={{ flex: 1, minWidth: 150, background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={monoCap({ color: '#1f4e75', marginBottom: 8 })}>Correct answer</div>
                  <div style={{ fontFamily: FONT_SERIF, fontSize: 24, color: '#0e2a43' }}>
                    {problem.answerLabel} {problem.correctAnswer}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: '#1f4e75', fontWeight: 600 }}>✓</div>
                </div>
              </div>
              <div style={monoCap({ letterSpacing: '.6px', marginBottom: 10 })}>Worked solution</div>
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '16px 20px', marginBottom: 22 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {problem.lines.map((_, i) => workingLine(i, false))}
                </div>
              </div>
              <div style={{ fontSize: 13.5, color: '#0e2a43', fontWeight: 600, marginBottom: 4, fontFamily: FONT_SERIF }}>
                Where did your paper working go wrong?
              </div>
              <div style={{ fontSize: 12.5, color: '#5c6773', marginBottom: 12, textWrap: 'pretty' }}>
                Tick every line where you used the wrong technique, or don't understand why it was done. You can pick more than one.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {problem.lines.map((_, i) => workingLine(i, true))}
              </div>
              {selCount > 0 && (
                <button
                  onClick={() => setState({ pStep: 'reason', pIdx: 0, pAllWrong: false, pReasons: {}, pNotes: {}, pOtherOpen: false, pOtherDraft: '' })}
                  style={{ marginTop: 16, width: '100%', background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: 14, fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}
                >
                  {continueLabel}
                </button>
              )}
              <button
                onClick={() => setState({ pLines: problem.lines.map((_, i) => i), pAllWrong: true, pStep: 'reteach', pReasons: {}, pNotes: {} })}
                style={{ marginTop: 10, width: '100%', background: '#fff', color: '#0e2a43', border: '1.5px dashed #b9a888', borderRadius: 10, padding: 12, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}
              >
                I'm not sure where · I got it all wrong
              </button>
            </div>
          )}

          {/* REASON step */}
          {s.pStep === 'reason' && (
            <div style={{ marginTop: 22 }}>
              <div style={monoCap({ letterSpacing: '.6px', color: '#b6531f', marginBottom: 8 })}>{reasonCounter}</div>
              <div style={{ fontSize: 13, color: '#5c6773', marginBottom: 4 }}>{reasonPrompt}</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0e2a43', marginBottom: 14, fontFamily: FONT_SERIF }}>
                Why do you think that happened?
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {!s.pOtherOpen &&
                  reasons.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => pickReason(r.key)}
                      style={{ textAlign: 'left', background: '#faf6ee', border: '1px solid #e4dccb', borderRadius: 10, padding: '14px 16px', fontSize: 14.5, color: '#1a2129', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
                    >
                      <span style={{ fontSize: 20 }}>{r.icon}</span>
                      {r.label}
                    </button>
                  ))}
              </div>
              {s.pOtherOpen && (
                <div style={{ marginTop: 12, background: '#faf6ee', border: '1px solid #e4dccb', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0e2a43', marginBottom: 8, fontFamily: FONT_SERIF }}>
                    In your own words, what went wrong here?
                  </div>
                  <textarea
                    value={s.pOtherDraft}
                    onChange={(e) => setState({ pOtherDraft: e.target.value })}
                    placeholder="e.g. I forgot which way round to move the number, so I never flip the sign..."
                    style={{ width: '100%', boxSizing: 'border-box', minHeight: 88, resize: 'vertical', border: '1px solid #d8cbb2', borderRadius: 9, padding: '12px 13px', fontSize: 14, color: '#1a2129', background: '#fff', lineHeight: 1.5 }}
                  />
                  <div style={{ fontSize: 11.5, color: '#8a7c63', margin: '8px 0 0', textWrap: 'pretty' }}>
                    This just gives your teacher extra context - it won't change how the next step is chosen.
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 9 }}>
                    <button
                      onClick={submitOther}
                      style={{ flex: 1, background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 9, padding: 12, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                    >
                      Save and continue →
                    </button>
                    <button
                      onClick={() => setState({ pOtherOpen: false, pOtherDraft: '' })}
                      style={{ background: '#fff', color: '#5c6773', border: '1px solid #cdbfa6', borderRadius: 9, padding: '12px 16px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
              {!s.pOtherOpen && (
                <div
                  onClick={() => setState({ pStep: 'solution', pIdx: 0 })}
                  style={{ marginTop: 12, fontSize: 12.5, color: '#8a7c63', cursor: 'pointer', textAlign: 'center' }}
                >
                  ← pick a different line
                </div>
              )}
            </div>
          )}

          {/* RETEACH step */}
          {s.pStep === 'reteach' && (
            <div style={{ marginTop: 22 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {reteachList.map((rt) => (
                  <div key={rt.key} style={{ border: '1px solid #e4dccb', borderRadius: 12, padding: '18px 20px', background: '#fffdf9' }}>
                    {!rt.isAllWrong && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#a99e88' }}>Line {rt.line}</span>
                        <span style={{ fontFamily: FONT_SERIF, fontSize: 16, color: '#1a2129' }}>{rt.lineTex}</span>
                      </div>
                    )}
                    <span style={rt.scopeStyle}>{rt.scope}</span>
                    {rt.hasNote && (
                      <div style={{ marginTop: 10, background: '#f6f1e7', border: '1px solid #e4dccb', borderRadius: 9, padding: '11px 13px' }}>
                        <div style={monoCap({ fontSize: 9.5, marginBottom: 4 })}>In your words</div>
                        <div style={{ fontSize: 13, color: '#3f4a54', lineHeight: 1.5, textWrap: 'pretty' }}>{rt.note}</div>
                      </div>
                    )}
                    <div style={{ marginTop: 10 }}>
                      <TeachingCard heading={rt.heading} body={rt.body} exampleTitle={rt.exampleTitle} exampleSteps={rt.exampleSteps} />
                    </div>
                    <div style={{ marginTop: 14, display: 'flex', gap: 9, alignItems: 'flex-start', background: '#eef3f7', border: '1px solid #d3e0ea', borderRadius: 9, padding: '12px 14px' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f4e75', marginTop: 6, flex: 'none' }} />
                      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#2b4a63' }}>{rt.route}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                <button
                  onClick={() => finish(false)}
                  style={{ flex: 1, background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}
                >
                  {reteach.cta}
                </button>
                <button
                  onClick={onExit}
                  style={{ background: '#fff', color: '#0e2a43', border: '1px solid #cdbfa6', borderRadius: 10, padding: '13px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        <p style={{ margin: '18px 4px 0', fontSize: 11.5, color: '#a99e88', lineHeight: 1.5, textAlign: 'center' }}>
          No streaks, points, or class rankings - just your own progress. This is the whole diagnostic signal: where it went wrong, and why.
        </p>
      </div>
    </div>
  )
}
