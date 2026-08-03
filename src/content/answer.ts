/**
 * Answer comparison, in one place.
 *
 * Both the practice loop and homework marking decide "did the student get this
 * right", and they must decide it identically — a student who types the same
 * thing in two places cannot be right in one and wrong in the other. Keeping
 * the rule here rather than duplicating it is what makes that guarantee hold.
 */

/** Case- and whitespace-insensitive; leaves everything else alone. */
export const normalizeAnswer = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '')

export function isCorrectAnswer(given: string, expected: string): boolean {
  return normalizeAnswer(given) === normalizeAnswer(expected)
}
