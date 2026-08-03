# Anadromos — prototype

A diagnostic, un-gamified maths learning platform for UK secondary schools, implemented as a
React + TypeScript SPA from the high-fidelity design handoff in
[`docs/design-handoff/`](docs/design-handoff/README.md).

The product's guiding principle: **no streaks, points, or rankings.** It surfaces the
diagnostic signal — where it went wrong and *why*, difficulty-weighted mastery, and
next-best actions — never a leaderboard or a bare score.

The claim that distinguishes it: **a gap is named, not scored.** When a student flags a line
of working, that line carries the prerequisite subtopics it tests — so a percentage question
they can't finish is reported to the teacher as *a fractions gap*, before the fractions review
is even due.

## Getting started

```sh
npm install
npm run dev      # app + local backend on http://localhost:5173
```

`npm run dev` serves the app **and** its API from one process — no second terminal.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with the local backend mounted |
| `npm run build` | content validator → `tsc -b` → production build |
| `npm run preview` | serve the production build (backend included) |
| `npm run lint` | oxlint |
| `npm run validate:content` | structural checks over `content/` (see below) |
| `npm run smoke:engine` | 54 behavioural checks: scheduler, cross-topic credit, XP, transfer |
| `npm run smoke:template` | 46 checks incl. 900 draws verified mathematically correct |
| `npm run server` | run the local backend standalone |
| `npm run generate:questions` | offline template generation (dry-run unless `--confirm`) |

## Points of view

The landing page (`/`) links to the POVs, each a self-contained flow over shared sample data
(Aisha Bello, class 8M2, Year 7–9 maths):

| Route | Audience | What's there |
| --- | --- | --- |
| `/teacher` | Ms. Okafor | Class dashboard, **cross-topic gaps** as students hit them, "Address in person" to-do list, student drill-down (pace, difficulty-weighted mastery, both knowledge graphs, frontier, activity log), Oversight queue, class setup with a **suggested teaching order**, transferable-profile export, and a live preview of the student practice view. |
| `/student` | Aisha | Home driven by the **live due queue**, the pre-lesson brief, the diagnostic practice loop, problem sets, **unlimited** free play, My map, Sessions, and Progress with live mastery and XP. |
| `/parent` | Aisha's parent | Read-only: where she's growing, where she got stuck **and why — never the mark**, what's coming up, and her map. |

