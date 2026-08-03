import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { schoolClasses, teachers, yearBands } from '../content'
import type { SchoolClass, Teacher } from '../content'
import { FONT_MONO, FONT_SERIF } from '../theme'

/**
 * School admin POV — pilot-stage MVP only: add teachers, add classes,
 * assign rosters. No billing, permissions, multi-school switching, or
 * login anywhere in this prototype, so none are added here either.
 */

type Screen = 'teachers' | 'classes'

interface AdminState {
  screen: Screen
  teachers: Teacher[]
  classes: SchoolClass[]
  teacherSeq: number
  taName: string
  taSubject: string
  caName: string
  caGrade: string
  caTeacherId: string
}

const monoCap = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  color: '#8a7c63',
  ...extra,
})

const avatar = (color?: string): CSSProperties => ({
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: color || '#0e2a43',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 600,
  fontSize: 12,
  flex: 'none',
})

const chipStyle = (bg: string, col: string, bd: string): CSSProperties => ({
  background: bg,
  color: col,
  border: `1px solid ${bd}`,
  fontSize: 12,
  fontWeight: 500,
  padding: '5px 11px',
  borderRadius: 7,
})

const removeBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#b6531f',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'right',
}

const fieldStyle: CSSProperties = {
  border: '1px solid #e0d4bd',
  borderRadius: 8,
  background: '#faf6ee',
  padding: '10px 12px',
  fontSize: 14,
  color: '#1a2129',
  outline: 'none',
}

const pillBtn = (on: boolean): CSSProperties => ({
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 15px',
  borderRadius: 8,
  background: on ? '#0e2a43' : '#f2ece0',
  color: on ? '#fff' : '#5c6773',
  border: on ? '1px solid #0e2a43' : '1px solid #e0d4bd',
})

