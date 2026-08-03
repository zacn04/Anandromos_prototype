import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FONT_MONO, FONT_SERIF } from '../theme'
import { Logo } from './Logo'
import type { Question, QuestionId, TopicId } from '../content'
import { questionAt, topicLabel } from '../content'

/**
 * The one-time diagnostic / placement test (Appendix A) - a short, calm
 * warm-up shown once before Aisha ever reaches Home, so the live mastery
 * engine (data/engine.ts) has a genuine starting point instead of only its
 * seeded overlay numbers. Six questions, pulled from the real question bank
 * (content/curriculum/questions.json) across the three topics that have one.
 *
 * Deliberately NOT the same thing as PracticeLoop's diagnostic practice
 * loop (solve → solution → reason → re-teach): this never pinpoints wrong
 * *lines*, never asks *why*, and never shows a worked solution or a
 * correct/incorrect verdict. It only ever records whether the final
 * answer was right, wrong, guessed, or left unknown, then moves straight
 * on - by design, so a placement test stays quick and low-stakes rather
 * than turning into six full re-teach cycles before the student has even
 * seen their own home screen.
 */

/** Same small notation-palette pattern as PracticeLoop's solve step, kept local rather than imported since PracticeLoop doesn't export it and this component is deliberately kept separate from that file. */
const PALETTE_DEFS: Array<[string, string, string]> = [
  ['x²', '²', 'Square'],
  ['xⁿ', '^', 'Power'],
  ['√', '√', 'Square root'],
  ['a⁄b', '⁄', 'Fraction'],
  ['( )', '()', 'Brackets'],
  ['π', 'π', 'Pi'],
  ['×', '×', 'Multiply'],
  ['÷', '÷', 'Divide'],
]

const monoCap = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  color: '#8a7c63',
  ...extra,
})

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '')

const ghostButtonStyle: CSSProperties = {
  flex: 1,
  background: '#fff',
  color: '#0e2a43',
  border: '1.5px dashed #b9a888',
  borderRadius: 10,
  padding: 12,
  fontWeight: 600,
  fontSize: 13.5,
  cursor: 'pointer',
}

export interface DiagnosticTestProps {
  /**
   * Fires once per genuine, checked answer - i.e. "Submit answer" only.
   * Never fires for "I don't know". Fires for "I guessed" too, but always
   * with `correct: false` and `weak: true` (see pickGuess below for why).
   * Deliberately just (topicId, questionId, correct, weak) rather than a
   * knowledge-graph node id: StudentApp owns the graph check (`isGraphTopic`)
   * and the live engine setter; this component only knows topic ids.
   */
  onAnswer: (topicId: TopicId, questionId: QuestionId, correct: boolean, weak: boolean) => void
  /** Fires once, when the student presses Continue on the closing summary screen. */
  onDone: () => void
}

interface DState {
  idx: number
  phase: 'question' | 'summary'
  answer: string
  attach: string | null
}

const FRESH: DState = { idx: 0, phase: 'question', answer: '', attach: null }

