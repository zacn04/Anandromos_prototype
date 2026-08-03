/**
 * Cross-topic gaps observed in this session — the product's actual claim, made
 * visible.
 *
 * When a student flags a line of working as wrong, that line carries the
 * prerequisite subtopics it tests (`QuestionLine.prereqSubtopicIds`). If the
 * prerequisite belongs to a *different* topic from the question, we have
 * learned something no score could tell us: the student's difficulty with
 * percentages is actually a fractions gap. This store is where those
 * observations go so the teacher can see them.
 *
 * Same module-singleton-plus-localStorage pattern as `liveOversight.ts` and
 * `liveSessions.ts`: the student and teacher POVs are separate routes with
 * separate React trees, so localStorage is what carries an observation from
 * one to the other within a tab.
 */
import type { SubtopicId, TopicId } from '../content'

const STORAGE_KEY = 'anadromos.liveGaps.v1'

export interface GapObservation {
  /** The prerequisite the student actually stumbled on. */
  subtopicId: SubtopicId
  subtopicLabel: string
  /** The topic that prerequisite belongs to — the real gap. */
  prereqTopicId: TopicId
  prereqTopicLabel: string
  /** The topic of the question they were attempting when it surfaced. */
  seenInTopicId: TopicId
  seenInTopicLabel: string
  /** The line of working they flagged. */
  lineText: string
  /** Why they said it went wrong, if they said. */
  reason?: string
  at: string
}

let gaps: GapObservation[] = load()

function load(): GapObservation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as GapObservation[]) : []
  } catch {
    return []
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gaps))
  } catch {
    // Private-mode / quota failures are not worth taking the app down for.
  }
}

export function pushGap(g: GapObservation): void {
  gaps = [g, ...gaps].slice(0, 50)
  save()
}

export function getGaps(): readonly GapObservation[] {
  return gaps
}

/**
 * Gaps rolled up by the prerequisite topic they point at, commonest first.
 * This is the teacher-facing shape: they do not want fourteen observations,
 * they want "fractions, four times, showing up inside percentages".
 */
export interface GapSummary {
  prereqTopicId: TopicId
  prereqTopicLabel: string
  count: number
  subtopicLabels: string[]
  seenInLabels: string[]
  latest: GapObservation
}

export function summariseGaps(): GapSummary[] {
  const byTopic = new Map<TopicId, GapObservation[]>()
  for (const g of gaps) {
    const bucket = byTopic.get(g.prereqTopicId)
    if (bucket) bucket.push(g)
    else byTopic.set(g.prereqTopicId, [g])
  }
  return [...byTopic.entries()]
    .map(([prereqTopicId, obs]) => ({
      prereqTopicId,
      prereqTopicLabel: obs[0].prereqTopicLabel,
      count: obs.length,
      subtopicLabels: [...new Set(obs.map((o) => o.subtopicLabel))],
      seenInLabels: [...new Set(obs.map((o) => o.seenInTopicLabel))],
      latest: obs[0],
    }))
    .sort((a, b) => b.count - a.count)
}

export function clearGaps(): void {
  gaps = []
  save()
}
