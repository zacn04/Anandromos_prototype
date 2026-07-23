/**
 * School-level sample data for the admin surface. Pilot-stage MVP only:
 * add teachers, add classes, assign rosters — nothing more elaborate.
 */

export interface Teacher {
  id: string
  name: string
  subject: string
  /** Class keys this teacher is timetabled against, e.g. '8M2'. */
  classKeys: string[]
}

export interface SchoolClass {
  key: string
  subject: string
  /** Year band, e.g. 'Year 8'. */
  grade: string
  teacherId: string
}

export const TEACHERS: Teacher[] = [
  { id: 't1', name: 'Ms. Okafor', subject: 'Mathematics', classKeys: ['8M2', '8M4', '9S1'] },
  { id: 't2', name: 'Mr. Whitfield', subject: 'English', classKeys: ['8E1', '9E3'] },
  { id: 't3', name: 'Dr. Petrova', subject: 'Science', classKeys: ['7S2', '8S1'] },
  { id: 't4', name: 'Mr. Adeyemi', subject: 'History', classKeys: ['9H1'] },
]

export const SCHOOL_CLASSES: SchoolClass[] = [
  { key: '8M2', subject: 'Mathematics', grade: 'Year 8', teacherId: 't1' },
  { key: '8M4', subject: 'Mathematics', grade: 'Year 8', teacherId: 't1' },
  { key: '9S1', subject: 'Mathematics', grade: 'Year 9', teacherId: 't1' },
  { key: '8E1', subject: 'English', grade: 'Year 8', teacherId: 't2' },
  { key: '9E3', subject: 'English', grade: 'Year 9', teacherId: 't2' },
  { key: '7S2', subject: 'Science', grade: 'Year 7', teacherId: 't3' },
  { key: '8S1', subject: 'Science', grade: 'Year 8', teacherId: 't3' },
  { key: '9H1', subject: 'History', grade: 'Year 9', teacherId: 't4' },
]
