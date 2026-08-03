import { FONT_MONO, FONT_SERIF } from '../theme'
import { subtopicsForTopic, prereqsOf, topicLabel } from '../content'
import type { TopicId } from '../content'

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
  topicId,
}: {
  heading: string
  title: string
  fields: NodeInfoField[]
  onClose: () => void
  /**
   * When given, the card also lists what this topic is actually made of and
   * what it builds on. The graph draws topics; the subtopics underneath are
   * where the real curriculum detail lives, and without this they are
   * invisible in the product.
   */
  topicId?: TopicId
}) {
  const subs = topicId ? subtopicsForTopic(topicId) : []
  const prereqs = topicId ? prereqsOf(topicId) : []
  return (
    <div
      style={{
        marginTop: 14,
        background: '#fff',
        border: '1px solid #dd6a2f',
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        gap: 26,
        flexWrap: 'wrap',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
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

      {(subs.length > 0 || prereqs.length > 0) && (
        <div style={{ borderTop: '1px solid #f0e6d6', paddingTop: 13, display: 'flex', gap: 30, flexWrap: 'wrap' }}>
          {prereqs.length > 0 && (
            <div style={{ minWidth: 190 }}>
              <div style={labelStyle}>Builds on</div>
              <div style={{ fontSize: 13, color: '#2b4a63', lineHeight: 1.6 }}>
                {prereqs.map((id) => topicLabel(id)).join(' · ')}
              </div>
            </div>
          )}
          {subs.length > 0 && (
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={labelStyle}>
                What's in it · {subs.length} subtopic{subs.length === 1 ? '' : 's'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {subs.map((su) => (
                  <span
                    key={su.id}
                    title={su.id}
                    style={{
                      fontSize: 12.5,
                      color: '#2b4a63',
                      background: '#eef3f7',
                      border: '1px solid #d3e0ea',
                      borderRadius: 20,
                      padding: '4px 11px',
                    }}
                  >
                    {su.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const labelStyle = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: '.5px',
  textTransform: 'uppercase' as const,
  color: '#8a7c63',
  marginBottom: 5,
}
