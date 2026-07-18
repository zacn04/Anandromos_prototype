# Anadromos — prototype

A diagnostic, un-gamified maths learning platform for UK secondary schools, implemented as a
React + TypeScript SPA from the high-fidelity design handoff in
[`docs/design-handoff/`](docs/design-handoff/README.md).

The product's guiding principle: **no streaks, points, or rankings.** It surfaces the
diagnostic signal — where it went wrong and *why*, difficulty-weighted mastery, and
next-best actions — never a leaderboard or a bare score.

## Points of view

The landing page (`/`) links to three POVs, each a self-contained flow with sample data
(Aisha Bello, class 8M2, Year 7–8 maths):

| Route | Audience | What's there |
| --- | --- | --- |
| `/teacher` | Ms. Okafor | Class dashboard (attention-first / three-lanes / full-roster layouts), "Address in person" to-do list, class mastery by topic, student drill-down ("Where to start", pace, difficulty-weighted mastery, focused + full knowledge graphs, frontier, activity log), activity-log detail with the student's flagged working, the Oversight queue, class setup (roster + basket of topics), and a live preview of the student practice view. |
| `/student` | Aisha | Home (mastery path + teacher-set problem sets with due stickers and prerequisite locks), the diagnostic practice loop, multi-question problem-set solving with a question navigator, Free play over the whole curriculum (lesson-gated), My map (this year / all of maths), Sessions history, and Progress. |
| `/parent` | Aisha's parent | Read-only: where she's growing, previous sessions showing what she found tricky **and why — never the mark**, upcoming lessons/homework, and her map. |

The practice loop — the heart of the product — is shared between the student POV and the
teacher's preview: **solve** (final answer only, with a notation palette and optional
handwriting upload) → **solution** (worked solution, tick every line where the technique
went wrong) → **reason** (one pass per flagged line: slip / silly mistake / too hard /
haven't learned it / "Other" with free text) → **re-teach** (one scoped card per flagged
line, from quick reminder to full walk-back).

## Getting started

```sh
npm install
npm run dev      # dev server
npm run build    # type-check + production build
npm run preview  # serve the production build
```

## Project layout

```
src/
  App.tsx                  routes (/ /teacher /student /parent) + landing page
  theme.ts                 design tokens (nautical palette, Spectral / Public Sans / IBM Plex Mono)
  components/
    Logo.tsx               the anadromous-fish mark
    GraphSvg.tsx           knowledge-graph SVG renderer
    NodeInfoCard.tsx       subtopic detail strip under a graph
    PracticeLoop.tsx       the diagnostic practice loop (student + teacher preview)
  data/                    sample data shared across POVs
    knowledgeGraph.ts      nodes, prerequisite edges, status styles, basket filters
    activityLog.ts         Aisha's activity record (incl. per-line flagged working)
    oversight.ts           the AI-moments-for-a-human queue
    curriculum.ts          full topic catalogue with year bands
    reteach.ts             re-teach card selection logic
  teacher/TeacherApp.tsx   Teacher POV
  student/StudentApp.tsx   Student POV
  parent/ParentApp.tsx     Parent POV
docs/design-handoff/       the original design bundle (open the .dc.html files directly
                           in a browser to view the reference prototypes)
```

Sample data is hardcoded in `src/data/` with the shapes a future API should keep
(see "State Management" in the handoff README).
