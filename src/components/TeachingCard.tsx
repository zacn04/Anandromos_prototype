import { FONT_MONO, FONT_SERIF } from '../theme'

export interface TeachingCardProps {
  heading: string
  body: string[]
  exampleTitle?: string
  exampleSteps?: string[]
}

/**
 * A heading + prose + optional worked-example block. Shared by the practice
 * loop's re-teach cards and the Lesson mechanic's "teach a concept" screen -
 * both are the same shape of content, just reached from different places.
 */
export function TeachingCard({ heading, body, exampleTitle, exampleSteps }: TeachingCardProps) {
  return (
    <>
      <h3 style={{ fontFamily: FONT_SERIF, fontSize: 19, fontWeight: 600, color: '#0e2a43', margin: '0 0 8px' }}>{heading}</h3>
      {body.map((para, i) => (
        <p key={i} style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.6, color: '#3f4a54', textWrap: 'pretty' }}>
          {para}
        </p>
      ))}
      {!!exampleSteps?.length && (
        <div style={{ marginTop: 6, background: '#f6f1e7', border: '1px solid #e4dccb', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.6px', textTransform: 'uppercase', color: '#8a7c63', marginBottom: 10 }}>
            {exampleTitle}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {exampleSteps.map((step, i) => (
              <div key={i} style={{ fontFamily: FONT_SERIF, fontSize: 17, color: '#1a2129' }}>
                {step}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