export function DiagnosticTest({ onAnswer, onDone }: DiagnosticTestProps) {
  const [s, setS] = useState<DState>(FRESH)
  const fileRef = useRef<HTMLInputElement>(null)
  const setState = (patch: Partial<DState> | ((st: DState) => Partial<DState>)) =>
    setS((st) => ({ ...st, ...(typeof patch === 'function' ? patch(st) : patch) }))

  /**
   * Picks: alg.linear and alg.substitution each have two distinct
   * error-pattern families - one subtopic each - so one question per family
   * gives breadth across both at an easy, non-discouraging first touch.
   * num.fractions-to-percent has only one, so depth instead - one
   * foundations, one core - for at least a little difficulty signal within
   * it. All six are resolved through the store's `questionAt` accessor
   * ("Nth question in this topic") rather than reaching into the question
   * bank directly. Read here, inside the component, rather than at module
   * scope: the content store isn't loaded until main.tsx has awaited it.
   */
  const RAW_QUESTIONS: Array<Question | undefined> = [
    questionAt('alg.linear', 0), // …cross-equals.q01 · crossing the equals sign · foundations
    questionAt('alg.linear', 4), // …divide-negative.q01 · dividing by a negative · foundations
    questionAt('alg.substitution', 0), // …two-term.q01 · two-term expression · foundations
    questionAt('alg.substitution', 5), // …single-term.q02 · single-term expression · foundations
    questionAt('num.fractions-to-percent', 1), // …convert.q02 · quarters · foundations
    questionAt('num.fractions-to-percent', 2), // …convert.q03 · twentieths · core
  ]
  /** Defensive - drops anything that stopped existing if the question bank is ever pruned; not expected to filter anything given the ids above are real. */
  const QUESTIONS: Question[] = RAW_QUESTIONS.filter((p): p is Question => !!p)

  if (QUESTIONS.length === 0) return null // defensive only - see RAW_QUESTIONS' comment
  const problem = QUESTIONS[Math.min(s.idx, QUESTIONS.length - 1)]

  /** Moves to the next question (resetting the per-question answer/attachment), or to the summary once the last question's action has fired. */
  const advance = () =>
    setState((st) => {
      const next = st.idx + 1
      return next >= QUESTIONS.length ? { phase: 'summary' as const } : { idx: next, answer: '', attach: null }
    })

  const submitAnswer = () => {
    const correct = normalize(s.answer) === normalize(problem.correctAnswer)
    onAnswer(problem.topicId, problem.id, correct, false)
    advance()
  }

  const pickGuess = () => {
    // A guess is real signal, just weaker than a confident attempt (see
    // AttemptEvent.weak in data/engine.ts). Nothing here checks whether the
    // typed text (if any) actually matches - that's the whole point of
    // "I guessed" - so it's recorded as `correct: false` rather than
    // silently crediting a lucky match; `weak: true` then halves how hard
    // that pulls the topic's mastery down, so it never reads the same as a
    // genuine, confident wrong answer.
    onAnswer(problem.topicId, problem.id, false, true)
    advance()
  }

  const pickIdk = () => {
    // Deliberately does NOT call onAnswer at all. "I don't know" is an
    // honest non-attempt, not evidence of anything about the topic - the
    // engine's `weak` flag could carry it too (AttemptEvent's own doc
    // comment mentions "I don't know" in the same breath as a guess, and
    // recordAttempt already declines to bank a rep for either), but between
    // the two options the task allows here, skipping the call entirely is
    // simpler and, for a flat "no attempt at all", more honest than
    // manufacturing a data point out of nothing. Kept as its own function
    // (rather than folding into pickGuess) so the two stay easy to tell
    // apart at the call site, and easy to switch to a weak: true call later
    // if this ever turns out to need one after all.
    advance()
  }

  if (s.phase === 'summary') {
    return (
      <div style={{ minHeight: '100vh', background: '#f6f1e7', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', background: '#0e2a43', padding: '11px 22px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={22} />
            <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 15, color: '#fff' }}>Anadromos</span>
          </div>
        </div>
        <div style={{ width: '100%', maxWidth: 560, padding: '70px 24px' }}>
          <div style={{ background: '#fff', border: '1px solid #d3e0ea', borderRadius: 16, padding: '34px 30px', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#e4edf3', color: '#1f4e75', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 16px' }}>
              ✓
            </div>
            <h1 style={{ fontFamily: FONT_SERIF, fontSize: 24, fontWeight: 600, color: '#0e2a43', margin: '0 0 10px' }}>
              Thanks — this gives us a starting point
            </h1>
            <p style={{ margin: '0 0 26px', fontSize: 14, lineHeight: 1.6, color: '#5c6773', textWrap: 'pretty' }}>
              No score, no grade - just a first read on where to begin. Your path on Home is already shaped around it.
            </p>
            <button
              onClick={onDone}
              style={{ background: '#dd6a2f', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 30px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}
            >
              Continue →
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f6f1e7', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', background: '#0e2a43', color: '#dbe6ef', padding: '11px 22px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Logo size={22} />
          <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 15, color: '#fff' }}>Anadromos</span>
          <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 11.5, color: '#9fb4c7' }}>
            Question {s.idx + 1} of {QUESTIONS.length}
          </span>
        </div>
      </div>

      <div style={{ width: '100%', background: '#e4edf3', borderBottom: '1px solid #cddceb', padding: '9px 22px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: '#1f4e75', textWrap: 'pretty' }}>
          <span
            style={{
              fontWeight: 700,
              fontFamily: FONT_MONO,
              fontSize: 10.5,
              letterSpacing: '.5px',
              textTransform: 'uppercase',
              background: '#1f4e75',
              color: '#fff',
              padding: '2px 8px',
              borderRadius: 5,
              flex: 'none',
            }}
          >
            Getting started
          </span>
          A quick check-in before Home. Answer if you can, or say so honestly if you're guessing or stuck - either is fine.
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 680, padding: '26px 24px 60px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={monoCap({ fontSize: 11, letterSpacing: '.8px' })}>{topicLabel(problem.topicId)}</div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '26px 28px', boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}>
          <div style={monoCap({ fontSize: 11, letterSpacing: '.8px', marginBottom: 8 })}>{problem.prompt}</div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 30, fontWeight: 600, color: '#0e2a43', letterSpacing: '.5px' }}>{problem.statement}</div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 12.5, color: '#8a7c63', marginBottom: 8 }}>
              Type your final answer if you've got one. Use the palette for notation a keyboard can't produce.
            </div>

            {/* notation palette - same pattern as PracticeLoop's solve step */}
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

            {/* optional handwriting upload - exact file-input pattern from PracticeLoop's solve step; cosmetic only, never read */}
            <div style={{ marginTop: 12, background: '#faf6ee', border: '1px dashed #cdbfa6', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0e2a43' }}>Handwritten working</span>
                <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 9px', borderRadius: 20, color: '#5c6773', background: '#eef0f2', border: '1px solid #dfe3e7' }}>Optional</span>
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

            <button
              onClick={submitAnswer}
              style={{ marginTop: 18, width: '100%', color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 600, fontSize: 15, background: '#dd6a2f', cursor: 'pointer' }}
            >
              Submit answer
            </button>

            <div style={{ marginTop: 10, display: 'flex', gap: 9 }}>
              <button onClick={pickIdk} style={ghostButtonStyle}>
                I don't know
              </button>
              <button onClick={pickGuess} style={ghostButtonStyle}>
                I guessed
              </button>
            </div>

            <p style={{ margin: '12px 0 0', textAlign: 'center', fontSize: 12, color: '#a99e88' }}>
              There's no wrong door here - this just helps us find your starting point.
            </p>
          </div>
        </div>

        <p style={{ margin: '18px 4px 0', fontSize: 11.5, color: '#a99e88', lineHeight: 1.5, textAlign: 'center' }}>
          No streaks, points, or class rankings - just a calm starting point for your path.
        </p>
      </div>
    </div>
  )
}
