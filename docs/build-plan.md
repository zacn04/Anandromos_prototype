# Anadromos — Build Plan

*Drafted 2 August 2026, from the 22 July 2026 platform to-do list. Sits alongside
`design-handoff/Anadromos MVP Design Brief.md` (what the product is) and
`design-handoff/masterfile.md` (why). This document is about **what to build, in what
order, and what it costs**.*

---

## Status — 3 August 2026

| | State |
| --- | --- |
| **Phase 0** — foundations | **Done.** Content in `content/*.json`, semantic IDs, validator, async seam. |
| **Seed graph** — Number strand | **Done.** 78 subtopics, 80 prerequisite edges, all 12 Number topics. `source: 'ai'`, `status: 'draft'` — awaiting teacher review. |
| **Phase 3** — engine | **Logic done.** Due queue, cross-topic credit, XP. 54 smoke checks pass. Not yet surfaced in the student home. |
| **Phase 5** — front end | **Partly done.** Basket ordering + transferable profiles as logic; pre-lesson brief built and live. Basket UI and transfer UI not built. |
| **Phase 1** — full graph | Not started (~$200, awaits seed strand proving the pipeline). |
| **Phase 2** — question bank | Not started (~$6,000, awaits a committed pilot school). |
| **Phase 4** — exam boards | Not started (~$1,200). |

Gates: `npm run build` (validator → tsc → vite), `npm run lint`, `npm run smoke:engine`.

---

## 0. The read

The to-do list has eleven items. Four of them are on the critical path and the other
seven are downstream of those four:

```
  ontology + IDs  →  topic graph  →  subtopic graph  →  question bank
                                          │                   │
                                          ├── scheduling algorithm
                                          ├── XP / mastery
                                          ├── exam-board tailoring
                                          └── basket builder, transferable profiles,
                                              pre-lesson slide
```

Everything in the second column is cheap to build and impossible to build *well* until
the first row exists. The scheduling algorithm is a hundred lines of code once you have
a verified graph; without one it is a hundred lines of guessing. The exam-board work is
a tagging exercise on the question bank; without a bank there is nothing to tag.

So: **build the graph, then the bank, then everything else.** The rest of this document
is that sequence, with the decisions that matter called out.

One thing to fix before anything else, because it propagates: **"concepts" → "prerequisites"**
throughout the codebase, not just the planning docs. The prototype currently uses
"concepts" in `LessonSession.tsx` and the study-mode definitions. Rename it now while it
is a fifteen-minute change.

### Two concerns, stated once

**8,000 subtopics is probably over-split, and the number drives every cost below.**
Y7–13 is 7 year groups; 8,000 subtopics is ~1,140 per year, ~7.5 per lesson across a
38-week year. That is defensible for genuinely atomic subtopics but tight, and the
figure is only useful if it is *maths-only*. If 8,000 spans all subjects, the maths
slice is more like 2,000 and every cost estimate here divides by four. **This plan
assumes 8,000 maths subtopics, Y7–13 plus prerequisite fill.** All costs are given per
1,000 subtopics as well as in total, so they rescale by inspection.

**XP as a mastery proxy conflicts with the mastery model already in the product.**
`engine.ts` already computes difficulty-weighted mastery across three tiers, and the
design brief is explicit that a student must not look "done" with a topic by avoiding
its hardest items. XP — awarded per session, reduced by wrong answers — is a *volume*
measure, and a student can farm it on easy items. Recommendation in §5: keep the tiered
engine as the source of truth for mastery, and use XP purely as the student-facing
display of effort. The plan below builds what the to-do list asked for, with XP wired
to trigger re-lessons as specified, but sourced from mastery rather than standing in
for it.

---

## 0.5 Deferring API spend

*Added 2 August 2026, after the decision to avoid API costs for now.*

Almost none of this plan requires spending money soon. Sorted by what it actually costs:

