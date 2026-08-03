/**
 * Behavioural smoke test for the Phase 3 engine additions: the due queue
 * (`data/schedule.ts`), cross-topic credit (`data/engine.ts`) and the XP model
 * (`data/xp.ts`).
 *
 * Not a substitute for a test framework - the project has none - but enough to
 * prove the logic does what its comments claim, rather than merely typechecking.
 * Run with `npm run smoke:engine`. Exits non-zero on the first failure.
 */
import { loadContent } from '../src/content/load.ts'
import { initEngineState, recordAttempt, dueInDays } from '../src/data/engine.ts'
import type { EngineState } from '../src/data/engine.ts'
import { buildQueue, dueLabel, DAILY_ITEM_CAP } from '../src/data/schedule.ts'
import { sessionXp, totalXp, needsRelesson, masteryBand } from '../src/data/xp.ts'
import { suggestedOrder, orderWarnings, missingPrereqs } from '../src/data/basket.ts'
import { exportProfile, importProfile, importSummary } from '../src/data/transfer.ts'
import { contentMeta } from '../src/content/index.ts'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  [32m✓[0m ${name}`)
  } else {
    failures++
    console.log(`  [31m✗[0m ${name}${detail ? `\n      ${detail}` : ''}`)
  }
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 3)

await loadContent()

// ---------------------------------------------------------------------------
console.log('\nschedule · ordering and cap')
// ---------------------------------------------------------------------------
{
  const state: EngineState = {
    nodes: {
      'num.fractions': { status: 'mastered', last: '', next: '', reps: 5, dueAt: NOW - 11 * DAY },
      'num.decimals': { status: 'mastered', last: '', next: '', reps: 5, dueAt: NOW - 2 * DAY },
      'num.ratio': { status: 'inprogress', last: '', next: '', reps: 3, dueAt: NOW },
      'alg.linear': { status: 'frontier', last: '', next: '', reps: 0, dueAt: NOW },
      'num.surds': { status: 'notready', last: '', next: '', reps: 0, dueAt: NOW - 5 * DAY },
      'alg.simultaneous': { status: 'locked', last: '', next: '', reps: 0, dueAt: NOW - 5 * DAY },
      'num.proportion': { status: 'mastered', last: '', next: '', reps: 4, dueAt: NOW + 6 * DAY },
    },
    masteryByTopic: {},
  }

  const q = buildQueue(state, { now: NOW })
  const ids = q.items.map((i) => i.id)

  check('most-overdue review sorts first', ids[0] === 'review:num.fractions', `got ${ids[0]}`)
  check('second-most-overdue next', ids[1] === 'review:num.decimals', `got ${ids[1]}`)
  check('due-today review beats frontier lesson',
    ids.indexOf('review:num.ratio') < ids.indexOf('lesson:alg.linear'),
    `order: ${ids.join(', ')}`)
  check('notready topic is never queued', !ids.includes('review:num.surds'))
  check('locked topic is never queued', !ids.includes('review:alg.simultaneous'))
  check('not-yet-due review is not queued', !ids.includes('review:num.proportion'))
  check('overdue label is undramatic', dueLabel(q.items[0]) === '11 days ago', dueLabel(q.items[0]))
  check('nothing due reads as clear', buildQueue({ nodes: {}, masteryByTopic: {} }, { now: NOW }).clear)
}

// ---------------------------------------------------------------------------
console.log('\nschedule · daily cap and problem sets')
// ---------------------------------------------------------------------------
{
  const nodes: EngineState['nodes'] = {}
  // Every topic here must have a question bank: buildQueue deliberately skips
  // a review it cannot serve, so topics without one would be filtered out and
  // this would be testing the filter rather than the cap.
  for (const t of ['num.fractions', 'num.decimals', 'num.fractions-to-percent', 'num.ratio',
                   'num.percent-change', 'num.negatives-arithmetic', 'alg.substitution', 'alg.linear']) {
    nodes[t] = { status: 'mastered', last: '', next: '', reps: 5, dueAt: NOW - DAY }
  }
  const state: EngineState = { nodes, masteryByTopic: {} }

  const capped = buildQueue(state, { now: NOW, cap: 3 })
  check('cap limits what is shown', capped.items.length === 3, `got ${capped.items.length}`)
  check('the rest are deferred, not dropped', capped.deferred === 5, `got ${capped.deferred}`)
  check('default cap is a sitting, not a backlog', DAILY_ITEM_CAP === 12)

  const urgent = buildQueue(state, {
    now: NOW,
    problemSets: [
      { id: 'ps1', title: 'Due soon', dueInDays: 1, unlocked: true },
      { id: 'ps2', title: 'Due later', dueInDays: 20, unlocked: true },
      { id: 'ps3', title: 'Locked set', dueInDays: 1, unlocked: false },
    ],
  })
  const uids = urgent.items.map((i) => i.id)
  check('locked problem set is not queued', !uids.includes('problemSet:ps3'))
  check('urgent problem set outranks a far-off one',
    uids.indexOf('problemSet:ps1') < uids.indexOf('problemSet:ps2'))
  check('overdue review still outranks urgent homework',
    uids.indexOf('review:num.decimals') < uids.indexOf('problemSet:ps1'),
    `order: ${uids.join(', ')}`)
}

// ---------------------------------------------------------------------------
console.log('\nschedule · finishing something actually changes the queue')
// ---------------------------------------------------------------------------
{
  // Regression: buildQueue used to push a frontier topic as a lesson with no
  // due-date check. `status` stays 'frontier' until mastery crosses the
  // promotion threshold, so finishing a lesson put the identical row straight
  // back at the top of the path — "I finished it and nothing changed".
  const state: EngineState = {
    nodes: {
      'alg.linear': { status: 'frontier', last: '', next: '', reps: 0, dueAt: NOW },
    },
    masteryByTopic: { 'alg.linear': { foundations: 0.9, core: 0.9, stretch: 0.9 } },
  }

  const before = buildQueue(state, { now: NOW })
  check('an unattempted frontier topic is offered as a lesson',
    before.items[0]?.kind === 'lesson', before.items[0]?.kind)

  const after = recordAttempt(state, { topicId: 'alg.linear', difficulty: 'core', correct: true }, NOW)
  const q = buildQueue(after, { now: NOW })
  check('after attempting it, the lesson is no longer queued',
    !q.items.some((i) => i.id === 'lesson:alg.linear'),
    q.items.map((i) => i.id).join(', '))
  check('and it is not immediately due as a review either',
    !q.items.some((i) => i.id === 'review:alg.linear'),
    q.items.map((i) => i.id).join(', '))

  // But a student whose mastery has decayed IS sent back to the lesson
  // (build-plan §3.3), rather than made to keep failing reviews.
  const decayed: EngineState = {
    nodes: { 'alg.linear': { status: 'frontier', last: '', next: '', reps: 9, dueAt: NOW } },
    masteryByTopic: { 'alg.linear': { foundations: 0.2, core: 0.1, stretch: 0 } },
  }
  // Regression: the queue used to offer reviews for topics with no question
  // bank, so the row dead-ended in "not built out yet" when clicked.
  const undeliverable: EngineState = {
    nodes: { 'num.surds': { status: 'mastered', last: '', next: '', reps: 4, dueAt: NOW - DAY } },
    masteryByTopic: {},
  }
  check('a review with no question bank behind it is never queued',
    buildQueue(undeliverable, { now: NOW }).items.length === 0,
    buildQueue(undeliverable, { now: NOW }).items.map((i) => i.id).join(', '))
  check('and that reads as caught-up, not as an error',
    buildQueue(undeliverable, { now: NOW }).clear)

  check('weak mastery re-offers the lesson even with reps banked',
    buildQueue(decayed, { now: NOW }).items[0]?.kind === 'lesson',
    buildQueue(decayed, { now: NOW }).items[0]?.kind)
}

// ---------------------------------------------------------------------------
console.log('\nengine · cross-topic credit')
// ---------------------------------------------------------------------------
{
  const base = initEngineState('aisha')

  // Upward: a percentage question whose line 1 is answered correctly and is
  // tagged `num.fractions.to-decimal` - a subtopic owned by a DIFFERENT topic.
  // `num.fractions` carries no seeded mastery row, so it starts at 0 and any
  // movement is unambiguously the credit firing.
  const up = recordAttempt(base, {
    topicId: 'num.fractions-to-percent',
    difficulty: 'core',
    correct: true,
    subtopicId: 'num.fractions-to-percent.convert',
    lineOutcomes: [
      { lineIndex: 0, correct: true, prereqSubtopicIds: ['num.fractions.to-decimal'] },
    ],
  }, NOW)

  const upBefore = base.masteryByTopic['num.fractions']?.foundations ?? 0
  const upAfter = up.masteryByTopic['num.fractions']?.foundations ?? 0
  check('a correct line credits its prerequisite topic', upAfter > upBefore,
    `num.fractions foundations ${upBefore} -> ${upAfter}`)

  // Downward, on a topic that actually has mastery to lose. Aisha is seeded
  // at foundations 1.0 on num.negatives.
  const down = recordAttempt(base, {
    topicId: 'alg.linear',
    difficulty: 'core',
    correct: true,
    lineOutcomes: [
      { lineIndex: 0, correct: false, prereqSubtopicIds: ['num.negatives.number-line'] },
    ],
  }, NOW)

  const dnBefore = base.masteryByTopic['num.negatives']?.foundations ?? 0
  const dnAfter = down.masteryByTopic['num.negatives']?.foundations ?? 0
  check('a failed line moves its prerequisite topic down', dnAfter < dnBefore,
    `num.negatives foundations ${dnBefore} -> ${dnAfter}`)
  check('credit is damped, not a full-strength hit', dnBefore - dnAfter < 0.3,
    `dropped by ${(dnBefore - dnAfter).toFixed(3)}`)
  check('the prerequisite reads as recently practised',
    down.nodes['num.negatives']?.last === 'today · cross-topic',
    down.nodes['num.negatives']?.last)
  check('cross-topic credit banks no free rep',
    down.nodes['num.negatives']?.reps === base.nodes['num.negatives']?.reps)
  check('cross-topic credit does not push the review out',
    down.nodes['num.negatives']?.dueAt === base.nodes['num.negatives']?.dueAt)

  // The attempted topic itself must not be double-counted via its own tags.
  const selfTagged = recordAttempt(base, {
    topicId: 'num.fractions',
    difficulty: 'core',
    correct: true,
    lineOutcomes: [
      { lineIndex: 0, correct: true, prereqSubtopicIds: ['num.fractions.to-decimal'] },
    ],
  }, NOW)
  const plain = recordAttempt(base, {
    topicId: 'num.fractions', difficulty: 'core', correct: true,
  }, NOW)
  check('a tag naming the question\'s own topic is not double-counted',
    selfTagged.masteryByTopic['num.fractions'].core === plain.masteryByTopic['num.fractions'].core)

  check('an untagged attempt still behaves exactly as before',
    plain.nodes['num.fractions'].reps === base.nodes['num.fractions'].reps + 1)
  check('recordAttempt now stamps an absolute due date',
    typeof plain.nodes['num.fractions'].dueAt === 'number')
  check('dueInDays reads the stamp back',
    dueInDays(plain.nodes['num.fractions'], NOW) >= 1)
}

// ---------------------------------------------------------------------------
console.log('\nxp · effort, not mastery')
// ---------------------------------------------------------------------------
{
  const perfectReview = sessionXp({ kind: 'review', correct: 10, total: 10 })
  const halfReview = sessionXp({ kind: 'review', correct: 5, total: 10 })
  const zeroReview = sessionXp({ kind: 'review', correct: 0, total: 10 })
  const perfectFree = sessionXp({ kind: 'freeplay', correct: 10, total: 10 })

  check('a perfect review pays full base', perfectReview === 100, `got ${perfectReview}`)
  check('XP scales with accuracy', halfReview < perfectReview && halfReview > zeroReview,
    `${zeroReview} < ${halfReview} < ${perfectReview}`)
  check('turning up still pays something', zeroReview > 0, `got ${zeroReview}`)
  check('review outpays free play at equal accuracy', perfectReview > perfectFree,
    `${perfectReview} vs ${perfectFree}`)
  check('an empty session pays nothing', sessionXp({ kind: 'review', correct: 0, total: 0 }) === 0)
  check('totals accumulate', totalXp([
    { kind: 'review', correct: 10, total: 10 },
    { kind: 'freeplay', correct: 10, total: 10 },
  ]) === perfectReview + perfectFree)

  check('re-lesson triggers on weak mastery',
    needsRelesson({ foundations: 0.2, core: 0.1, stretch: 0.0 }))
  check('re-lesson does not trigger on strong mastery',
    !needsRelesson({ foundations: 0.9, core: 0.8, stretch: 0.7 }))
  check('unknown mastery does not trigger a re-lesson', !needsRelesson(undefined))
  check('bands read relearn / building / mastered',
    masteryBand({ foundations: 0.1, core: 0.1, stretch: 0.1 }) === 'relearn' &&
    masteryBand({ foundations: 0.6, core: 0.6, stretch: 0.6 }) === 'building' &&
    masteryBand({ foundations: 0.9, core: 0.9, stretch: 0.9 }) === 'mastered')

  // The point of the module: a farmed-easy-items profile must not read as mastered.
  check('high foundations alone does not read as mastered',
    masteryBand({ foundations: 1, core: 0.2, stretch: 0 }) !== 'mastered')
}

// ---------------------------------------------------------------------------
console.log('\nbasket · suggested order and warnings')
// ---------------------------------------------------------------------------
{
  // Real edges: alg.basics -> alg.substitution -> alg.linear -> alg.bracket-equations,
  // and alg.expanding -> alg.bracket-equations.
  const basket = ['alg.bracket-equations', 'alg.linear', 'alg.basics', 'alg.substitution', 'alg.expanding']
  const order = suggestedOrder(basket)
  const at = (id: string) => order.indexOf(id)

  check('suggested order places every basket topic', order.length === basket.length,
    `got ${order.length}`)
  check('a prerequisite chain is respected end to end',
    at('alg.basics') < at('alg.substitution') &&
    at('alg.substitution') < at('alg.linear') &&
    at('alg.linear') < at('alg.bracket-equations'),
    order.join(' -> '))
  check('a second prerequisite of the same topic is also respected',
    at('alg.expanding') < at('alg.bracket-equations'), order.join(' -> '))
  check('suggested order is warning-free', orderWarnings(order).length === 0,
    JSON.stringify(orderWarnings(order).map((w) => `${w.prereqLabel} after ${w.topicLabel}`)))
  check('suggested order does not depend on input order',
    suggestedOrder(basket).join() === suggestedOrder([...basket].reverse()).join(),
    `${suggestedOrder(basket).join()} vs ${suggestedOrder([...basket].reverse()).join()}`)

  // A teacher order that puts the dependent topic first.
  const warned = orderWarnings(['alg.bracket-equations', 'alg.linear', 'alg.expanding'])
  check('an order that inverts a dependency warns', warned.length === 2,
    `got ${warned.length}: ${JSON.stringify(warned.map((w) => `${w.prereqLabel} after ${w.topicLabel}`))}`)
  check('the warning names both sides and their positions',
    warned.every((w) => w.topicLabel && w.prereqLabel && w.prereqPosition > w.position))

  const missing = missingPrereqs(['alg.bracket-equations'])
  const missingIds = missing.map((m) => m.prereqId).sort()
  check('prerequisites outside the basket are surfaced',
    missingIds.join() === 'alg.expanding,alg.linear', JSON.stringify(missingIds))
  check('a basket containing its own prerequisites reports none missing',
    missingPrereqs(['alg.bracket-equations', 'alg.linear', 'alg.expanding'])
      .every((m) => m.prereqId !== 'alg.linear' && m.prereqId !== 'alg.expanding'))
}

// ---------------------------------------------------------------------------
console.log('\ntransfer · portable profiles')
// ---------------------------------------------------------------------------
{
  const state = initEngineState('aisha')
  const exported = exportProfile('aisha', state, '2026-08-03T00:00:00.000Z')

  check('export stamps the graph it was computed against',
    exported.topicGraphVersion === contentMeta().topicGraphVersion &&
    exported.subtopicGraphVersion === contentMeta().subtopicGraphVersion)
  check('export survives a JSON round-trip',
    JSON.parse(JSON.stringify(exported)).studentId === 'aisha')
  check('export copies rather than references engine state',
    exported.nodeStates !== state.nodes)

  const clean = importProfile(exported)
  check('a same-version import is exact', clean.exact)
  check('a same-version import raises no issues', clean.issues.length === 0,
    JSON.stringify(clean.issues.map((i) => i.kind)))
  check('every topic carries over',
    clean.imported === Object.keys(state.nodes).length, `got ${clean.imported}`)

  const stale = importProfile({ ...exported, topicGraphVersion: 'topic-graph-2020-01-01.0' })
  check('a different graph version is not silently accepted', !stale.exact)
  check('the mismatch is reported to the receiving teacher',
    stale.issues.some((i) => i.kind === 'topic-graph-changed'))
  check('a stale profile still imports its topics', stale.imported === clean.imported)

  const ghost = importProfile({
    ...exported,
    nodeStates: { ...exported.nodeStates, 'num.does-not-exist': { status: 'mastered', last: '', next: '', reps: 1 } },
  })
  check('a topic this school does not have is dropped, not dangling', ghost.dropped === 1)
  check('the drop is explained', ghost.issues.some((i) => i.kind === 'unknown-topic'))
  check('summary reads for a human', importSummary(ghost).includes('dropped'), importSummary(ghost))
}

if (failures === 0) {
  console.log('\n\u001b[32mAll engine smoke checks passed.\u001b[0m\n')
} else {
  // Thrown rather than `process.exit`: this module is typechecked under the app
  // tsconfig (bundler resolution, no node types) because it imports from src/,
  // and the runner turns a rejected module load into a non-zero exit anyway.
  throw new Error(`${failures} engine smoke check(s) failed`)
}
