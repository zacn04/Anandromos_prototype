import type { CSSProperties } from 'react'

export interface SvgEdge {
  d: string
  stroke: string
  sw: number
  op?: number
}

export interface SvgNode {
  id: string
  x: number
  y: number
  tx: number
  ty: number
  label: string
  fill: string
  stroke: string
  text: string
  sw: number
  dash: string
  op?: number
  onClick?: () => void
}

/** Renders a knowledge graph as SVG: prerequisite edges under clickable topic nodes. */
export function GraphSvg({
  edges,
  nodes,
  width = '100%',
  style,
}: {
  edges: SvgEdge[]
  nodes: SvgNode[]
  width?: string | number
  style?: CSSProperties
}) {
  return (
    <svg viewBox="0 0 820 420" width={width} style={{ display: 'block', ...style }}>
      {edges.map((e, i) => (
        <path key={i} d={e.d} fill="none" stroke={e.stroke} strokeWidth={e.sw} opacity={e.op} />
      ))}
      {nodes.map((n) => (
        <g key={n.id} opacity={n.op} onClick={n.onClick} style={{ cursor: 'pointer' }}>
          <rect
            x={n.x}
            y={n.y}
            width={132}
            height={42}
            rx={9}
            fill={n.fill}
            stroke={n.stroke}
            strokeWidth={n.sw}
            strokeDasharray={n.dash || undefined}
          />
          <text
            x={n.tx}
            y={n.ty}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="Public Sans, sans-serif"
            fontSize={11}
            fontWeight={600}
            fill={n.text}
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