| | Cost | Can it wait? |
| --- | --- | --- |
| Phase 0 — schema, IDs, API layer | £0 | No — blocking, start now |
| Phase 5 — basket builder, pre-lesson slide, profiles | £0 | No — parallel from week 3 |
| Phase 3 — scheduling, XP, cross-topic credit | £0 | No — needs *a* graph, not a big one |
| Phase 1 — full 8,000-subtopic graph | ~$200 | Yes, but it's a rounding error |
| **Phase 2 — the 320k question bank** | **~$6,000** | **Yes — defer until a pilot school is committed** |

The $6,000 is the only real budget line, and **it is the last thing you need, not the
first.** You need a generated bank when a school is actually running lessons on it.
Before that, everything you need to build, demo, and sell can be hand-sourced.

### The zero-spend path

**Hand-author a seed graph for one strand.** ~150 subtopics for Year 8 Number, in a
spreadsheet, by you or a teacher over a couple of days. That is enough to build the
scheduling algorithm against, enough to render a real basket builder, and enough to
demo the knowledge-graph views with something truthful behind them. The structural
checks from §1.2 (DAG, year-band, reachability) run on a hand-built graph exactly the
same as a generated one — write them now, they're free and they'll validate the
generated graph later.

**Hand-source 200–300 questions** from textbooks and past papers, tagged line-by-line
by hand. Tedious, but it does three things worth the tedium: it gives the practice loop
real content, it produces the few-shot exemplars the generation prompt will need later,
and it forces you to discover what the line-level tagging schema actually needs to hold
before you commit 320,000 rows to it. The prototype's existing 12 problems were mined
this way and they're the reason `problems.ts` has a sane shape.

**Then spend the ~$200 on the full graph** when the seed strand has proven the pipeline
end-to-end. Then spend the ~$120 pilot. Then, with a school signed, the ~$6,000.

### Bring-your-own-key: where it works and where it doesn't

BYOK fits one of the two AI surfaces and breaks the other.

**It works for teacher problem-set generation.** This is the on-demand surface from §4,
and BYOK solves the open question in the meeting notes about capping teacher usage —
you don't need a cap if the school is paying for its own inference. Store an API key
per school in settings, feature-flag the whole surface off until a school supplies one,
and fall back to textbook scan-in (which is far cheaper, and which teachers may prefer
anyway since they trust questions they chose). Concretely: `school.anthropic_api_key`,
encrypted at rest, never leaves the server, with the feature hidden entirely when null.

**It does not work for the question bank**, and this is the catch. The bank's whole
economic argument is that it is generated *once* and amortised across every school.
Push generation to per-school keys and you get 100 schools × $6,000 of duplicated work
producing 100 near-identical banks — worse than the on-demand model the meeting
explicitly rejected. It also breaks the product: a shared bank means a shared graph,
shared difficulty calibration, and transferable student profiles that mean the same
thing across schools. Per-school banks make profiles non-portable, which kills §5.2.

So: **the bank is a capital expense Anadromos pays once**, deferred until it is needed.
BYOK covers the marginal, per-school, on-demand surface only.

### What to build now

The generation pipeline should be a **CLI script, not a service** — reads
`ANTHROPIC_API_KEY` from the environment, writes to the content store, runs on your
machine when you decide to run it. No hosted job runner, no billing integration, no
always-on cost. That is how you'd want it built regardless; it just also means the
spend is entirely under your control and nothing bills you while it sits unused.

The prototype has zero API calls today — everything is hardcoded in `src/data/` — so
there is nothing to unwire. Keep it that way until Phase 2.

---

## Phase 0 — Foundations (2–3 weeks)

Unglamorous and blocking. Nothing else can start at scale until this is done.

### 0.1 Get the content out of TypeScript

Right now the curriculum lives in `src/data/*.ts` — 15 graph nodes, 37 topics, 17
problems, all hardcoded. That is exactly right for a prototype and completely wrong for
8,000 subtopics. Content needs a real store before generation begins, or you will
generate 320,000 questions into files nobody can query.

Minimum viable schema:

