/**
 * The practice-problem bank: real content for the diagnostic practice loop
 * (`components/PracticeLoop.tsx`) and the Lesson/Review session wrappers to
 * draw from, instead of the one hardcoded equation the loop used to show
 * for every topic.
 *
 * Deliberately small and deliberately mined from existing sample content
 * (`data/activityLog.ts`, `data/oversight.ts`) rather than invented from
 * scratch, so the live practice loop stays consistent with what Aisha's
 * activity log and Daniel's Oversight flag already narrate. Three topics
 * (matching `data/curriculum.ts` keys): `linear`, `substitution`, `fracpct`.
 *
 * `familyId` groups "same structure, different numbers" variants — this is
 * what a "silly mistake → similar question" retry draws from. `linear` has
 * two families because Aisha's own review log already shows two distinct
 * error patterns under one topic (crossing the equals sign vs. dividing by
 * a negative) — treating those as one family would serve a "similar
 * question" that doesn't actually test the same slip.
 *
 * `difficulty` is a per-problem tier within its topic (not its family, which
 * is same-structure-different-numbers and so roughly constant difficulty by
 * design) - used by the computed mastery engine (`data/engine.ts`) to update
 * the right foundations/core/stretch slot when an attempt on this problem is
 * recorded. Tagged by hand, roughly first-in-family-easiest /
 * hardest-or-last-in-family-stretch, with real complexity (operation count,
 * number of substituted variables, denominator/decimal awkwardness) breaking
 * ties where the family order alone would mis-rank two problems.
 */
export interface Problem {
  id: string
  topic: string
  familyId: string
  difficulty: 'foundations' | 'core' | 'stretch'
  prompt: string
  statement: string
  answerLabel: string
  correctAnswer: string
  lines: string[]
  solNotes: string[]
  errIdx: number
  /**
   * Three plausible wrong answers - genuine common mistakes for this
   * problem, not random numbers - used only by the MCQ confidence-rebuild
   * retry (`PracticeLoop`'s `mcq` prop): the second attempt at a similar
   * question after a self-reported silly mistake. Authored only for
   * problems actually reachable as that retry's target (see the two
   * `LessonSession`/`ReviewSession` call sites); a problem with none falls
   * back to the ordinary free-typed input rather than showing a partial or
   * broken multiple-choice.
   */
  distractors?: string[]
}