The practice loop — the heart of the product — is shared between the student POV and the
teacher's preview: **solve** (final answer only, notation palette, optional handwriting upload)
→ **solution** (worked solution, tick every line where the technique went wrong) → **reason**
(one pass per flagged line: slip / silly mistake / too hard / haven't learned it / "Other")
→ **re-teach** (one scoped card per flagged line, from quick reminder to full walk-back).

Every flagged line also feeds the engine: see *Cross-topic credit* below.

## Architecture

### Content is data, not code

Curriculum content lives in `content/*.json` and is read through a typed store. Nothing in
`src/` hardcodes a topic, a question or a student.

**Ids are semantic and permanent** — `alg.linear.cross-equals`, never `n1`. They appear in
question tags, teacher baskets and exported student profiles, so they are never renumbered.

**Async happens once.** `loadContent()` and `hydrate()` are awaited in `main.tsx` before the
first render; every accessor after that is synchronous. No component fetches, no Suspense, no
loading state. Swapping the bundled JSON for HTTP is a change to `src/content/load.ts` alone.

### Cross-topic credit

`QuestionLine.prereqSubtopicIds` is the field the product sells. A flagged line propagates
evidence to the topic that *owns* the tagged prerequisite — damped, and credited to
`foundations`, because one line inside a larger question is weaker evidence than a whole
attempt. That is what turns "student flagged line 3" into a named gap on the teacher's
dashboard.

### Question templates

A template stores `{a}x − {b} = {a*x - b}` with constraints instead of the frozen instance
`3x − 7 = 11`, and instantiates to an ordinary `Question`. Three hand-authored templates yield
**7,691 distinct questions**, so practice on a templated subtopic never repeats and marginal
cost per student is genuinely zero.

Templates plug into the existing `QuestionBank` interface, so no call site knows they exist.
Expressions are evaluated by a hand-written parser — never `eval` — because template content is
generated data, and data must not become executable.

### Local backend

`server/` is a JSON-file key/value API on plain `node:http`, mounted into Vite's dev and preview
servers. Student progress survives reloads and browsers. `localStorage` is the **fallback**, not
the store — if the API is unreachable the app degrades quietly rather than losing state. The
landing page shows which path is live (`● local backend` / `○ browser storage`), and offers
**Reset demo** to clear everything.

Single-tenant, no auth. Right for a local demo; a real pilot needs per-user separation.

## Content validation

`npm run validate:content` gates the build and enforces:

- **DAG acyclicity** over prerequisite edges — cycles are reported, never auto-broken
- **Year-band monotonicity** — a Year 7 topic depending on Year 9 material
- **Reachability** — orphan nodes
- **Referential integrity** — every edge endpoint, line tag, lesson reference and student node
- **Id grammar** and containment
- **Line-prerequisite ancestry** — every tag must be a genuine ancestor of the question's subtopic

`scripts/validate-fixtures.sh` runs six deliberately-broken fixtures to prove each check can
actually fail. These run identically on the 78-subtopic seed graph and on a generated 8,000-node
one.

## Project layout

```
content/                   the curriculum, as data
  curriculum/              strands, topics, subtopics, both edge files,
                           questions, question templates, lessons, re-teach cards
  school/                  teachers, classes, class defaults
  samples/                 per-student node states, profiles, activity log, oversight
  __fixtures__/            deliberately-invalid content, for the validator's own tests

src/
  App.tsx                  routes + landing page (incl. Reset demo)
  main.tsx                 the one place anything is awaited
  theme.ts                 design tokens (nautical palette, Spectral / Public Sans / IBM Plex Mono)
  content/                 the typed content store
    schema.ts              every entity type
    load.ts                THE async seam — swap this for fetch
    store.ts, accessors.ts synchronous read surface
    bank.ts                QuestionBank, incl. template expansion
    template.ts            parameterised questions + expression evaluator
    validate.ts            shared predicates (browser + CLI)
  data/                    logic only — no content
    engine.ts              mastery, spaced repetition, cross-topic credit
    schedule.ts            due queue: priority bands + daily cap
    xp.ts                  XP as effort; re-lesson trigger reads mastery, not XP
    routing.ts             reason-coded routing after a wrong answer
    reteach.ts             re-teach card selection
    basket.ts              topological teaching order + prerequisite warnings
    transfer.ts            portable student profiles, stamped with graph version
    persist.ts             durable state; server-backed, localStorage fallback
    liveGaps.ts            cross-topic gaps, student POV → teacher POV
  components/              PracticeLoop, LessonSession, ReviewSession, PreLessonBrief, …
  teacher/ student/ parent/ admin/   the POVs

server/                    local backend (store / api / standalone runner)
scripts/                   validator, smoke suites, generation CLI, Vite runner
docs/
  build-plan.md            phases, costs, what is done and what is next
  content-schema-spec.md   the schema and migration spec
  design-handoff/          original design bundle + business plan
```

## Generating content

`npm run generate:questions` produces **templates**, not fixed questions — one authored item
serving unlimited instances. It is a CLI, not a service: it reads `ANTHROPIC_API_KEY` from the
environment, runs when you run it, and costs nothing sitting idle.

```sh
npm run generate:questions -- --strand num --per-subtopic 4            # dry run + cost estimate
npm run generate:questions -- --strand num --per-subtopic 4 --confirm  # submit
```

Three things make it safe to point at a budget:

1. **Dry-run by default** — prints the plan and estimated cost, and exits.
2. **Illegal prerequisite tags are impossible** — each request carries a JSON-schema `enum` of
   exactly that subtopic's legal ancestors, so a tag that would fail validation cannot be emitted.
3. **Output is staged, never merged** — results land in `question-templates.generated.json`
   tagged `status: 'generated'`, for review. The authored bank is untouched.

Every generated template is instantiated 40 times and rejected before writing if it fails to
render, breaches its own constraints, or produces a distractor equal to the correct answer.

## Status

See [`docs/build-plan.md`](docs/build-plan.md) for phases, costs and what comes next. In short:
Phase 0 (content store) and the Number-strand seed graph are done; the engine, templates and
local backend are built and wired; the full graph and question bank are pending and cost
roughly $200 and low tens of dollars respectively.