| Table | Key fields |
| --- | --- |
| `strand` | id, label (Number, Algebra, Geometry, Stats, …) |
| `topic` | id, strand_id, label, year_band, exam_board_tags[] |
| `subtopic` | id, topic_id, label, year_band, difficulty_tier, status (draft/verified) |
| `prereq_edge` | from_subtopic, to_subtopic, strength, source (ai/teacher/empirical), confidence |
| `question` | id, subtopic_id, family_id, difficulty, statement, answer, distractors[] |
| `question_line` | question_id, line_index, latex, **prereq_subtopic_id**, note |
| `reteach_card` | question_id, line_index, scope, body, worked_example |

`question_line.prereq_subtopic_id` is the whole product. It is what turns "student
flagged line 3" into "student has a gap in *converting a mixed number to an improper
fraction*, tested inside a probability question" — which is the thing the teacher
dashboard reports and the thing nobody else does.

### 0.2 A stable ID scheme

`n1`, `n2`, `n3` does not survive 8,000 rows. Use semantic, immutable IDs:
`alg.linear.cross-equals`, `num.frac.mixed-to-improper`. They appear in question tags,
teacher baskets, student profiles, and exported transferable profiles — they must never
be renumbered. Version the graph (`graph_version`) so a re-run of the edge pass doesn't
silently invalidate every student's stored profile.

### 0.3 Keep the prototype's shapes

`src/data/` already has the right *shapes* — `NodeStatus`, `TierMastery`,
`AttemptEvent`, `Problem.lines` / `solNotes` / `errIdx`. Port them to the API rather
than redesigning. The prototype is the spec for the client contract.

**Exit criteria:** the existing 15-node sample graph and 12-problem bank load from the
API instead of from `.ts` files, and every POV still renders identically.

---

## Phase 1 — The knowledge graph (4–6 weeks)

Two to-do items: "graph connecting subtopics" and "graph connecting topics". Build them
in the opposite order to how they were listed — **topics first**, because the topic
graph is what makes the subtopic graph tractable.

### 1.1 Why not just ask about all 8,000 at once

8,000 subtopics is 32 million possible pairs. Asking about each is infeasible and
pointless: 99.9% of pairs have no relationship, and any model asked to compare
*Pythagoras* with *long division* will correctly say "unrelated" 32 million times at
your expense.

**Hierarchical decomposition** collapses this. Three levels:

- ~15 strands (already in `curriculum.ts` as groups)
- ~200 topics (the current `CURRIC` list is 34 — it grows to ~200 at Y7–13 scope)
- 8,000 subtopics

### 1.2 Topic graph — ~200 calls

Don't do pairwise. For each topic, ask a single question: *"What must a student already
be able to do before learning this? Return prerequisites from this catalogue."* Supply
the full 200-topic catalogue in the prompt (it is small) and constrain output to
catalogue IDs. One call per topic, ~200 calls total. Cost is rounding error.

Then run three checks, in this order, before a human sees it:

1. **Acyclicity.** The prerequisite graph must be a DAG. Every cycle is a bug — either a
   mis-stated edge or two topics that should be merged. Report cycles; do not auto-break them.
2. **Year-band monotonicity.** A Year 7 topic should not have a Year 9 prerequisite.
   Violations are usually a mislabelled year band, occasionally a genuinely misplaced
   curriculum item. Both are worth knowing.
3. **Reachability.** Every topic should be reachable from a root. Orphans mean a missing
   edge.

Only what survives goes to teacher review — which is then reviewing ~200 rows, a
half-day's work, not an open-ended research project.

### 1.3 Subtopic graph — ~8,000 calls, constrained candidate sets

For each subtopic, the candidate prerequisite pool is **not** all 8,000. It is:

- other subtopics within the same topic (~40), plus
- subtopics in topics that are ancestors in the topic graph (~3 topics × 40 = ~120)

So ~160 candidates instead of 8,000 — a 98% reduction in the search space, and the
reduction is *principled*: if topic B doesn't depend on topic A, a subtopic of B cannot
depend on a subtopic of A without that being a topic-graph error, which check (1) above
will surface.

One call per subtopic, returning prerequisite IDs from the candidate list with a
one-line justification and a confidence score. Run through the same DAG / year-band /
reachability checks.

**Cost (Opus 5, Batch API, prompt caching on the shared rubric):**

