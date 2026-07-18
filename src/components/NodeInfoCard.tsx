import { FONT_MONO, FONT_SERIF } from '../theme'

export interface NodeInfoField {
  label: string
  value: string | number
  color?: string
}

/** Detail strip shown under a knowledge graph when a subtopic node is selected. */
export function NodeInfoCard({
  heading,
  title,
  fields,
  onClose,
}: {
  heading: string
  title: string
  fields: NodeInfoField[]
  onClose: () => void
}) {
  return (
    <div
      style={{
        marginTop: 14,
        background: '#fff',
        border: '1px solid #dd6a2f',
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 26,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 150 }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: '.5px',
            textTransform: 'uppercase',
            color: '#8a7c63',
          }}
        >
          {heading}
        </div>
        <div style={{ fontFamily: FONT_SERIF, fontSize: 17, fontWeight: 600, color: '#0e2a43' }}>
          {title}
        </div>
      </div>
      {fields.map((f) => (
        <div key={f.label}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: '.5px',
              textTransform: 'uppercase',
              color: '#8a7c63',
              marginBottom: 3,
            }}
          >
            {f.label}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: f.color ?? '#1a2129' }}>{f.value}</div>
        </div>
      ))}
      <button
        onClick={onClose}
        style={{
          marginLeft: 'auto',
          background: '#f2ece0',
          border: '1px solid #ddd2bd',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 12.5,
          fontWeight: 600,
          color: '#5c6773',
          cursor: 'pointer',
        }}
      >
        Close
      </button>
    </div>
  )
}
