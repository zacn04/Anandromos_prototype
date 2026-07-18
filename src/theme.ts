import type { CSSProperties } from 'react'

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
