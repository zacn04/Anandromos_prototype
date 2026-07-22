/**
 * Per-student drill-down content for the Teacher POV: the "Where to start"
 * bullets, pace-vs-expected, and difficulty-weighted mastery rows shown on a
 * student's profile screen. Keyed by the same lowercase-first-name id
 * `TeacherApp.tsx`'s `mkStudent()` derives from the dashboard roster.
 *
 * Aisha Bello is the original, fully fleshed-out sample profile (values
 * unchanged from what the Teacher POV already showed for her). Daniel Kovač
 * and Reuben Clarke are lighter profiles consistent with their existing
 * dashboard `insight` text and `data/oversight.ts` flags — not arbitrary
 * new content. Every other roster name intentionally has no entry here:
 * the Teacher POV falls back to an honest "profile not built out yet" card
 * rather than showing borrowed data under the wrong name.
 */

export interface PaceRow {
  topic: string
  tag: string
  kind: 'ahead' | 'onpace' | 'behind'
  actual: number
  expected: number
}

export interface MasteryRow {
  name: string
  foundations: number
  core: number
  stretch: number
}

export interface WorkingOnNow {
  topic: string
  detail: string
  note: string
}

export interface StudentProfile {
  whereToStart: string[]
  pace: PaceRow[]
  mastery: MasteryRow[]
  workingOnNow: WorkingOnNow
}

export const PROFILE_BY_ID: Record<string, StudentProfile> = {
  aisha: {
    whereToStart: [
      'At the linear-equations frontier, but rearranging is a memorised ritual, not understood.',
      'Likely root cause: the prerequisite - inverse operations (substitution) - never became solid.',
      'Best next move: a short re-teach of that step, not more equation practice.',
    ],
    pace: [
      { topic: 'Ratio & proportion', tag: 'Ahead · +1 term', kind: 'ahead', actual: 0.88, expected: 0.6 },
      { topic: 'Negatives', tag: 'Ahead', kind: 'ahead', actual: 1, expected: 0.9 },
      { topic: 'Fractions & %', tag: 'On pace', kind: 'onpace', actual: 0.78, expected: 0.75 },
      { topic: 'Algebra basics', tag: 'Behind', kind: 'behind', actual: 0.55, expected: 0.78 },
      { topic: 'Linear equations', tag: 'Behind · ½ term', kind: 'behind', actual: 0.32, expected: 0.7 },
    ],
    mastery: [
      { name: 'Negatives', foundations: 1, core: 0.9, stretch: 0.6 },
      { name: 'Substitution', foundations: 0.8, core: 0.4, stretch: 0 },
      { name: 'Linear equations', foundations: 0.5, core: 0.15, stretch: 0 },
      { name: 'Fractions & %', foundations: 0.95, core: 0.75, stretch: 0.4 },
    ],
    workingOnNow: {
      topic: 'Linear equations',
      detail: 'Two-step equations with the unknown on one side.',
      note: 'Scaffolding is still high here - hints show full worked steps, and will fade automatically as her mastery of this topic rises.',
    },
  },
  daniel: {
    whereToStart: [
      'Plateaued on Fractions → % for two weeks - accuracy looks fine, but only on the easy items.',
      'Likely root cause: an ineffective practice pattern - he clears simple conversions and avoids the harder non-calculator ones, so his average overstates his real mastery.',
      'Best next move: graded, must-attempt-in-order practice on the harder items, not free choice of what to practise.',
    ],
    pace: [
      { topic: 'Negatives', tag: 'Ahead', kind: 'ahead', actual: 0.95, expected: 0.85 },
      { topic: 'Algebra basics', tag: 'On pace', kind: 'onpace', actual: 0.7, expected: 0.72 },
      { topic: 'Fractions & %', tag: 'Behind · stalled', kind: 'behind', actual: 0.42, expected: 0.75 },
      { topic: 'Substitution', tag: 'Behind', kind: 'behind', actual: 0.35, expected: 0.55 },
    ],
    mastery: [
      { name: 'Negatives', foundations: 1, core: 0.85, stretch: 0.5 },
      { name: 'Fractions & %', foundations: 0.95, core: 0.3, stretch: 0 },
      { name: 'Algebra basics', foundations: 0.85, core: 0.5, stretch: 0.1 },
      { name: 'Substitution', foundations: 0.6, core: 0.2, stretch: 0 },
    ],
    workingOnNow: {
      topic: 'Fractions → %',
      detail: 'Harder non-calculator conversions - the items he currently avoids.',
      note: "Deliberately routing him into these rather than letting him choose, since free choice is exactly how the plateau happened.",
    },
  },
  reuben: {
    whereToStart: [
      'Only 2 sessions logged on Substitution this fortnight - the gap itself is the signal, not a specific misconception.',
      "Likely root cause: low practice volume. He's accurate when he's actually working on it, so this isn't a knowledge gap so much as it not being durable yet.",
      "Best next move: a couple of short, low-stakes practice nudges this week rather than a re-teach - he doesn't need reteaching, he needs reps.",
    ],
    pace: [
      { topic: 'Ratio & proportion', tag: 'On pace', kind: 'onpace', actual: 0.72, expected: 0.7 },
      { topic: 'Negatives', tag: 'On pace', kind: 'onpace', actual: 0.88, expected: 0.85 },
      { topic: 'Algebra basics', tag: 'On pace', kind: 'onpace', actual: 0.68, expected: 0.72 },
      { topic: 'Substitution', tag: 'Behind · low volume', kind: 'behind', actual: 0.4, expected: 0.55 },
    ],
    mastery: [
      { name: 'Negatives', foundations: 0.9, core: 0.7, stretch: 0.35 },
      { name: 'Algebra basics', foundations: 0.8, core: 0.55, stretch: 0.2 },
      { name: 'Substitution', foundations: 0.55, core: 0.25, stretch: 0.05 },
      { name: 'Ratio & proportion', foundations: 0.85, core: 0.6, stretch: 0.3 },
    ],
    workingOnNow: {
      topic: 'Substitution',
      detail: 'Short, low-stakes practice nudges to build up reps.',
      note: 'No re-teach needed here - the priority is frequency, not content.',
    },
  },
}
