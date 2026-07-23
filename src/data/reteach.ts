import type { CSSProperties } from 'react'
import { FONT_MONO } from '../theme'
import type { Problem } from './problems'
import { topicLabel } from './curriculum'

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
 * The worked-example steps always come from `problem.lines` - the actual
 * problem the student just attempted - never a hardcoded equation, so the
 * card can't show a walk-back for a different problem than the one on
 * screen. The specific "what went wrong" sentence is pulled from
 * `problem.solNotes[problem.errIdx]` where the original had it hand-written;
 * elsewhere the prose stays generic rather than guessing a per-problem moral
 * ("watch the sign", "isolate the term"...) that would need its own content
 * pass to get right for every family in the problem bank.
 */
export function buildReteach(line: number | 'all', reason: string | undefined, problem: Problem): ReteachCard {
  const topic = topicLabel(problem.topic)
  const errNote = problem.solNotes[problem.errIdx] || 'that step is where it slipped'

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
      exampleSteps: problem.lines,
      route: `Routed to: ${topic} - the foundation this builds on.`,
      cta: 'Walk through a similar one →',
    }
  }
  if (line !== problem.errIdx) {
    return {
      ...scope('Focused re-teach'),
      heading: 'That line is actually fine',
      body: [
        `The line you picked is correct. The step that slipped is line ${problem.errIdx + 1} - ${errNote}.`,
        'That’s useful to know - we check what you tell us against your wider pattern, and here the real error is elsewhere.',
      ],
      hasExample: true,
      exampleTitle: 'The full worked solution',
      exampleSteps: problem.lines,
      route: `Routed to: ${topic} - line ${problem.errIdx + 1} is the step to revisit.`,
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
      exampleSteps: problem.lines,
      route: 'Logged - your teacher can still see the pattern if it repeats.',
      cta: 'Next problem →',
    }
  }
  return {
    ...scope('Focused re-teach'),
    heading: `Let’s look at line ${problem.errIdx + 1} again`,
    body: [
      `Here’s the key step: ${errNote}. We’ll give you a couple of these before returning to the full problem.`,
    ],
    hasExample: true,
    exampleTitle: 'Same problem, worked through',
    exampleSteps: problem.lines,
    route: `Routed to: ${topic} on your map.`,
    cta: 'Practise this step →',
  }
}
