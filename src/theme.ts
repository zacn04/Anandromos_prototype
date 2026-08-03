import type { CSSProperties } from 'react'
import type { NodeStatus, NodeStyle, OversightKind, OversightKindStyle } from './content/schema'

/**
 * Anadromos design tokens — nautical palette over driftwood/paper surfaces.
 * Sources: design_handoff_anadromos/README.md "Design Tokens".
 */
export const color = {
  // deep navy chrome / primary
  navy: '#0e2a43',
  navy2: '#1f4e75',
  midBlue: '#3f82ab',
  midBlue2: '#4a86ad',
  nodeBlue: '#7fb0cd',
  teal: '#2f6f92',
  // scarce orange (attention, primary actions, frontier)
  orange: '#dd6a2f',
  orangeDeep: '#b6531f',
  orangeSoft: '#fdf0e6',
  orangeSoft2: '#fbe7d8',
  orangeBorder: '#f0d3bc',
  orangeBorder2: '#eecab0',
  // driftwood / paper surfaces
  page: '#fbf9f5',
  paper: '#f6f1e7',
  card: '#fff',
  warm: '#faf6ee',
  warm2: '#fbf3ea',
  sand: '#efe7d9',
  sand2: '#f2ece0',
  border: '#e4dccb',
  border2: '#ece3d2',
  border3: '#d8cbb2',
  // blue info panel
  infoBg: '#eef3f7',
  infoBg2: '#e4edf3',
  infoBorder: '#d3e0ea',
  infoBorder2: '#cddceb',
  infoText: '#2b4a63',
  // neutral text
  ink: '#1a2129',
  body: '#5c6773',
  muted: '#8a7c63',
  faint: '#a99e88',
} as const

export const FONT_SERIF = "'Spectral',serif"
export const FONT_MONO = "'IBM Plex Mono',monospace"

/** Uppercase, letterspaced mono label used for captions and metadata. */
export const monoLabel = (
  fontSize: number,
  clr: string,
  letterSpacing = '.5px',
  extra: CSSProperties = {},
): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize,
  letterSpacing,
  textTransform: 'uppercase',
  color: clr,
  ...extra,
})

/** Spectral display heading in deep navy. */
export const serifHeading = (fontSize: number, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_SERIF,
  fontWeight: 600,
  fontSize,
  color: color.navy,
  ...extra,
})

// ---------------------------------------------------------------------------
// Palettes keyed by a domain enum. Design tokens, not curriculum content, so
// they live here rather than in `content/` — see §3.11 of
// docs/content-schema-spec.md. Values are byte-for-byte the ones they replace.
// ---------------------------------------------------------------------------

/**
 * Knowledge-graph node fill/stroke/text per mastery status. Was `ST` in
 * `data/knowledgeGraph.ts` (renamed: `ST` is unreadable in a token file).
 * Hex values are kept literal rather than re-pointed at `color.*` so the move
 * cannot change a single rendered pixel.
 */
export const NODE_STYLE: Record<NodeStatus, NodeStyle> = {
  mastered: { fill: '#1f4e75', stroke: '#1f4e75', text: '#ffffff', sw: 1.5, dash: '' },
  inprogress: { fill: '#7fb0cd', stroke: '#3f82ab', text: '#0e2a43', sw: 1.5, dash: '' },
  frontier: { fill: '#fdf0e6', stroke: '#dd6a2f', text: '#b6531f', sw: 2.5, dash: '' },
  notready: { fill: '#efe7d9', stroke: '#d8cbb2', text: '#8a7c63', sw: 1.5, dash: '' },
  locked: { fill: '#f2ede2', stroke: '#ddd2bd', text: '#a99e88', sw: 1.5, dash: '4 4' },
}

/** Badge label and colours per Oversight kind. Moved from `data/oversight.ts`. */
export const OVERSIGHT_KIND_META: Record<OversightKind, OversightKindStyle> = {
  uncertain: { label: 'Uncertain diagnosis', color: '#b6531f', bg: '#fbe7d8', bd: '#eecab0' },
  gaming: { label: 'Possible gaming', color: '#b6531f', bg: '#fbe7d8', bd: '#eecab0' },
  probe: { label: 'Worth a look', color: '#1f4e75', bg: '#e4edf3', bd: '#cddceb' },
}
