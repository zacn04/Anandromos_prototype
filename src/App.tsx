import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { Logo } from './components/Logo'
import TeacherApp from './teacher/TeacherApp'
import StudentApp from './student/StudentApp'
import ParentApp from './parent/ParentApp'
import { resetAll, hasSavedState, isServerBacked } from './data/persist'
import AdminApp from './admin/AdminApp'
import { studentFirstName, studentName, useStudentName } from './data/profile'
import { FONT_MONO, FONT_SERIF } from './theme'

/** The student the demo runs as. Their name is theirs to change (data/profile.ts). */
const DEMO_STUDENT = 'aisha'

const povs = () => [
  {
    to: '/teacher',
    label: 'Teacher',
    who: 'Ms. Okafor · 8M2, 8M4, 9S1',
    blurb:
      'Triage a class, drill into a student\'s knowledge profile, pinpoint why a student is stuck, clear the Oversight queue, and set up classes.',
  },
  {
    to: '/student',
    label: 'Student',
    who: `${studentName(DEMO_STUDENT)} · Year 8`,
    blurb:
      'A calm home of path lessons and homework, the diagnostic practice loop, free play over the whole curriculum, your map, and your progress.',
  },
  {
    to: '/parent',
    label: 'Parent',
    who: `${studentFirstName(DEMO_STUDENT)}'s parent`,
    blurb:
      `Read-only: where they're growing, what they found tricky and why — never the mark — plus what's coming up and their map of maths.`,
  },
  {
    to: '/admin',
    label: 'School admin',
    who: 'School office · 4 teachers, 8 classes',
    blurb:
      'Add teachers, add classes, and assign who teaches what. Minimum viable for the pilot stage — nothing more elaborate than that.',
  },
]

function Landing() {
  // Subscribes the landing page to the name store, so a rename in the student
  // view is reflected on the POV cards without a reload.
  useStudentName(DEMO_STUDENT)
  const POVS = povs()
  return (
    <div style={{ minHeight: '100vh', background: '#f6f1e7', display: 'flex', flexDirection: 'column' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '64px 24px 60px', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={40} />
          <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 30, color: '#0e2a43' }}>Anadromos</span>
        </div>
        <p style={{ margin: '14px 0 6px', fontSize: 14.5, lineHeight: 1.6, color: '#5c6773', maxWidth: 560, textWrap: 'pretty' }}>
          A diagnostic, un-gamified maths learning platform for UK secondary schools. It surfaces where it went wrong and why — never a leaderboard, never a bare score.
        </p>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '1px', textTransform: 'uppercase', color: '#8a7c63', margin: '30px 0 14px' }}>
          Choose a point of view
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 16 }}>
          {POVS.map((p) => (
            <Link
              key={p.to}
              to={p.to}
              style={{ display: 'block', background: '#fff', border: '1px solid #e4dccb', borderRadius: 14, padding: '22px 22px 20px', color: 'inherit', boxShadow: '0 1px 3px rgba(20,48,74,.05)' }}
            >
              <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.6px', textTransform: 'uppercase', color: '#b6531f' }}>{p.who}</div>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 21, fontWeight: 600, color: '#0e2a43', margin: '6px 0 8px' }}>{p.label} →</div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: '#5c6773', textWrap: 'pretty' }}>{p.blurb}</p>
            </Link>
          ))}
        </div>
        <div style={{ margin: '34px 4px 0', display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: 11.5, color: '#a99e88', lineHeight: 1.5, maxWidth: 520 }}>
            Prototype with sample data (Year 7–8). No streaks, points, or rankings anywhere.
            Progress is saved by the local backend, so a refresh — or a different
            browser on this machine — keeps what you did.
          </p>
          <span
            title={isServerBacked() ? 'server/ is answering on /api' : 'falling back to this browser\'s storage'}
            style={{
              fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.4px',
              color: isServerBacked() ? '#1f4e75' : '#8a7c63',
              background: isServerBacked() ? '#e4edf3' : '#f2ece0',
              border: `1px solid ${isServerBacked() ? '#cddceb' : '#e0d4bd'}`,
              borderRadius: 20, padding: '4px 10px', whiteSpace: 'nowrap',
            }}
          >
            {isServerBacked() ? '● local backend' : '○ browser storage'}
          </span>
          {hasSavedState() && (
            <button
              onClick={() => {
                // Deliberately unguarded by a confirm dialog: this is a demo
                // control, and a modal mid-pitch is worse than an accidental
                // reset you can redo in ten seconds. Awaited before the reload,
                // or the page would re-hydrate the state we just cleared.
                void resetAll().then(() => window.location.reload())
              }}
              style={{
                marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 11.5,
                letterSpacing: '.4px', color: '#5c6773', background: '#f2ece0',
                border: '1px solid #e0d4bd', borderRadius: 8, padding: '8px 14px',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              ↺ Reset demo
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/teacher" element={<TeacherApp />} />
        <Route path="/student" element={<StudentApp />} />
        <Route path="/parent" element={<ParentApp />} />
        <Route path="/admin" element={<AdminApp />} />
      </Routes>
    </BrowserRouter>
  )
}