const initialsFor = (name: string) =>
  name
    .replace(/[^A-Za-z ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

export default function AdminApp() {
  // Lazy initialiser, not a module-scope constant: the store is installed by
  // main.tsx's `await loadContent()`, which runs AFTER this module is
  // evaluated. Reading teachers()/schoolClasses() at module scope would throw
  // before the first render. See content-schema-spec §6.12.
  const [s, setS] = useState<AdminState>(() => ({
    screen: 'teachers',
    teachers: [...teachers()],
    classes: [...schoolClasses()],
    teacherSeq: teachers().length + 1,
    taName: '',
    taSubject: '',
    caName: '',
    caGrade: 'Year 8',
    caTeacherId: teachers()[0]?.id ?? '',
  }))
  const setState = (patch: Partial<AdminState> | ((st: AdminState) => Partial<AdminState>)) =>
    setS((st) => ({ ...st, ...(typeof patch === 'function' ? patch(st) : patch) }))

  const navItems: Array<{ key: Screen; label: string }> = [
    { key: 'teachers', label: 'Teachers' },
    { key: 'classes', label: 'Classes' },
  ]

  // ---- teachers ----
  const addTeacher = () => {
    const name = s.taName.trim()
    const subject = s.taSubject.trim()
    if (!name || !subject) return
    setState((st) => ({
      teachers: [...st.teachers, { id: `teacher.new-${st.teacherSeq}`, name, subject, classIds: [] }],
      teacherSeq: st.teacherSeq + 1,
      taName: '',
      taSubject: '',
    }))
  }
  const removeTeacher = (id: string) => setState((st) => ({ teachers: st.teachers.filter((t) => t.id !== id) }))

  // ---- classes ----
  // Source of truth for "who teaches what" is SchoolClass.teacherId; a
  // teacher's assigned-classes list is always derived from it, never
  // duplicated in local state, so the two can't drift out of sync.
  const selTeacherForForm = s.teachers.find((t) => t.id === s.caTeacherId) ?? s.teachers[0] ?? null
  const addClass = () => {
    const id = s.caName.trim()
    if (!id || !selTeacherForForm) return
    if (s.classes.some((c) => c.id === id)) return
    setState((st) => ({
      classes: [...st.classes, { id, subject: selTeacherForForm.subject, yearBand: st.caGrade, teacherId: selTeacherForForm.id }],
      caName: '',
    }))
  }
  const removeClass = (id: string) => setState((st) => ({ classes: st.classes.filter((c) => c.id !== id) }))

  const teacherName = (id: string) => s.teachers.find((t) => t.id === id)?.name ?? 'Unassigned'

  return (
    <div style={{ minHeight: '100vh', background: '#fbf9f5' }}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Left nav rail */}
        <nav style={{ width: 212, flex: 'none', background: '#0e2a43', color: '#dbe6ef', display: 'flex', flexDirection: 'column', padding: '22px 14px', position: 'sticky', top: 0, height: '100vh' }}>
          <Link
            to="/"
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 24px', textDecoration: 'none' }}
          >
            <Logo size={30} />
            <span style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 19, color: '#fff', letterSpacing: '.2px' }}>Anadromos</span>
          </Link>
          {navItems.map((n) => {
            const active = n.key === s.screen
            return (
              <div
                key={n.key}
                onClick={() => setState({ screen: n.key })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, fontSize: 13.5, fontWeight: active ? 600 : 500, cursor: 'pointer', color: active ? '#fff' : '#9fb4c7', background: active ? 'rgba(221,106,47,.16)' : 'transparent', marginBottom: 2 }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#dd6a2f' : 'transparent', flex: 'none' }} />
                {n.label}
              </div>
            )
          })}
          <div style={{ marginTop: 'auto', padding: '14px 10px 4px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
            <div style={{ fontSize: 12, color: '#9fb4c7' }}>School office</div>
            <div style={{ fontSize: 11, color: '#6f8aa2', marginTop: 2 }}>
              {s.teachers.length} teachers · {s.classes.length} classes
            </div>
          </div>
        </nav>

        <main style={{ flex: 1, minWidth: 0 }}>
          {/* ---------- TEACHERS ---------- */}
          {s.screen === 'teachers' && (
            <div style={{ padding: '30px 40px 60px', maxWidth: 880 }}>
              <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>School admin</div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 28, margin: '6px 0 4px', color: '#0e2a43' }}>Teachers</h1>
              <p style={{ margin: '0 0 24px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 620, textWrap: 'pretty' }}>
                Everyone timetabled at the school, and the classes they're assigned. Add a teacher by name and subject, then hand them classes from the Classes screen.
              </p>

              {/* Add teacher */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 20 }}>
                <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 14px', color: '#0e2a43' }}>Add a teacher</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    value={s.taName}
                    onChange={(e) => setState({ taName: e.target.value })}
                    placeholder="Name, e.g. Mr. Ibrahim"
                    style={{ ...fieldStyle, flex: 1, minWidth: 180 }}
                  />
                  <input
                    value={s.taSubject}
                    onChange={(e) => setState({ taSubject: e.target.value })}
                    placeholder="Subject, e.g. Geography"
                    style={{ ...fieldStyle, flex: 1, minWidth: 180 }}
                  />
                  <button
                    onClick={addTeacher}
                    style={{ background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 8, padding: '0 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Add teacher
                  </button>
                </div>
              </div>

              {/* Teacher list */}
              {s.teachers.length > 0 ? (
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1.8fr 64px', gap: 12, padding: '11px 18px', background: '#efe7d9', fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.6px', textTransform: 'uppercase', color: '#8a7c63' }}>
                    <div>Teacher</div>
                    <div>Subject</div>
                    <div>Classes</div>
                    <div />
                  </div>
                  {s.teachers.map((t) => {
                    const theirClasses = s.classes.filter((c) => c.teacherId === t.id)
                    return (
                      <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1.8fr 64px', gap: 12, padding: '12px 18px', borderTop: '1px solid #f0e9dc', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <div style={avatar()}>{initialsFor(t.name)}</div>
                          <span style={{ fontWeight: 600, fontSize: 13.5, color: '#1a2129', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                        </div>
                        <div style={{ fontSize: 13, color: '#5c6773' }}>{t.subject}</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {theirClasses.length > 0 ? (
                            theirClasses.map((c) => (
                              <span key={c.id} style={chipStyle('#e4edf3', '#1f4e75', '#cddceb')}>
                                {c.id}
                              </span>
                            ))
                          ) : (
                            <span style={{ fontSize: 12, color: '#a99e88' }}>No classes yet</span>
                          )}
                        </div>
                        <button onClick={() => removeTeacher(t.id)} style={removeBtn}>
                          Remove
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ background: '#fff', border: '1px dashed #d8cfbb', borderRadius: 12, padding: '30px 20px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0e2a43' }}>No teachers yet</p>
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8a7c63' }}>Add the first one above.</p>
                </div>
              )}
            </div>
          )}

          {/* ---------- CLASSES ---------- */}
          {s.screen === 'classes' && (
            <div style={{ padding: '30px 40px 60px', maxWidth: 880 }}>
              <div style={monoCap({ fontSize: 11, letterSpacing: '1.5px' })}>School admin</div>
              <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 28, margin: '6px 0 4px', color: '#0e2a43' }}>Classes</h1>
              <p style={{ margin: '0 0 24px', fontSize: 13.5, lineHeight: 1.5, color: '#5c6773', maxWidth: 620, textWrap: 'pretty' }}>
                Every class at the school and who teaches it. Add a class, pick its grade band, and assign a teacher — that's the roster a teacher then builds on in their own Class setup.
              </p>

              {/* Add class */}
              <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, padding: '22px 24px', marginBottom: 20 }}>
                <h2 style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 14px', color: '#0e2a43' }}>Add a class</h2>
                {s.teachers.length > 0 && selTeacherForForm ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'start', marginBottom: 18 }}>
                      <div>
                        <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Class name</label>
                        <input
                          value={s.caName}
                          onChange={(e) => setState({ caName: e.target.value })}
                          placeholder="e.g. 8M3"
                          style={{ ...fieldStyle, width: '100%' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Grade band</label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {yearBands().map((g) => (
                            <button key={g} onClick={() => setState({ caGrade: g })} style={pillBtn(s.caGrade === g)}>
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <label style={{ display: 'block', ...monoCap({ marginBottom: 7 }) }}>Assigned teacher</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {s.teachers.map((t) => (
                        <button key={t.id} onClick={() => setState({ caTeacherId: t.id })} style={pillBtn(selTeacherForForm?.id === t.id)}>
                          {t.name}
                        </button>
                      ))}
                    </div>
                    <p style={{ margin: '0 0 16px', fontSize: 12, color: '#8a7c63' }}>Subject follows the teacher: {selTeacherForForm.subject}.</p>
                    <button
                      onClick={addClass}
                      style={{ background: '#0e2a43', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Add class
                    </button>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#8a7c63' }}>Add a teacher first — a class needs someone to teach it.</p>
                )}
              </div>

              {/* Class list */}
              {s.classes.length > 0 ? (
                <div style={{ background: '#fff', border: '1px solid #e4dccb', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '0.7fr 1fr 1fr 1.3fr 64px', gap: 12, padding: '11px 18px', background: '#efe7d9', fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '.6px', textTransform: 'uppercase', color: '#8a7c63' }}>
                    <div>Class</div>
                    <div>Subject</div>
                    <div>Grade band</div>
                    <div>Teacher</div>
                    <div />
                  </div>
                  {s.classes.map((c) => (
                    <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '0.7fr 1fr 1fr 1.3fr 64px', gap: 12, padding: '12px 18px', borderTop: '1px solid #f0e9dc', alignItems: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1a2129' }}>{c.id}</div>
                      <div style={{ fontSize: 13, color: '#5c6773' }}>{c.subject}</div>
                      <div style={{ fontSize: 13, color: '#5c6773' }}>{c.yearBand}</div>
                      <div style={{ fontSize: 13, color: '#5c6773', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{teacherName(c.teacherId)}</div>
                      <button onClick={() => removeClass(c.id)} style={removeBtn}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ background: '#fff', border: '1px dashed #d8cfbb', borderRadius: 12, padding: '30px 20px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0e2a43' }}>No classes yet</p>
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8a7c63' }}>Add the first one above.</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
