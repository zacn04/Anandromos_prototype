/**
 * Transferable student profiles (build-plan §5.2).
 *
 * When a student changes school, changes set, or moves up a year, the receiving
 * teacher should immediately know where they stand. That only works if a
 * profile means the same thing on both sides, which is why every export carries
 * the graph versions it was computed against.
 *
 * The versions are the whole point. A profile says "topic `alg.linear` was
 * mastered" - but `alg.linear` only means something if the receiving school's
 * content bundle has the same topic under the same id, reached through the same
 * prerequisites. If the graph moved underneath, the receiving teacher needs to
 * know that before trusting a single number. `importProfile` therefore never
 * silently accepts a mismatched profile: it imports what it safely can and
 * returns everything it could not.
 *
 * Pure logic - no React, no persistence. Serialisable to plain JSON.
 */
import { contentMeta, topicById, topicLabel } from '../content'
import type { TopicId } from '../content'
import type { EngineNodeState, EngineState, TierMastery } from './engine'

/** Bumped when the wire format itself changes, independently of graph versions. */
export const TRANSFER_FORMAT_VERSION = 1

export interface TransferableProfile {
  formatVersion: number
  studentId: string
  /** ISO-8601. Supplied by the caller so this module stays deterministic. */
  exportedAt: string
  /** The graph the numbers below were computed against. */
  topicGraphVersion: string
  subtopicGraphVersion: string
  contentVersion: string
  nodeStates: Record<TopicId, EngineNodeState>
  masteryByTopic: Record<TopicId, TierMastery>
}

export function exportProfile(
  studentId: string,
  state: EngineState,
  exportedAt: string,
): TransferableProfile {
  const meta = contentMeta()
  return {
    formatVersion: TRANSFER_FORMAT_VERSION,
    studentId,
    exportedAt,
    topicGraphVersion: meta.topicGraphVersion,
    subtopicGraphVersion: meta.subtopicGraphVersion,
    contentVersion: meta.contentVersion,
    // Copied, not referenced, so a later attempt cannot mutate an export.
    nodeStates: { ...state.nodes },
    masteryByTopic: { ...state.masteryByTopic },
  }
}

export type TransferIssueKind =
  | 'format-version'
  | 'topic-graph-changed'
  | 'subtopic-graph-changed'
  | 'unknown-topic'

export interface TransferIssue {
  kind: TransferIssueKind
  /** Present for per-topic issues. */
  topicId?: TopicId
  message: string
}

export interface ImportResult {
  state: EngineState
  issues: readonly TransferIssue[]
  /** Topics carried over. */
  imported: number
  /** Topics dropped because this bundle has no such topic. */
  dropped: number
  /**
   * True when the profile was computed against exactly this content. When
   * false the numbers are still usable, but the receiving teacher is looking
   * at a profile from a different graph and the UI must say so.
   */
  exact: boolean
}

/**
 * Rebuilds engine state from a transferred profile against *this* bundle's
 * graph.
 *
 * Topics the local bundle does not have are dropped rather than carried as
 * dangling ids - a profile referencing a topic that no longer exists would
 * otherwise render as a blank row in the receiving teacher's drill-down with no
 * explanation. Every drop is reported.
 */
export function importProfile(profile: TransferableProfile): ImportResult {
  const meta = contentMeta()
  const issues: TransferIssue[] = []

  if (profile.formatVersion !== TRANSFER_FORMAT_VERSION) {
    issues.push({
      kind: 'format-version',
      message:
        `Profile uses transfer format v${profile.formatVersion}; this platform reads ` +
        `v${TRANSFER_FORMAT_VERSION}. Some fields may be missing.`,
    })
  }
  if (profile.topicGraphVersion !== meta.topicGraphVersion) {
    issues.push({
      kind: 'topic-graph-changed',
      message:
        `Computed against topic graph ${profile.topicGraphVersion}; this school is on ` +
        `${meta.topicGraphVersion}. Prerequisites may differ, so "ready to learn" may not match.`,
    })
  }
  if (profile.subtopicGraphVersion !== meta.subtopicGraphVersion) {
    issues.push({
      kind: 'subtopic-graph-changed',
      message:
        `Computed against subtopic graph ${profile.subtopicGraphVersion}; this school is on ` +
        `${meta.subtopicGraphVersion}. Gap-level detail may be incomplete.`,
    })
  }

  const nodes: Record<TopicId, EngineNodeState> = {}
  let dropped = 0
  for (const topicId of Object.keys(profile.nodeStates ?? {})) {
    if (!topicById(topicId)) {
      dropped++
      issues.push({
        kind: 'unknown-topic',
        topicId,
        message: `No topic "${topicId}" in this school's curriculum - dropped from the profile.`,
      })
      continue
    }
    nodes[topicId] = { ...profile.nodeStates[topicId] }
  }

  const masteryByTopic: Record<TopicId, TierMastery> = {}
  for (const topicId of Object.keys(profile.masteryByTopic ?? {})) {
    if (!topicById(topicId)) continue
    masteryByTopic[topicId] = { ...profile.masteryByTopic[topicId] }
  }

  return {
    state: { nodes, masteryByTopic },
    issues,
    imported: Object.keys(nodes).length,
    dropped,
    exact:
      profile.topicGraphVersion === meta.topicGraphVersion &&
      profile.subtopicGraphVersion === meta.subtopicGraphVersion &&
      profile.formatVersion === TRANSFER_FORMAT_VERSION,
  }
}

/**
 * A one-line human summary for the receiving teacher, e.g.
 * "34 topics imported from a different graph version - 2 topics dropped".
 */
export function importSummary(result: ImportResult): string {
  const parts = [`${result.imported} topic${result.imported === 1 ? '' : 's'} imported`]
  if (!result.exact) parts.push('from a different graph version')
  if (result.dropped > 0) {
    parts.push(`${result.dropped} topic${result.dropped === 1 ? '' : 's'} dropped`)
  }
  return parts.join(' · ')
}

/** Topics in the imported profile that this school's basket does not cover. */
export function outsideBasket(
  result: ImportResult,
  basket: readonly TopicId[],
): readonly { topicId: TopicId; label: string }[] {
  const inBasket = new Set(basket)
  return Object.keys(result.state.nodes)
    .filter((id) => !inBasket.has(id))
    .map((id) => ({ topicId: id, label: topicLabel(id) }))
}
