import type { CSSProperties } from 'react'
import { FONT_MONO } from '../theme'
import type { Question } from '../content'
import { lineTexts, reteachCardFor, topicLabel } from '../content'

/**
 * The re-teach *view model*: what the practice loop renders. Not the same
 * thing as the store's `ReteachCardContent`, which is the authored content
 * entity - this one carries `scopeStyle`, `route` and `cta`, none of which
 * belong in a JSON file.
 */
export interface ReteachCard {
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

function scope(txt: string): Pick<ReteachCard, 'scope' | 'scopeStyle'> {
  const focus = txt === 'Focused re-teach' || txt === 'Full walk-back'
  return {
    scope: txt,
    scopeStyle: {
      display: 'inline-block',
      fontFamily: FONT_MONO,
      fontSize: 10.5,
      letterSpacing: '.6px',
      textTransform: 'uppercase',
      padding: '4px 10px',
      borderRadius: 20,
      fontWeight: 600,
      color: focus ? '#b6531f' : '#1f4e75',
      background: focus ? '#fbe7d8' : '#e4edf3',
      border: `1px solid ${focus ? '#eecab0' : '#cddceb'}`,
    },
  }
}

/**
 * Chooses the re-teach card for one flagged line: scoped to a focused
 * re-teach, quick reminder, full walk-back — or no re-teach for a slip.
 *
 * An authored card for this exact (question, line) wins if the content
 * store has one. `content/curriculum/reteach-cards.json` is empty today, so
 * that branch never fires and the synthesised cards below are what every
 * POV shows; the seam exists so Phase 2's generated cards land as a data
 * drop rather than a code change.
 *
 * The worked-example steps always come from `problem.lines` - the actual
 * problem the student just attempted - never a hardcoded equation, so the
 * card can't show a walk-back for a different problem than the one on
 * screen. The specific "what went wrong" sentence is pulled from the note
 * on `problem.lines[problem.errorLineIndex]` where the original had it
 * hand-written; elsewhere the prose stays generic rather than guessing a
 * per-problem moral ("watch the sign", "isolate the term"...) that would
 * need its own content pass to get right for every family in the question
 * bank.
 */
export function buildReteach(line: number | 'all', reason: string | undefined, problem: Question): ReteachCard {
  const topic = topicLabel(problem.topicId)
  const errNote = problem.lines[problem.errorLineIndex]?.note || 'that step is where it slipped'

  const authored = reteachCardFor(problem.id, line)
  if (authored) {
    return {
      ...scope(authored.scope),
      heading: authored.heading,
      body: [...authored.body],
      hasExample: authored.workedExample !== null,
      exampleTitle: authored.workedExample ? 'Worked through' : undefined,
      exampleSteps: authored.workedExample ? [...authored.workedExample] : undefined,
      route: `Routed to: ${topic} on your map.`,
      cta: 'Practise this step →',
    }
  }

  if (reason === 'slip') {
    return {
      ...scope('No re-teach needed'),
      heading: 'Looks like a slip',
      body: [
        `We’ve fixed the line you flagged and kept the rest of your working. A slip like this won’t count against your mastery of ${topic}.`,
      ],
      hasExample: false,
      route: 'Logged as a slip - your knowledge profile is unchanged.',
      cta: 'Next problem →',
    }
  }
  if (line === 'all') {
    return {
      ...scope('Full walk-back'),
      heading: 'Let’s rebuild this from the start',
      body: [
        'Go through it one balanced step at a time - whatever is done to one side of the problem is done to the other, all the way to the answer.',
      ],
      hasExample: true,
      exampleTitle: `${problem.prompt}: ${problem.statement}, worked through`,
      exampleSteps: lineTexts(problem),
      route: `Routed to: ${topic} - the foundation this builds on.`,
      cta: 'Walk through a similar one →',
    }
  }
  if (line !== problem.errorLineIndex) {
    return {
      ...scope('Focused re-teach'),
      heading: 'That line is actually fine',
      body: [
        `The line you picked is correct. The step that slipped is line ${problem.errorLineIndex + 1} - ${errNote}.`,
        'That’s useful to know - we check what you tell us against your wider pattern, and here the real error is elsewhere.',
      ],
      hasExample: true,
      exampleTitle: 'The full worked solution',
      exampleSteps: lineTexts(problem),
      route: `Routed to: ${topic} - line ${problem.errorLineIndex + 1} is the step to revisit.`,
      cta: 'Try that step again →',
    }
  }
  if (reason === 'silly') {
    return {
      ...scope('Quick reminder'),
      heading: 'Quick reminder on that step',
      body: [
        `You found the right line - ${errNote}. Your profile shows you usually get this, so we’ll treat it as a reminder, not a re-teach.`,
      ],
      hasExample: true,
      exampleTitle: 'The corrected step',
      exampleSteps: lineTexts(problem),
      route: 'Logged - your teacher can still see the pattern if it repeats.',
      cta: 'Next problem →',
    }
  }
  return {
    ...scope('Focused re-teach'),
    heading: `Let’s look at line ${problem.errorLineIndex + 1} again`,
    body: [
      `Here’s the key step: ${errNote}. We’ll give you a couple of these before returning to the full problem.`,
    ],
    hasExample: true,
    exampleTitle: 'Same problem, worked through',
    exampleSteps: lineTexts(problem),
    route: `Routed to: ${topic} on your map.`,
    cta: 'Practise this step →',
  }
}
