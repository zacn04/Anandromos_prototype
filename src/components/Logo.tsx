/** Anadromos mark — a stylised anadromous fish swimming back upstream, with arrow. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path
        d="M6 22 C 12 12, 26 12, 33 20 C 27 15, 15 16, 10 24 C 9 22, 7 22, 6 22 Z"
        fill="#dd6a2f"
      />
      <path d="M31 20 l6 -5 l0 10 z" fill="#dd6a2f" />
      <circle cx="14" cy="20" r="1.6" fill="#0e2a43" />
    </svg>
  )
}