| | per subtopic | × 8,000 | per 1,000 |
| --- | --- | --- | --- |
| Input (~5.5k tok, mostly cached) | | ~44M tok | 5.5M |
| Output (~800 tok) | | ~6.4M tok | 0.8M |
| **Cost at batch rates ($2.50 / $12.50 per MTok)** | | **~$150–250** | **~$20–30** |

The graph is not where the money goes. Build it carefully; it is cheap.

### 1.4 Verification — three sources, in increasing order of trust

1. **Structural checks** (above) — free, automatic, catch real errors.
2. **Teacher review of a stratified sample** — not all 8,000. Sample ~400 subtopics
   stratified by strand and year band, have secondary teachers confirm or correct the
   prerequisite sets, and measure the agreement rate. If agreement is >90%, ship the
   graph and review the rest opportunistically. If it is 70%, the prompt is wrong and
   you have just found out for the cost of 400 reviews rather than 8,000.
3. **Empirical validation from student data** — the real answer, available later. If
   subtopic A is a genuine prerequisite of B, students who haven't mastered A should
   fail B at a measurably higher rate. Once you have pilot data, this scores every edge
   automatically and finds the edges nobody thought to draw. Design the schema for it
   now (`prereq_edge.source`, `.confidence`); run it in year two.

**Exit criteria:** a verified DAG over 8,000 subtopics, teacher-sampled at ≥90%
agreement, with per-edge provenance.

---

## Phase 2 — The question bank (8–12 weeks, overlapping Phase 1)

> **Superseded 3 August 2026 — generate templates, not questions.** A template
> stores `{a}x − {b} = {a*x - b}` with constraints rather than the frozen instance
> `3x − 7 = 11`, and instantiates to an ordinary `Question` at serve time. Three
> hand-authored templates already yield **7,691 distinct questions**. The cost
> model below is superseded: the whole Number strand is ~**$2.41** of templates
> rather than ~$20 of fixed questions, and practice stops being exhaustible.
> Three consequences worth keeping:
>
> - **Marginal cost per student is genuinely zero**, not just amortised.
> - **Review effort drops ~40×.** A human can review 296 templates; nobody
>   reviews 2,960 questions.
> - **Generated templates are machine-checkable.** `validateTemplate` instantiates
>   each one 40 times and rejects any that fails to render, breaches its own
>   constraints, or produces a distractor equal to the answer — before it is
>   written. You cannot check a generated fixed question that way without
>   solving it.
>
> The section below is kept for the fixed-bank costing, which still bounds the
> worst case.

This is the expensive phase and the one that defines the product.

### 2.1 Generate the tagging, don't add it afterwards

The to-do list frames this as three capabilities: write questions for a subtopic,
identify which prerequisites a question tests, identify which prerequisite each line of
working tests. **Do not build these as three passes.** Generate the question *as* a
tagged object in a single call:

```
{
  subtopic: "num.prob.single-event",
  statement: "A bag has 3 red and 5 blue counters. P(red)?",
  answer: "3/8",
  lines: [
    { latex: "total = 3 + 5 = 8",  prereq: "num.arith.addition" },
    { latex: "P(red) = 3/8",       prereq: "num.frac.part-of-whole" },
    { latex: "= 0.375",            prereq: "num.frac.to-decimal" }
  ],
  distractors: ["3/5", "5/8", "8/3"],
  distractor_causes: ["confused part with remainder", "wrong colour", "inverted"]
}
```

Tagging at generation time is cheaper (one call, not three), more reliable (the model
that wrote the line knows what it was testing), and self-validating: **every `prereq` on
every line must be an ancestor of the question's subtopic in the Phase 1 graph.** If it
isn't, either the tag is wrong or the graph is missing an edge — and both are worth
catching. This is the single best automated quality check available, and it exists only
because the graph came first.

### 2.2 Re-teach cards come from the same pass

The prototype's `reteach.ts` selects a card per flagged line. Generate those cards
alongside the question — one scoped card per line (the "focused re-teach"), plus one
full walk-back per question. They are cheap to add to a call that has already loaded the
subtopic context, and expensive to add later.

### 2.3 What "enough" looks like