export const PROBLEMS: Problem[] = [
  // linear · crossing the equals sign (mined from activityLog LOG_RAW[0] Q1/Q3)
  {
    id: 'lin-ce-1',
    topic: 'linear',
    familyId: 'lin-cross-equals',
    difficulty: 'foundations',
    prompt: 'Solve for x',
    answerLabel: 'x =',
    statement: '3x − 7 = 11',
    correctAnswer: '6',
    lines: ['3x − 7 = 11', '3x = 11 + 7', '3x = 18', 'x = 6'],
    solNotes: ['', '−7 crosses the =, so it becomes +7', '', 'divide both sides by 3'],
    errIdx: 1,
    // 4: didn't flip the sign crossing the = (3x = 11 − 7) and forgot the final ÷3.
    // 18: correctly crossed to 3x = 18 but forgot to divide by 3.
    // 9: divided 18 ÷ 3 wrong.
    distractors: ['4', '18', '9'],
  },
  {
    id: 'lin-ce-2',
    topic: 'linear',
    familyId: 'lin-cross-equals',
    difficulty: 'core',
    prompt: 'Solve for x',
    answerLabel: 'x =',
    statement: '5x − 4 = 16',
    correctAnswer: '4',
    lines: ['5x − 4 = 16', '5x = 16 + 4', '5x = 20', 'x = 4'],
    solNotes: ['', '−4 crosses the =, so it becomes +4', '', 'divide both sides by 5'],
    errIdx: 1,
    // 12: didn't flip the sign crossing the = (5x = 16 − 4) and forgot the final ÷5.
    // 20: correctly crossed to 5x = 20 but forgot to divide by 5.
    // 5: divided 20 ÷ 5 wrong.
    distractors: ['12', '20', '5'],
  },
  {
    id: 'lin-ce-3',
    topic: 'linear',
    familyId: 'lin-cross-equals',
    difficulty: 'core',
    prompt: 'Solve for x',
    answerLabel: 'x =',
    statement: '4x − 9 = 15',
    correctAnswer: '6',
    lines: ['4x − 9 = 15', '4x = 15 + 9', '4x = 24', 'x = 6'],
    solNotes: ['', '−9 crosses the =, so it becomes +9', '', 'divide both sides by 4'],
    errIdx: 1,
    // 3⁄2: didn't flip the sign crossing the = (4x = 15 − 9 = 6) but still divided by 4.
    // 24: correctly crossed to 4x = 24 but forgot to divide by 4.
    // 8: divided 24 ÷ 4 wrong.
    distractors: ['3⁄2', '24', '8'],
  },
  {
    id: 'lin-ce-4',
    topic: 'linear',
    familyId: 'lin-cross-equals',
    difficulty: 'stretch',
    prompt: 'Solve for x',
    answerLabel: 'x =',
    statement: '2x − 5 = 13',
    correctAnswer: '9',
    lines: ['2x − 5 = 13', '2x = 13 + 5', '2x = 18', 'x = 9'],
    solNotes: ['', '−5 crosses the =, so it becomes +5', '', 'divide both sides by 2'],
    errIdx: 1,
    // 8: didn't flip the sign crossing the = (2x = 13 − 5) and forgot the final ÷2.
    // 18: correctly crossed to 2x = 18 but forgot to divide by 2.
    // 16: confused divide-by-2 with subtract-2 on the final step.
    distractors: ['8', '18', '16'],
  },
  // linear · dividing by a negative (mined from activityLog LOG_RAW[0] Q5)
  {
    id: 'lin-dn-1',
    topic: 'linear',
    familyId: 'lin-divide-negative',
    difficulty: 'foundations',
    prompt: 'Solve for x',
    answerLabel: 'x =',
    statement: '7 − 2x = 3',
    correctAnswer: '2',
    lines: ['7 − 2x = 3', '−2x = 3 − 7', '−2x = −4', 'x = 2'],
    solNotes: ['', 'move 7 across: it becomes −7 on the right', '', 'divide both sides by −2 · a negative divided by a negative is positive'],
    errIdx: 3,
    // −2: forgot a negative divided by a negative is positive (−4 ÷ −2 read as −2).
    // −4: correctly reached −2x = −4 but forgot to divide by −2 at all.
    // 3: divided −4 ÷ −2 wrong.
    distractors: ['−2', '−4', '3'],
  },
  {
    id: 'lin-dn-2',
    topic: 'linear',
    familyId: 'lin-divide-negative',
    difficulty: 'stretch',
    prompt: 'Solve for x',
    answerLabel: 'x =',
    statement: '10 − 3x = 1',
    correctAnswer: '3',
    lines: ['10 − 3x = 1', '−3x = 1 − 10', '−3x = −9', 'x = 3'],
    solNotes: ['', 'move 10 across: it becomes −10 on the right', '', 'divide both sides by −3 · a negative divided by a negative is positive'],
    errIdx: 3,
    // −3: forgot a negative divided by a negative is positive (−9 ÷ −3 read as −3).
    // −9: correctly reached −3x = −9 but forgot to divide by −3 at all.
    // 4: divided −9 ÷ −3 wrong.
    distractors: ['−3', '−9', '4'],
  },
  // substitution · two-term expressions (mined from activityLog LOG_RAW[1] Q6/Q7/Q9)
  {
    id: 'sub-two-1',
    topic: 'substitution',
    familyId: 'sub-two-term',
    difficulty: 'foundations',
    prompt: 'Evaluate the expression',
    answerLabel: '=',
    statement: '3a + 2b, when a = 4, b = 5',
    correctAnswer: '22',
    lines: ['3a + 2b', '3×4 + 2×5', '12 + 10', '22'],
    solNotes: ['', 'substitute a = 4 and b = 5 - each letter takes its own value', '', ''],
    errIdx: 1,
  },
  {
    id: 'sub-two-2',
    topic: 'substitution',
    familyId: 'sub-two-term',
    difficulty: 'core',
    prompt: 'Evaluate the expression',
    answerLabel: '=',
    statement: '5m − n, when m = 3, n = 8',
    correctAnswer: '7',
    lines: ['5m − n', '5×3 − 8', '15 − 8', '7'],
    solNotes: ['', 'substitute m = 3 and n = 8', '', ''],
    errIdx: 1,
  },
  {
    id: 'sub-two-3',
    topic: 'substitution',
    familyId: 'sub-two-term',
    // Three substituted variables (a, b, c) plus a product of two of them (ab) - the hardest bookkeeping in this family, not just the last-declared.
    difficulty: 'stretch',
    prompt: 'Evaluate the expression',
    answerLabel: '=',
    statement: 'ab + c, when a = 2, b = 3, c = 4',
    correctAnswer: '10',
    lines: ['ab + c', '2×3 + 4', '6 + 4', '10'],
    solNotes: ['', 'substitute a = 2, b = 3, c = 4', '', ''],
    errIdx: 1,
  },
  {
    id: 'sub-two-4',
    topic: 'substitution',
    familyId: 'sub-two-term',
    difficulty: 'core',
    prompt: 'Evaluate the expression',
    answerLabel: '=',
    statement: '4x − 2y, when x = 5, y = 3',
    correctAnswer: '14',
    lines: ['4x − 2y', '4×5 − 2×3', '20 − 6', '14'],
    solNotes: ['', 'substitute x = 5 and y = 3', '', ''],
    errIdx: 1,
  },
  // substitution · single-term expressions (mined from activityLog LOG_RAW[1] Q8/Q10)
  {
    id: 'sub-one-1',
    topic: 'substitution',
    familyId: 'sub-single-term',
    // Two operations (multiply, then add) vs. sub-one-2's one - harder despite being listed first.
    difficulty: 'stretch',
    prompt: 'Evaluate the expression',
    answerLabel: '=',
    statement: '2x + 7, when x = 6',
    correctAnswer: '19',
    lines: ['2x + 7', '2×6 + 7', '12 + 7', '19'],
    solNotes: ['', 'substitute x = 6', '', ''],
    errIdx: 1,
  },
  {
    id: 'sub-one-2',
    topic: 'substitution',
    familyId: 'sub-single-term',
    difficulty: 'foundations',
    prompt: 'Evaluate the expression',
    answerLabel: '=',
    statement: '4p, when p = 9',
    correctAnswer: '36',
    lines: ['4p', '4×9', '36'],
    solNotes: ['', 'substitute p = 9', ''],
    errIdx: 1,
  },
  // fractions → percentages (mined from activityLog LOG_RAW[3] and oversight.ts's Daniel card)
  {
    id: 'fracpct-1',
    topic: 'fracpct',
    familyId: 'fracpct-convert',
    // Eighths -> 3 decimal places (.375): more awkward than the quarters/twentieths/twenty-fifths below.
    difficulty: 'stretch',
    prompt: 'Write as a percentage',
    answerLabel: '',
    statement: '3⁄8 as a %',
    correctAnswer: '37.5%',
    lines: ['3⁄8 as a %', '3 ÷ 8 = 0.375', '0.375 × 100', '37.5%'],
    solNotes: ['', 'divide the numerator by the denominator', 'multiply by 100 to convert to a percentage', ''],
    errIdx: 1,
    // 0.375%: forgot the final ×100 step.
    // 3.75%: multiplied by 10 instead of 100 - decimal point in the wrong place.
    // 266.7%: divided the wrong way round (8 ÷ 3 instead of 3 ÷ 8).
    distractors: ['0.375%', '3.75%', '266.7%'],
  },
  {
    id: 'fracpct-2',
    topic: 'fracpct',
    familyId: 'fracpct-convert',
    // Quarters: the cleanest, most familiar conversion in this family.
    difficulty: 'foundations',
    prompt: 'Write as a percentage',
    answerLabel: '',
    statement: '1⁄4 as a %',
    correctAnswer: '25%',
    lines: ['1⁄4 as a %', '1 ÷ 4 = 0.25', '0.25 × 100', '25%'],
    solNotes: ['', 'divide the numerator by the denominator', 'multiply by 100 to convert to a percentage', ''],
    errIdx: 1,
    // 0.25%: forgot the final ×100 step.
    // 2.5%: multiplied by 10 instead of 100 - decimal point in the wrong place.
    // 400%: divided the wrong way round (4 ÷ 1 instead of 1 ÷ 4).
    distractors: ['0.25%', '2.5%', '400%'],
  },
  {
    id: 'fracpct-3',
    topic: 'fracpct',
    familyId: 'fracpct-convert',
    difficulty: 'core',
    prompt: 'Write as a percentage',
    answerLabel: '',
    statement: '7⁄20 as a %',
    correctAnswer: '35%',
    lines: ['7⁄20 as a %', '7 ÷ 20 = 0.35', '0.35 × 100', '35%'],
    solNotes: ['', 'divide the numerator by the denominator', 'multiply by 100 to convert to a percentage', ''],
    errIdx: 1,
    // 0.35%: forgot the final ×100 step.
    // 3.5%: multiplied by 10 instead of 100 - decimal point in the wrong place.
    // 285.7%: divided the wrong way round (20 ÷ 7 instead of 7 ÷ 20).
    distractors: ['0.35%', '3.5%', '285.7%'],
  },
  {
    id: 'fracpct-4',
    topic: 'fracpct',
    familyId: 'fracpct-convert',
    // Fortieths -> 3 decimal places (.225): the least familiar denominator in this family.
    difficulty: 'stretch',
    prompt: 'Write as a percentage',
    answerLabel: '',
    statement: '9⁄40 as a %',
    correctAnswer: '22.5%',
    lines: ['9⁄40 as a %', '9 ÷ 40 = 0.225', '0.225 × 100', '22.5%'],
    solNotes: ['', 'divide the numerator by the denominator', 'multiply by 100 to convert to a percentage', ''],
    errIdx: 1,
    // 0.225%: forgot the final ×100 step.
    // 2.25%: multiplied by 10 instead of 100 - decimal point in the wrong place.
    // 444.4%: divided the wrong way round (40 ÷ 9 instead of 9 ÷ 40).
    distractors: ['0.225%', '2.25%', '444.4%'],
  },
  {
    id: 'fracpct-5',
    topic: 'fracpct',
    familyId: 'fracpct-convert',
    difficulty: 'core',
    prompt: 'Write as a percentage',
    answerLabel: '',
    statement: '11⁄25 as a %',
    correctAnswer: '44%',
    lines: ['11⁄25 as a %', '11 ÷ 25 = 0.44', '0.44 × 100', '44%'],
    solNotes: ['', 'divide the numerator by the denominator', 'multiply by 100 to convert to a percentage', ''],
    errIdx: 1,
    // 0.44%: forgot the final ×100 step.
    // 4.4%: multiplied by 10 instead of 100 - decimal point in the wrong place.
    // 227.3%: divided the wrong way round (25 ÷ 11 instead of 11 ÷ 25).
    distractors: ['0.44%', '4.4%', '227.3%'],
  },
]

export function problemsForTopic(topic: string): Problem[] {
  return PROBLEMS.filter((p) => p.topic === topic)
}

/** Direct id lookup - the join key an AttemptResult.problemId (and so an AttemptEvent.difficulty) is read through. */
export function problemById(id: string): Problem | undefined {
  return PROBLEMS.find((p) => p.id === id)
}

/** "Problem N" for a topic = its position in problemsForTopic, 0-indexed. */
export function problemAt(topic: string, n: number): Problem | undefined {
  return problemsForTopic(topic)[n]
}

/** A same-family "different numbers" variant, for the silly-mistake retry. Deterministic (first match), not random - reproducible for demos. */
export function similarProblem(problemId: string, exclude: string[] = []): Problem | undefined {
  const cur = PROBLEMS.find((p) => p.id === problemId)
  if (!cur) return undefined
  return PROBLEMS.find((p) => p.familyId === cur.familyId && p.id !== cur.id && !exclude.includes(p.id))
}
