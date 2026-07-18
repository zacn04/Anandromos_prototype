/** The full topic catalogue (~34 topics) with year bands, used by class setup. */
export interface CurriculumGroup {
  group: string
  topics: Array<[key: string, label: string, year: string]>
}

export const CURRIC: CurriculumGroup[] = [
  {
    group: 'Number',
    topics: [
      ['negatives', 'Negatives', 'Year 7'],
      ['fractions', 'Fractions', 'Year 7'],
      ['decimals', 'Decimals', 'Year 7'],
      ['rounding', 'Rounding & estimation', 'Year 7'],
      ['primes', 'Primes & factors', 'Year 7'],
      ['fracpct', 'Fractions → %', 'Year 8'],
      ['ratio', 'Ratio', 'Year 8'],
      ['proportion', 'Proportion', 'Year 8'],
      ['percentchange', 'Percentage change', 'Year 8'],
      ['standardform', 'Standard form', 'Year 9'],
      ['surds', 'Surds', 'Year 9'],
    ],
  },
  {
    group: 'Algebra',
    topics: [
      ['notation', 'Algebraic notation', 'Year 7'],
      ['substitution', 'Substitution', 'Year 7'],
      ['simplifying', 'Simplifying expressions', 'Year 7'],
      ['expanding', 'Expanding brackets', 'Year 8'],
      ['factorising', 'Factorising', 'Year 8'],
      ['linear', 'Linear equations', 'Year 8'],
      ['sequences', 'Sequences', 'Year 8'],
      ['brackets', 'Equations with brackets', 'Year 9'],
      ['simultaneous', 'Simultaneous eqns', 'Year 9'],
      ['inequalities', 'Inequalities', 'Year 9'],
      ['quadratics', 'Quadratics', 'Year 9'],
    ],
  },
  {
    group: 'Geometry & graphs',
    topics: [
      ['angles', 'Angles', 'Year 7'],
      ['area', 'Area & perimeter', 'Year 7'],
      ['coordinates', 'Coordinates', 'Year 8'],
      ['lineargraphs', 'Linear graphs', 'Year 8'],
      ['polygons', 'Polygons', 'Year 8'],
      ['volume', 'Volume & surface area', 'Year 8'],
      ['transformations', 'Transformations', 'Year 8'],
      ['pythagoras', 'Pythagoras', 'Year 9'],
      ['circles', 'Circles', 'Year 9'],
    ],
  },
  {
    group: 'Statistics & probability',
    topics: [
      ['charts', 'Charts & tables', 'Year 7'],
      ['averages', 'Averages', 'Year 8'],
      ['spread', 'Range & spread', 'Year 8'],
      ['probability', 'Probability', 'Year 8'],
      ['scatter', 'Scatter graphs', 'Year 9'],
      ['trees', 'Tree diagrams', 'Year 9'],
    ],
  },
]

export const GRADES = ['Year 7', 'Year 8', 'Year 9']

export const DEFAULT_BASKET: Record<string, boolean> = {
  negatives: true,
  fractions: true,
  fracpct: true,
  ratio: true,
  proportion: true,
  notation: true,
  substitution: true,
  expanding: true,
  factorising: true,
  linear: true,
  coordinates: true,
  angles: true,
  averages: true,
  probability: true,
}

export const DEFAULT_ROSTER = [
  'Aisha Bello',
  'Daniel Kovač',
  'Reuben Clarke',
  'Priya Shah',
  'Tom Weller',
  'Grace Idowu',
  'Elif Demir',
  'Oscar Reid',
]
