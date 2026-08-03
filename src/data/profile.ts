/**
 * The display name each student goes by, editable by the student themselves.
 *
 * Names were hardcoded as "Aisha Bello" in five places across four files
 * (StudentApp's greeting, ParentApp's header, TeacherApp's roster, App.tsx's
 * POV picker, PracticeLoop's demo strip), which meant a demo could only ever be
 * run as Aisha. This is the one place that answers "what is this student
 * called", so a name typed in the student view shows up in the teacher's class
 * list and the parent's header without anything else being touched.
 *
 * Same module-singleton-plus-persist shape as data/students.ts, including its
 * `useSyncExternalStore` pair - see that file for why the snapshot is a number
 * rather than an object. Unlike data/liveSessions.ts this one DOES live-sync
 * within a mounted route, because the name appears on screens a student can
 * change it from without navigating away.
 */

import { useSyncExternalStore } from 'react'
import { load, save } from './persist'

/** The seeded demo cohort's names — the starting point, not a fixed answer. */
const DEFAULT_NAMES: Record<string, string> = {
  aisha: 'Aisha Bello',
  daniel: 'Daniel Kovač',
  reuben: 'Reuben Clarke',
}

const nameKey = (studentId: string) => `name.${studentId}`

const names = new Map<string, string>()
let version = 0
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

/**
 * What this student is called. Falls back to the seeded demo name, then to the
 * id itself, so an unknown student renders as something rather than blank.
 */
export function studentName(studentId: string): string {
  const cached = names.get(studentId)
  if (cached !== undefined) return cached
  const persisted = load<string | null>(nameKey(studentId), null)
  const resolved = typeof persisted === 'string' && persisted.trim().length > 0
    ? persisted
    : (DEFAULT_NAMES[studentId] ?? studentId)
  names.set(studentId, resolved)
  return resolved
}

/**
 * Just the part a greeting uses — "Good afternoon, Aisha" rather than the full
 * "Aisha Bello". A single-word name is its own first name.
 */
export function studentFirstName(studentId: string): string {
  return studentName(studentId).split(' ')[0]
}

/**
 * Renames a student. A blank or whitespace-only name is refused rather than
 * stored: an empty greeting is worse than the name they had.
 */
export function setStudentName(studentId: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed.length === 0) return
  if (studentName(studentId) === trimmed) return
  names.set(studentId, trimmed)
  save(nameKey(studentId), trimmed)
  version++
  notify()
}

/** Registers a change listener. Returns the unsubscribe, as `useSyncExternalStore` requires. */
export function subscribeToNames(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A monotonic version — a number, not an object, so `useSyncExternalStore` can compare it by identity. */
function getNameVersion(): number {
  return version
}

/**
 * One student's name, re-rendering when it changes:
 *
 *   const name = useStudentName('aisha')
 */
export function useStudentName(studentId: string): string {
  useSyncExternalStore(subscribeToNames, getNameVersion, getNameVersion)
  return studentName(studentId)
}
