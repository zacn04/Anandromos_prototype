import type { Problem } from './problems'
import { problemsForTopic } from './problems'

export interface Concept {
  id: string
  label: string
  /**
   * A real-world hook the student already believes, shown once before the
   * teach card - the plan's "transfer in": ground the new maths as a
   * formalisation of something familiar, rather than opening on the
   * abstract rule. Optional; a concept with none skips straight to teach.
   */
  transferIn?: { hook: string; body: string[] }
  teach: { heading: string; body: string[]; exampleTitle?: string; exampleSteps?: string[] }
  checkProblems: Problem[]
  /**
   * Shown once, after the concept is mastered and before advancing - the
   * plan's "transfer out": the student describes their own novel real-world
   * example of the concept in action, "the single strongest available test
   * of whether real understanding, not pattern-matching, occurred." Not
   * scored - the response is just captured and the lesson moves on.
   * Optional; a concept with none advances straight through.
   */
  transferOut?: { prompt: string; placeholder?: string }
}

export interface Lesson {
  id: string
  subtopic: string
  concepts: Concept[]
}

const linear = problemsForTopic('linear')
const crossEquals = linear.filter((p) => p.familyId === 'lin-cross-equals')
const divideNegative = linear.filter((p) => p.familyId === 'lin-divide-negative')

/**
 * One fully-authored demo lesson. Its two concepts map onto `linear`'s two
 * error families in data/problems.ts (crossing the equals sign / dividing
 * by a negative) - those aren't arbitrary groupings, they're the two
 * distinct error patterns Aisha's own activity log already shows under
 * this topic (see data/activityLog.ts LOG_RAW[0]).
 */
export const LESSONS: Record<string, Lesson> = {
  linear: {
    id: 'linear',
    subtopic: 'Linear equations',
    concepts: [
      {
        id: 'cross-equals',
        label: 'Moving a term across the =',
        transferIn: {
          hook: 'Two pans, always level',
          body: [
            "Picture an old-fashioned set of kitchen scales, one pan on each side. Add a weight to one pan and the scales tip - unless you add the exact same weight to the other pan too. Take a weight off one side, and the other side has to lose the same amount to stay level.",
            "An equation works the same way. The = sign says both sides are level right now. You're free to add, remove, or shift anything you like, as long as you do the identical thing to both sides at once.",
          ],
        },
        teach: {
          heading: 'Moving a term across the equals sign',
          body: [
            'An equation is a balance: whatever you do to one side, you do to the other. Moving a term across the = is really adding or subtracting it from both sides at once - and that flips its sign.',
          ],
          exampleTitle: 'Same idea, one step',
          exampleSteps: ['x − 4 = 9', 'Add 4 to both sides', 'x = 13'],
        },
        checkProblems: crossEquals,
        transferOut: {
          prompt:
            'Where else have you seen something moved from one side to keep things level, flipping from adding to subtracting (or back) on the way? It could be about money, time, anything. Describe your own example in a sentence or two.',
          placeholder:
            "e.g. when I pay my brother back £5, it comes off what I owe him and gets added to what I've paid off so far...",
        },
      },
      {
        id: 'divide-negative',
        label: 'Dividing by a negative',
        transferIn: {
          hook: 'A temperature that keeps falling',
          body: [
            "Overnight, a fridge's temperature drops by 12°C in total, falling at a steady 3°C an hour with the door left open. To find how many hours the door was open, you divide the total drop by the hourly rate - both negative, because both describe the same direction of change. A negative divided by a negative comes out positive: 4 hours, which is the only sensible kind of answer a number of hours can be.",
          ],
        },
        teach: {
          heading: 'Dividing by a negative number',
          body: [
            "Once the unknown term is on its own, divide both sides by its coefficient - including the sign. A negative divided by a negative gives a positive answer, so don't drop the sign on the last step.",
          ],
          exampleTitle: 'Same idea, one step',
          exampleSteps: ['−3x = −12', 'Divide both sides by −3', 'x = 4'],
        },
        checkProblems: divideNegative,
        transferOut: {
          prompt:
            'Think of your own moment where two negatives - both describing the same kind of drop, debt, or backward movement - divided out to leave an ordinary positive number. Describe it in a sentence or two.',
          placeholder: 'e.g. a diver going down 2m every minute reaches −18m after 9 minutes: −18 ÷ −2 = 9...',
        },
      },
    ],
  },
}