Sizing: ~40 questions per subtopic — roughly 12 foundations / 18 core / 10 stretch,
grouped into ~8 families of "same structure, different numbers" (the prototype's
`familyId`, which is what a silly-mistake retry draws from). That is **~320,000
questions**.

### 2.4 Cost, and the argument for pre-generation

Per question: ~4k input (subtopic spec + prerequisite list + style exemplars, heavily
cached across the 40 questions sharing a subtopic) and ~1.2k output (statement, answer,
tagged lines, distractors, re-teach cards).

**Full bank, Opus 5, Batch API + prompt caching:**

| | Total | per 1,000 subtopics |
| --- | --- | --- |
| Output | ~384M tok → ~$4,800 | ~$600 |
| Input (after caching) | ~$1,000–1,300 | ~$150 |
| **Total** | **~$6,000** | **~$750** |

On Sonnet 5 the same bank is roughly $3,700 — not the saving you'd expect, because
output tokens dominate and the quality risk on line-level prerequisite tagging is
exactly where you don't want to economise. **Use Opus 5 for generation.** Use Haiku 4.5
for the mechanical validation passes (schema conformance, LaTeX parseability, numeric
answer checking) where it is 5× cheaper and the task is trivial.

Now the number that justifies the whole approach. On-demand generation at pilot scale —
10,000 students × 30 questions/week × 40 weeks = **12M question-serves per year**. At
~1.2k output tokens each, that is 14.4B output tokens. On-demand cannot use the Batch
API (it's real-time by definition), so at standard Opus 5 rates that is **~$360,000 per
year, recurring**.

**~$6,000 once versus ~$360,000 per year.** The pre-generation decision in the meeting
notes is correct by roughly two orders of magnitude, and it gets better with scale: the
bank cost is fixed while on-demand cost grows linearly with students. Keep on-demand
generation for exactly one surface — teacher problem-set authoring — where volume is low
and the teacher is the quality filter.

### 2.5 Do not generate 8,000 subtopics' worth on the first run

Pilot **one strand, one year band** — Year 8 Number, ~150 subtopics, ~6,000 questions,
~$120. Put it in front of teachers and students. Measure:

- What fraction of questions are usable as-authored?
- Do the line-level prerequisite tags survive teacher scrutiny?
- Do students' flagged lines map to gaps the teacher recognises?

Fix the prompt, then scale. Generating all 8,000 before validating the tagging is the
one way to turn a $6,000 line item into a $12,000 one.

### 2.6 Quality gates (automated, before human review)

1. Schema conformance and LaTeX parseability — Haiku 4.5, or plain parsing.
2. Numeric answer verification — execute the maths, don't ask a model.
3. **Prerequisite-tag ancestry check** — every line tag is a graph ancestor (§2.1).
4. Distractor plausibility — each distractor traces to a named misconception, not a
   random number.
5. Duplicate detection within family — same structure is intended; identical numbers
   are not.

**Exit criteria:** a strand shipped end-to-end, ≥85% of generated questions usable
without edit, tag-ancestry check passing at ≥95%.

---

## Phase 3 — The engine (3–4 weeks, low priority per the meeting)

Cheap, and now well-specified because the graph exists.

### 3.1 Scheduling — what pushes, and when

Extend `engine.ts` rather than replacing it. It already has interval doubling capped at
21 days, promotion on a 0.75 tier average, and trickle-down recency credit. What it
needs:

- **A due queue with priority**, not just a per-node `next` label: overdue reviews first,
  then frontier lessons, then teacher problem sets with near due dates, then free play.
- **The reason-coded routing from the design brief §G**, which is currently narrated but
  not implemented: *too hard* → redo the lesson; *silly mistake* → same family, different
  numbers, and a second miss codes the subtopic "hasn't learned properly"; *slip* → no
  routing change; *haven't learned it* → drop to the weakest unmastered prerequisite.
- **A daily-load cap.** A student returning after two weeks should not be shown 40 due
  reviews. Cap the queue and let the schedule slip; a wall of red is the fastest way to
  lose the exact student this product exists to serve.

### 3.2 Cross-topic credit — the "transfer learning" item

The meeting note says "we mentioned using transfer learning to help understanding". In
the ML sense, transfer learning is not what's wanted here and would require training
runs the plan explicitly avoids. What *is* valuable — and what line-level prerequisite
tagging uniquely enables — is **evidence propagation across the graph**:

> A student correctly completes line 2 of a probability question. Line 2 is tagged
> `num.frac.part-of-whole`. That is positive evidence for the fractions node, banked
> without ever serving a fractions question.

`engine.ts` already has one-directional trickle-down (practising a topic gives recency
credit to its prerequisites). Line-level tags upgrade this from *recency* credit to
*mastery* evidence, and make it bidirectional: a student who reliably fails line 2 across
several probability questions has a fractions gap, and the system can say so before the
fractions review comes due. That is the feature nobody else has. Name it "cross-topic
credit" and treat it as a Phase 3 deliverable, not a research project.

### 3.3 XP

Per the to-do list, with the caveat from §0:

- Weight by session type: reviews > lessons > problem sets > free play. Free play is
  practice toward automaticity and should count least; it is already lesson-gated so it
  can't be used to skip the taught path.
- Award a base per session, scaled by proportion correct.
- Below-threshold XP triggers a re-lesson.

**But:** compute the re-lesson trigger from `masteryByTopic` (difficulty-weighted, already
built) rather than from XP itself. Display XP to the student as effort; drive decisions
from mastery. A student who has farmed 900 XP on foundations items has not mastered the
topic, and the engine already knows that. Never show XP comparatively — no leaderboards,
per the research basis in the design brief.

---

## Phase 4 — Exam boards (2–3 weeks)

The meeting note gets this right: **prerequisites and subtopics don't change across
boards**. Don't fork the graph. Board differences are two things, both handled as tags:

1. **Which subtopics are in scope** — a `board_scope` tag per subtopic per board (AQA /
   Edexcel / OCR / WJEC), which pre-populates the teacher's basket rather than
   constraining it. Teachers pick their own subtopics anyway, so this is a convenience
   default, not a rule.
2. **How questions are phrased** — a `board_style` tag on questions, plus a generation
   pass that produces board-styled variants for the ~20% of subtopics where phrasing
   genuinely differs (structured multi-part questions, command words, formula-sheet
   assumptions). Not all 8,000 — most of arithmetic looks the same on every paper.

To learn the styles: ingest board-specific past papers and textbooks, have the model
identify which subtopics and prerequisites each question tests (the same tagging
capability from Phase 2, run in reverse), and use the tagged corpus as few-shot
exemplars for board-styled generation. This is a validation asset too — if the model
tags a real AQA question with prerequisites your graph doesn't connect, that's a
missing edge.

**Teacher-facing generation cap.** Problem-set authoring is the one on-demand surface.
Cap it — a per-teacher monthly allowance, generous enough to be invisible in normal use
— and offer the cheaper alternative from the meeting notes: **textbook scan-in**. The
teacher photographs a question, the AI transcribes it as-is and generates the
appropriate input widget (a fillable matrix for a matrix-multiplication question, a
notation palette for algebra). That is a vision + transcription task, roughly a tenth
the cost of generation, and it produces questions the teacher already trusts because
they chose them.

---

## Phase 5 — Front end (parallel with Phases 2–4)

The prototype covers most of this. What the meeting added:

### 5.1 Basket builder

`ClassSetup` in `TeacherApp.tsx` already does roster + basket with a year-band filter.
Two things to add:

- **Scale.** Selecting from 8,000 subtopics needs search, strand/year filters, and
  bulk selection by topic. Nobody clicks 200 checkboxes.
- **Ordering.** The meeting identified the fork: accept Anadromos's suggested teaching
  order, or set your own. Build the suggestion (topological sort of the basket over the
  prerequisite graph, tie-broken by year band) and make it drag-to-reorder. Warn — don't
  block — when a teacher's order puts a subtopic before its prerequisite. Teachers have
  reasons; the product's job is to make sure it's a choice, not an accident.

### 5.2 Transferable student profiles *(low priority, high strategic value)*

The stable ID scheme from §0.2 is what makes this work. A profile is a portable
document: `{student_id, graph_version, node_states[], mastery_by_topic, activity_summary}`.
On transfer, the receiving teacher sees the student's map immediately, diffed against
their new class's basket — "Ravi is ahead on Algebra, has gaps in Ratio that this class
covered in September". That is the retention story for a multi-school rollout, and it
costs almost nothing if the IDs are right from the start. It costs a migration if they
aren't.

### 5.3 Pre-lesson slide

The note trails off — "Could be helpful if we have a brief slide, just before a lesson
that says something like:". Filling the gap in the spirit of the rest of the product
(calm, informational, no hype), it should answer three questions in one screen:

> **Next: Solving equations with brackets**
> You'll need: *expanding brackets* ✓ mastered · *linear equations* ✓ mastered
> Last time you worked on this: never — this is new
> About 12 minutes.

Prerequisites shown with their status, drawn straight from the graph. It sets
expectations, surfaces the graph's value to the student at the exact moment it is
relevant, and gives a shaky prerequisite somewhere to be seen before it causes a failure.

---

## Sequencing

| Weeks | Track A (content) | Track B (product) | Spend |
| --- | --- | --- | --- |
| 1–3 | Phase 0: schema, IDs, API | Port prototype to API | — |
| 2–5 | **Hand-build seed graph, one strand (~150)** | Basket builder at scale | — |
| 4–8 | Hand-source 200–300 tagged questions | Practice loop on real content | — |
| 6–12 | Structural checks; teacher review of seed | Pre-lesson slide, scheduling queue | — |
| 8–16 | — | Phase 3 engine, cross-topic credit | — |
| — | *↓ everything below waits for a committed pilot school ↓* | | |
| ~16 | Phase 1: topic graph → subtopic graph → checks | Teacher dashboard on real data | ~$200 |
| ~18 | Teacher verification sample (~400) | | — |
| ~20 | **Phase 2 pilot: one strand** | | ~$120 |
| 22–30 | Phase 2 full generation, strand by strand | Problem-set authoring (BYOK), scan-in | ~$6,000 |
| 28–34 | Phase 4 exam-board tagging + styled variants | Transferable profiles | ~$1,200 |
| 34+ | Empirical edge validation from pilot data | | — |

Track A and Track B are genuinely parallel after week 3, which is the reason Phase 0
comes first — the API contract is what lets them run without blocking each other. The
first sixteen weeks cost nothing but time, and produce a demoable product with real
content behind it.

## Cost summary

| Item | Cost | When |
| --- | --- | --- |
| Phases 0, 3, 5 + seed graph + hand-sourced questions | — | Now |
| Subtopic graph (8,000) | ~$200 | Once the seed strand proves the pipeline |
| Question bank pilot (1 strand) | ~$120 | Before committing to full generation |
| Question bank full (~320k questions) | ~$6,000 | Once a pilot school is committed |
| Exam-board styled variants (~20%) | ~$1,200 | Per board, as boards are added |
| Re-run graph on curriculum change | ~$200 | As needed |
| New subtopics after launch | ~$750 / 1,000 | As curriculum grows |
| Teacher problem-set generation | ~$0.02/question | **School's own API key (BYOK)** |
| **Avoided** — on-demand serving at 10k students | **~$360,000/yr** | — |

All figures assume Opus 5 (`claude-opus-5`, $5/$25 per MTok) via the **Batch API**
(50% discount, and the entire pipeline is offline so there is no reason not to) with
**prompt caching** on the shared rubric and per-subtopic prefixes (cache writes 1.25×,
reads 0.1×). Use Haiku 4.5 ($1/$5) for mechanical validation passes only.

## The three decisions that matter most

1. **Topic graph before subtopic graph.** It turns 32 million comparisons into 8,000
   constrained ones. Without it, the subtopic graph is not buildable at any price.
2. **Tag prerequisites at generation time, in the same call as the question.** Cheaper,
   more accurate, and it gives you the ancestry check — the only automated quality gate
   that actually tests the thing the product sells.
3. **Pre-generate; keep one on-demand surface.** ~$6,000 once against ~$360,000 a year,
   and the gap widens with every school you add.
