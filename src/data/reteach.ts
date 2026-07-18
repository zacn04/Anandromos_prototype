import type { CSSProperties } from 'react'
import { FONT_MONO } from '../theme'

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
 */
export function buildReteach(
  line: number | 'all',
  reason: string | undefined,
  errIdx: number,
): ReteachCard {
  if (reason === 'slip') {
    return {
      ...scope('No re-teach needed'),
      heading: 'Looks like a slip',
      body: [
        'We’ve fixed the line you flagged and kept the rest of your working. A slip like this won’t count against your mastery of linear equations.',
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
        'An equation is a balance: whatever you do to one side, you do to the other. To get x on its own, undo what’s around it - one balanced step at a time.',
      ],
      hasExample: true,
      exampleTitle: 'Solve 3x − 7 = 11, balanced',
      exampleSteps: ['3x − 7 = 11', 'Add 7 to both sides → 3x = 18', 'Divide both sides by 3 → x = 6'],
      route: 'Routed to: keeping an equation balanced - the idea underneath this whole topic.',
      cta: 'Walk through a similar one →',
    }
  }
  if (line !== errIdx) {
    return {
      ...scope('Focused re-teach'),
      heading: 'That line is actually fine',
      body: [
        'The line you picked is correct. The step that slipped is line 2, where −7 crossed the equals sign but kept its sign instead of flipping.',
        'That’s useful to know - we check what you tell us against your wider pattern, and here the real error is one line down.',
      ],
      hasExample: true,
      exampleTitle: 'The step that actually slipped',
      exampleSteps: ['3x − 7 = 11', '−7 crosses the = and becomes +7', '3x = 11 + 7 = 18'],
      route: 'Routed to: inverse operations - moving a term across the equals sign.',
      cta: 'Try that step again →',
    }
  }
  if (reason === 'silly') {
    return {
      ...scope('Quick reminder'),
      heading: 'Watch the sign when a term crosses the =',
      body: [
        'You found the right line. A term that moves across the equals sign flips its sign: −7 becomes +7.',
        'Your profile shows you usually get this - so we’ll treat it as a reminder, not a re-teach.',
      ],
      hasExample: true,
      exampleTitle: 'The corrected step',
      exampleSteps: ['3x − 7 = 11', '3x = 11 + 7', '3x = 18 → x = 6'],
      route: 'Logged - but noted: this is the third sign error this fortnight, so your teacher sees the pattern.',
      cta: 'Next problem →',
    }
  }
  return {
    ...scope('Focused re-teach'),
    heading: 'Moving a term to the other side',
    body: [
      'Moving a term across the equals sign is really doing the same thing to both sides. Subtracting 7 on the left means adding 7 on the right - so −7 becomes +7.',
      'We’ll give you a couple of these before returning to the full problem.',
    ],
    hasExample: true,
    exampleTitle: 'Same idea, one step',
    exampleSteps: ['x − 4 = 9', 'Add 4 to both sides', 'x = 13'],
    route: 'Routed to: inverse operations - the prerequisite for linear equations on your map.',
    cta: 'Practise this step →',
  }
}
