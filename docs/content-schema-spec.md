# Anadromos — Content Store Schema & Migration Specification

*Phase 0.1 / 0.2 of [`build-plan.md`](build-plan.md). Written 2 August 2026 as the
implementation contract for the content extraction; revised the same day after two
adversarial reviews (dispositions in §11). This document is normative: where it and the
current code disagree, this document wins. Where it is silent, preserve today's behaviour
exactly.*

**Audience:** the parallel implementation agents building this change. Nothing here is
open for renegotiation mid-build — if you believe a decision is wrong, implement it as
written and raise it afterwards. Two agents guessing differently is more expensive than
one decision being suboptimal.

**The two exhaustive sections.** §2 is the complete ID map: every string, final. §5.6 is
the complete API surface: every accessor name, signature, ordering guarantee and
missing-key fallback, final. Nothing else needs to be agreed between agents.

---

## 0. What this change is

Curriculum **content** moves out of `src/data/*.ts` and into JSON under `content/`. Pure
**logic** stays in TypeScript. A single `async loadContent()` is awaited once in
`main.tsx`; every accessor below it is synchronous, so ~4,400 lines of component code
keep their present shape.

Three things get fixed on the way through, and they are the point of the exercise:

1. **`n1`..`n15` die.** IDs become dot-delimited semantic identifiers.
2. **The two ID namespaces merge.** The 15 knowledge-graph nodes and the 37 curriculum
   topics are the same conceptual entities under two incompatible schemes. They become
   one `Topic` entity. `normalizeTopicName()` and `TOPIC_KEY_BY_NORMALIZED_LABEL` in
   `engine.ts` — the fuzzy label-matcher that exists only because no shared key exists —
   are deleted. `TOPIC_TO_NODE_ID` in `StudentApp.tsx` is deleted for the same reason.
3. **"Concepts" become "prerequisites"**, in types, identifiers and UI copy.

### 0.1 Success criteria

Checkable, in order of how much they matter:

| # | Criterion |
| --- | --- |
| S1 | `grep -rn "normalizeTopicName\|TOPIC_KEY_BY_NORMALIZED_LABEL\|TOPIC_TO_NODE_ID" src/` returns nothing. **Includes the four docblocks that only mention the names** (`StudentApp.tsx:337`, `:348`, `DiagnosticTest.tsx:88`, plus `StudentApp.tsx:100–111`'s own comment) — see §6.3 and §6.6. |
| S2 | `grep -rnE "'n([1-9]\|1[0-5])'" src/ content/` returns nothing. |
| S3 | `grep -rn "Concept" src/` returns nothing outside prose comments about the English word (`TeachingCard.tsx:12`, `StudentApp.tsx:25`, `:867` are the sanctioned survivors). |
| S4 | `npm run build` passes (which now includes `npm run validate:content`). |
| S5 | `npm run validate:content` exits 0 with zero errors and zero warnings on `content/`. |
| S6 | `/teacher`, `/student`, `/parent`, `/admin` render identically to `main`, except for the mandated Concept→Prerequisite copy changes in §6.4. |
| S7 | `src/data/` contains only `engine.ts`, `reteach.ts`, `routing.ts`, `liveSessions.ts`, `liveOversight.ts`, `teacherProblemSets.ts`. |
| S8 | Zero new entries in `package.json` `dependencies`. |

### 0.2 Precedence rules for conflicts

- **Behaviour preservation beats schema elegance,** except where this document says
  otherwise explicitly.
- **The Concept→Prerequisite rename (§6.4) overrides behaviour preservation** for the
  specific strings listed there. It is the one sanctioned visible change.
- **Authored array order is load-bearing.** `questionAt(topicId, n)` and the class-setup
  topic picker both depend on it. **No accessor sorts, with exactly one exception:
  `graphTopics()` sorts by `Topic.graph.order` (§3.3).** No accessor filters beyond what
  its name says. See §5.6.

### 0.3 Corrections to the build plan's arithmetic

`build-plan.md` §0.1 says "15 graph nodes, 34 topics, 12 problems". Counted from the
source on 2 August 2026:

- 15 graph nodes ✓
- **37** curriculum topics, not 34 (11 Number + 11 Algebra + 9 Geometry + 6 Statistics)
- **17** problems, not 12 (4 + 2 + 4 + 2 + 5)
- **67** question lines, not 68: sixteen problems have 4 lines each, `sub-one-2`
  (`problems.ts:237`) has 3.

This document uses the real counts. The unified topic table has **39** rows: 37
catalogue topics plus 2 graph-only topics that have never had a catalogue entry (§2.3).

---

## 1. The ID grammar

### 1.1 The one rule

> **A content ID is its parent's ID plus exactly one dot-segment.**

That single rule generates the whole scheme and is mechanically checkable:

```
strand      num                                     1 segment
topic       num.fractions                           2 segments
subtopic    num.fractions.to-decimal                3 segments
question    num.fractions.to-decimal.q01            4 segments
```

A question line is not an entity: it is addressed by the composite key
`(questionId, lineIndex)`. A re-teach card likewise: `(questionId, lineIndex | 'all')`.

### 1.2 Segment grammar

Every segment matches:

```
SEGMENT := [a-z0-9]+(-[a-z0-9]+)*        max 40 characters
```

Lowercase ASCII only. Words inside a segment are hyphen-separated. No underscores, no
uppercase, no trailing/leading/doubled hyphens, no dots inside a segment.

**A leading digit is legal.** The most common UK secondary maths labels that are not in
the prototype start with one — *3D shapes*, *2D shapes*, *2-way tables*, *3D Pythagoras*,
*3-figure bearings* — and there is no readable, mechanical way to rewrite them
(`three-d-shapes` is worse and still needs a rule). `3d-shapes` and `2-way-tables` are the
correct ids. This is the only change from the grammar as originally drafted; nothing in
today's data starts with a digit, so nothing moves.

Full-ID regexes, by level. Build them from one shared `SEG` constant so the four cannot
drift:

```ts
const SEG = '[a-z0-9]+(?:-[a-z0-9]+)*'
export const RE_SEGMENT  = new RegExp(`^${SEG}$`)
export const RE_STRAND   = new RegExp(`^${SEG}$`)
export const RE_TOPIC    = new RegExp(`^${SEG}\\.${SEG}$`)
export const RE_SUBTOPIC = new RegExp(`^${SEG}\\.${SEG}\\.${SEG}$`)
export const RE_QUESTION = new RegExp(`^${SEG}\\.${SEG}\\.${SEG}\\.${SEG}$`)
export const MAX_SEGMENT_LENGTH = 40
```

Segment length is checked separately from the regex (`E_ID_SEGMENT_LENGTH`), because a
40-character bound inside a regex is unreadable and the error message should say which
segment was too long.

### 1.3 `slugify()` — the mandatory id producer

The grammar above validates a segment. It does not produce one, and at ~8,000
AI-generated subtopic labels the producer is what matters: two agents asked to "slug the
label" will emit `solve-both-sides` and `solving-both-sides` for the same subtopic, and
`E_ID_DUPLICATE` will not catch near-duplicates.

**`slugify(label)` is normative, lives in `src/content/validate.ts`, and every generator
from Phase 1 onward MUST use it.** One implementation, shared by the CLI, the browser
loader and the generation scripts — the same argument §8.1 makes for the predicates.

```ts
export function slugify(label: string): string
```

Algorithm, in this order:

1. `label.normalize('NFKD')`.
2. Apply the transliteration table below, longest key first. Each replacement is padded
   with a single space on both sides so it never fuses with an adjacent word.
3. Strip remaining combining marks: `.replace(/\p{M}+/gu, '')`.
4. Lowercase.
5. Replace every run of characters outside `[a-z0-9]` with a single `-`.
6. Collapse runs of `-`; trim leading and trailing `-`.
7. Throw if the result is empty. An entity whose label slugs to nothing needs a human.
8. If longer than `MAX_SEGMENT_LENGTH`, truncate at the last `-` at or before index 40;
   if there is no such `-`, hard-truncate at 40. Trim any trailing `-`.

Transliteration table (exhaustive; extend it in `validate.ts`, never at a call site):

| in | out | | in | out | | in | out |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `π` | `pi` | | `≥` | `ge` | | `→` | `to` |
| `√` | `root` | | `≤` | `le` | | `%` | `percent` |
| `∑` | `sum` | | `≠` | `ne` | | `&` | `and` |
| `×` | `x` | | `°` | `deg` | | `+` | `plus` |
| `÷` | `div` | | `£` | `gbp` | | `=` | `equals` |

**Sibling collision rule.** If a slug collides with a sibling under the same parent,
append `-2`, `-3`, … The first claimant keeps the bare slug. If the suffix would push the
segment past 40 characters, truncate the base further to make room. Collision resolution
is applied in the generator's authored order, so it is reproducible.

**§2's ids are hand-authored and final.** `slugify()` is NOT applied retroactively to
them: `Rounding & estimation` slugs to `rounding-and-estimation`, and the authored id is
`num.rounding`. Hand-authored ids must satisfy §1.2's grammar; they need not be
`slugify()` output. From Phase 1, generated ids must be.

### 1.4 Naming conventions

- **Strand segment** — a short conventional abbreviation, fixed by this document. Four
  exist today: `num`, `alg`, `geo`, `stat`. **This is the prototype's subset, not the
  target.** `build-plan.md` §1.1 puts the eventual figure at ~15 strands. Adding a strand
  is additive-only: a new row in `strands.json` plus new topics under it. Existing topic
  ids never move as a consequence — if a topic genuinely reclassifies, that is a
  reparenting and §1.6's alias policy applies. Reserved abbreviations, so two agents do
  not mint `probability` and `prob` for the same strand: `ratio`, `prob`, `trig`, `vect`,
  `meas`, `seq`, `calc`, `func`, `proof`, `matr`. Which of these become strands, and
  whether `stat` splits, is a Phase 1 decision.
- **Topic segment** — a readable slug of the topic's catalogue label, not an
  abbreviation. `num.fractions`, not `num.frac`. `geo.coordinates`, not `geo.coord`.
  Drop noise words where the meaning survives (`Rounding & estimation` → `rounding`,
  `Area & perimeter` → `area`), keep them where it doesn't (`Percentage change` →
  `percent-change`).
- **Subtopic segment** — a readable slug of the technique the subtopic names, phrased as
  the thing the student does: `cross-equals`, `divide-negative`, `to-decimal`.
- **Question segment** — `q` followed by a zero-padded ordinal within the parent
  subtopic, starting at `q01`. Widen the padding when a subtopic passes 99 questions
  (`q100`, never `q0100`). **Ordinals are never reused after a question is retired**; a
  retired question keeps its row and its id with `status: 'retired'` (§3.9).

> **Note on `build-plan.md`'s illustrative IDs.** §2.1 of the build plan uses abbreviated
> topic segments (`num.frac.to-decimal`, `num.prob.single-event`). This document uses the
> unabbreviated form mandated by the Phase 0 brief (`num.fractions.to-decimal`). Those
> build-plan strings are illustrations, not data; nothing depends on them.

### 1.5 IDs that are deliberately outside this grammar

Five id namespaces are **not** curriculum content and do **not** follow the dotted
hierarchy rule. Each has its own grammar:

| Namespace | Values today | Grammar | Why it's separate |
| --- | --- | --- | --- |
| `GraphFilterId` | `filter.number`, `filter.ratio`, `filter.algebra`, `filter.geometry` | `^filter\.[a-z0-9]+(-[a-z0-9]+)*$` | A presentation grouping over the focused graph, not a curriculum level. `filter.ratio` spans Number-strand topics; it is not a strand. **Namespaced under `filter.` for the same reason `TeacherId` is namespaced:** an unprefixed `ratio`/`number`/`algebra` is indistinguishable from a `StrandId` to `id-grammar`, and all four are plausible strand ids under the ~15-strand target in §1.4. Provisional: Phase 5 derives these from the teacher's basket instead of authoring them (G10). |
| `StudentId` | `aisha`, `daniel`, `reuben` | `^[a-z0-9]+(-[a-z0-9]+)*$` | A person identifier. A real deployment replaces these with opaque keys. Unchanged from today. |
| `TeacherId` | `teacher.okafor`, … | `^teacher\.[a-z0-9]+(-[a-z0-9]+)*$` | Person identifiers, namespaced so they never collide with a strand id. |
| `ClassId` | `8M2`, `9S1`, … | `^[0-9][A-Z][0-9A-Z]*$` | Real-world timetable codes. Already semantic and already what a school types. Case-sensitive, unchanged. |
| `familyId` | `cross-equals`, `two-term`, … | `^[a-z0-9]+(-[a-z0-9]+)*$` | Scoped *within* a subtopic. See §3.5. |

`'all'`, the graph-filter sentinel held in `TeacherState.graphFilter` /
`StudentApp`'s `graphFilter`, is component state, not a content id. It never appears in
`content/` and the validator never sees it.

### 1.6 ID immutability, reparenting, and aliases

Constraint 3 and `build-plan.md` §0.2 both say ids "must never be renumbered": they appear
in question tags, teacher baskets, student profiles and exported transferable profiles.
§1.1 also makes an id encode its parentage, and §8.5 rule 3 makes that a hard error. Those
two constraints collide the first time a teacher reparents something — and reparenting is
guaranteed: `build-plan.md` §1.4 puts ~400 AI-generated subtopics in front of teachers,
and *linear graphs* is filed under Geometry here and under Algebra by AQA.

**The policy, decided here:**

1. An id is minted once and is never re-spelled while the entity lives at that location.
2. **Reparenting mints a new id at the new location.** The old id is pushed onto the new
   entity's `aliases` array. Every descendant is re-minted the same way, and each
   descendant's old id goes onto that descendant's own `aliases`.
3. **All three resolvers consult aliases.** `topicById`, `subtopicById` and
   `questionById` try the live id first, then a single alias index, and return the *live*
   entity. They never return an alias-keyed copy and never return a different entity type.
4. Retirement is not renaming. An entity that is withdrawn keeps its row and its id with
   `status: 'retired'` (§3.9) and gains no alias.
5. `aliases` is `[]` on every row in the seed content. It is a required field, not
   optional, so the shape is uniform and a Phase 1 generator cannot forget it.

The alternative — downgrading the topic→strand half of `E_ID_PARENT_MISMATCH` to a
warning and treating the strand segment as a historical namespace — is **rejected**.
`E_ID_PARENT_MISMATCH` being a hard error is what makes §1.1 mechanically checkable, and
that check is the whole value of the hierarchical scheme. Paying for it with a
three-element alias mechanism is the cheaper trade.

Validator rules: `E_ALIAS_COLLIDES` (an alias equals a live id of any entity type),
`E_ALIAS_DUPLICATE` (the same alias appears on two entities), `E_ALIAS_GRAMMAR` (an alias
fails the level regex for its owner's entity type). See §8.5 rule 4.

---

## 2. The complete semantic ID map

This is the contract between the parallel agents. Every ID in this section is final. If
your implementation produces a different string, it is wrong.

### 2.1 Strands (4)

`content/curriculum/strands.json`, in this authored order.

| # | `CURRIC[].group` today | New `StrandId` | `label` |
| --- | --- | --- | --- |
| 1 | `Number` | `num` | `Number` |
| 2 | `Algebra` | `alg` | `Algebra` |
| 3 | `Geometry & graphs` | `geo` | `Geometry & graphs` |
| 4 | `Statistics & probability` | `stat` | `Statistics & probability` |

### 2.2 Topics (39) — the unified table

`content/curriculum/topics.json`, **in exactly this authored order.** The order is
`CURRIC` order within each strand, strands in `CURRIC` order, with each strand's
graph-only topics appended at the end of that strand's block. This is the order
`catalogueGroups()` and therefore the class-setup and homework topic pickers render in.

**It is NOT the order `graphTopics()` returns.** Graph draw order is carried separately by
`graph.order` (§3.3) — see the `ord` column.

Columns:
- **old key** — the `curriculum.ts` `CURRIC` topic key, or `—` if the topic had none.
- **old node** — the `knowledgeGraph.ts` `NODES` id, or `—` if not on the graph.
- **label** — `Topic.label`. Byte-identical to today's `CURRIC` label where one exists.
- **graph label** — `Topic.graph.label`. Byte-identical to today's `NODES[].label`.
  Blank means the topic is not on the graph (`onGraph: false`, `graph: null`).
- **ord** — `Topic.graph.order`. 1..15, reproducing today's `NODES` array order exactly.
- **x, y** — `Topic.graph.x` / `.y`, copied verbatim from `NODES`.
- **cat** — `Topic.catalogue`: ✓ means it appears in the teacher's class-setup and
  homework topic pickers.

Every row also carries `aliases: []`, `source: "teacher"`, `reviewedAt: null`,
`status: "verified"`. `onGraph` is `true` for exactly the 15 rows with an `ord`, `false`
for the other 24.

#### Strand `num` — Number (12 rows: 11 catalogue + 1 graph-only)

| old key | old node | **New TopicId** | label | year | graph label | ord | x | y | cat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `negatives` | `n1` | `num.negatives` | Negatives | Year 7 | Negatives | 1 | 24 | 44 | ✓ |
| `fractions` | `n2` | `num.fractions` | Fractions | Year 7 | Fractions | 2 | 24 | 134 | ✓ |
| `decimals` | `n3` | `num.decimals` | Decimals | Year 7 | Decimals | 3 | 24 | 224 | ✓ |
| `rounding` | — | `num.rounding` | Rounding & estimation | Year 7 | | | | | ✓ |
| `primes` | — | `num.primes` | Primes & factors | Year 7 | | | | | ✓ |
| `fracpct` | `n6` | `num.fractions-to-percent` | Fractions → % | Year 8 | Fractions → % | 6 | 190 | 170 | ✓ |
| `ratio` | `n4` | `num.ratio` | Ratio | Year 8 | Ratio | 4 | 24 | 314 | ✓ |
| `proportion` | `n7` | `num.proportion` | Proportion | Year 8 | Proportion | 7 | 190 | 314 | ✓ |
| `percentchange` | `n10` | `num.percent-change` | Percentage change | Year 8 | **% change** | 10 | 356 | 314 | ✓ |
| `standardform` | — | `num.standard-form` | Standard form | Year 9 | | | | | ✓ |
| `surds` | — | `num.surds` | Surds | Year 9 | | | | | ✓ |
| — | `n5` | `num.negatives-arithmetic` | Neg. arithmetic | Year 7 | Neg. arithmetic | 5 | 190 | 44 | ✗ |

#### Strand `alg` — Algebra (12 rows: 11 catalogue + 1 graph-only)

| old key | old node | **New TopicId** | label | year | graph label | ord | x | y | cat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `notation` | — | `alg.notation` | Algebraic notation | Year 7 | | | | | ✓ |
| `substitution` | `n9` | `alg.substitution` | Substitution | Year 7 | Substitution | 9 | 356 | 170 | ✓ |
| `simplifying` | — | `alg.simplifying` | Simplifying expressions | Year 7 | | | | | ✓ |
| `expanding` | `n12` | `alg.expanding` | Expanding brackets | Year 8 | **Expanding ( )** | 12 | 522 | 220 | ✓ |
| `factorising` | — | `alg.factorising` | Factorising | Year 8 | | | | | ✓ |
| `linear` | `n11` | `alg.linear` | Linear equations | Year 8 | Linear equations | 11 | 522 | 100 | ✓ |
| `sequences` | — | `alg.sequences` | Sequences | Year 8 | | | | | ✓ |
| `brackets` | `n14` | `alg.bracket-equations` | Equations with brackets | Year 9 | **Bracket eqns** | 14 | 688 | 150 | ✓ |
| `simultaneous` | `n15` | `alg.simultaneous` | Simultaneous eqns | Year 9 | **Simultaneous** | 15 | 688 | 290 | ✓ |
| `inequalities` | — | `alg.inequalities` | Inequalities | Year 9 | | | | | ✓ |
| `quadratics` | — | `alg.quadratics` | Quadratics | Year 9 | | | | | ✓ |
| — | `n8` | `alg.basics` | Algebra basics | Year 7 | Algebra basics | 8 | 356 | 44 | ✗ |

#### Strand `geo` — Geometry & graphs (9 rows, all catalogue)

| old key | old node | **New TopicId** | label | year | graph label | ord | x | y | cat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `angles` | — | `geo.angles` | Angles | Year 7 | | | | | ✓ |
| `area` | — | `geo.area` | Area & perimeter | Year 7 | | | | | ✓ |
| `coordinates` | `n13` | `geo.coordinates` | Coordinates | Year 8 | Coordinates | 13 | 522 | 334 | ✓ |
| `lineargraphs` | — | `geo.linear-graphs` | Linear graphs | Year 8 | | | | | ✓ |
| `polygons` | — | `geo.polygons` | Polygons | Year 8 | | | | | ✓ |
| `volume` | — | `geo.volume` | Volume & surface area | Year 8 | | | | | ✓ |
| `transformations` | — | `geo.transformations` | Transformations | Year 8 | | | | | ✓ |
| `pythagoras` | — | `geo.pythagoras` | Pythagoras | Year 9 | | | | | ✓ |
| `circles` | — | `geo.circles` | Circles | Year 9 | | | | | ✓ |

#### Strand `stat` — Statistics & probability (6 rows, all catalogue)

| old key | old node | **New TopicId** | label | year | graph label | ord | x | y | cat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `charts` | — | `stat.charts` | Charts & tables | Year 7 | | | | | ✓ |
| `averages` | — | `stat.averages` | Averages | Year 8 | | | | | ✓ |
| `spread` | — | `stat.spread` | Range & spread | Year 8 | | | | | ✓ |
| `probability` | — | `stat.probability` | Probability | Year 8 | | | | | ✓ |
| `scatter` | — | `stat.scatter` | Scatter graphs | Year 9 | | | | | ✓ |
| `trees` | — | `stat.trees` | Tree diagrams | Year 9 | | | | | ✓ |

#### Node → topic index (the reverse lookup, and `graph.order`)

```
ord 1  n1  → num.negatives              ord 6  n6  → num.fractions-to-percent   ord 11 n11 → alg.linear
ord 2  n2  → num.fractions              ord 7  n7  → num.proportion             ord 12 n12 → alg.expanding
ord 3  n3  → num.decimals               ord 8  n8  → alg.basics                 ord 13 n13 → geo.coordinates
ord 4  n4  → num.ratio                  ord 9  n9  → alg.substitution           ord 14 n14 → alg.bracket-equations
ord 5  n5  → num.negatives-arithmetic   ord 10 n10 → num.percent-change         ord 15 n15 → alg.simultaneous
```

> **Why `order` exists at all.** `topics.json` is authored in catalogue order, which
> interleaves the 15 graph topics as `n1,n2,n3,n6,n4,n7,n10,n5,n9,n12,n11,n14,n15,n8,n13`.
> Node z-order in `GraphSvg` is harmless (no rects overlap), but
> `TeacherApp.tsx:235`'s `buildFrontierGroups()` renders `NODES.filter(…).map(n => n.label)`
> as an **ordered chip list** on the teacher's student-profile screen. Deriving graph order
> from file order would move Aisha's "Mastered" chips from
> `Negatives, Fractions, Decimals, Ratio, Neg. arithmetic, Proportion, Algebra basics` to
> `… Ratio, Proportion, Neg. arithmetic, Algebra basics`, and her "Not ready yet" chips
> from `% change, Coordinates, Bracket eqns, Simultaneous` to
> `% change, Bracket eqns, Simultaneous, Coordinates`. That is a visible rendering change
> and it fails S6. Reordering `topics.json` instead would move the class-setup picker.
> A separate `order` field is the only option that moves neither.

### 2.3 Why two topics are graph-only

`n5 Neg. arithmetic` and `n8 Algebra basics` are drawn on the knowledge graph but have
never had a catalogue entry — `engine.ts` says so explicitly in its comment about
"Algebra basics, which has no equivalent curriculum key". Unification does not invent
one: they become topics with `catalogue: false`, which is exactly what excludes them
from the class-setup and homework pickers and so preserves those screens byte-for-byte.

`alg.basics` and `alg.notation` (*Algebraic notation*) are plausibly the same topic under
two labels. **Do not merge them in this change.** Merging would alter a graph node's
displayed label. It is logged in §9.1 (G1) as Phase 1 reconciliation work.

Year bands for the two graph-only topics are assigned `Year 7` (the earliest band). Both
sit upstream of `Year 7` and `Year 8` topics, so every one of the 17 edges is year-band
monotone and `W_YEAR_BAND` (§8.5, rule 7) does not fire.

### 2.4 Prerequisite edges (17)

`content/curriculum/prereq-edges.topic.json`, in this order (today's `EDGES` order,
which `deriveFrontier` and the trickle-down loop both iterate).

| # | old | **from** | **to** |
| --- | --- | --- | --- |
| 1 | `n1→n5` | `num.negatives` | `num.negatives-arithmetic` |
| 2 | `n1→n9` | `num.negatives` | `alg.substitution` |
| 3 | `n2→n6` | `num.fractions` | `num.fractions-to-percent` |
| 4 | `n3→n6` | `num.decimals` | `num.fractions-to-percent` |
| 5 | `n2→n7` | `num.fractions` | `num.proportion` |
| 6 | `n4→n7` | `num.ratio` | `num.proportion` |
| 7 | `n5→n8` | `num.negatives-arithmetic` | `alg.basics` |
| 8 | `n8→n9` | `alg.basics` | `alg.substitution` |
| 9 | `n8→n11` | `alg.basics` | `alg.linear` |
| 10 | `n8→n13` | `alg.basics` | `geo.coordinates` |
| 11 | `n9→n11` | `alg.substitution` | `alg.linear` |
| 12 | `n6→n10` | `num.fractions-to-percent` | `num.percent-change` |
| 13 | `n7→n10` | `num.proportion` | `num.percent-change` |
| 14 | `n11→n14` | `alg.linear` | `alg.bracket-equations` |
| 15 | `n12→n14` | `alg.expanding` | `alg.bracket-equations` |
| 16 | `n11→n15` | `alg.linear` | `alg.simultaneous` |
| 17 | `n13→n15` | `geo.coordinates` | `alg.simultaneous` |

All 17 seed edges carry `strength: 1`, `source: "teacher"`, `confidence: 1`, and **no
`evidence` key** (the field is optional — see §5.3). Justification: they were hand-drawn
by a human in the prototype, which is precisely what `source: "teacher"` means in
`build-plan.md` §1.4; no AI or empirical pass has run.

`content/curriculum/prereq-edges.subtopic.json` exists with `"items": []`. Phase 1's
subtopic pass fills it, and doing so switches §8.5 rule 9 from its tier-B fallback to its
tier-A rule.

### 2.5 Graph filters (4)

`content/curriculum/graph-filters.json`, in today's `BASKETS` order.

| old `key` | **GraphFilterId** | `label` | `topicIds` |
| --- | --- | --- | --- |
| `number` | `filter.number` | Number | `num.negatives`, `num.fractions`, `num.decimals`, `num.negatives-arithmetic`, `num.fractions-to-percent` |
| `ratio` | `filter.ratio` | Ratio & proportion | `num.ratio`, `num.proportion`, `num.percent-change` |
| `algebra` | `filter.algebra` | Algebra | `alg.basics`, `alg.substitution`, `alg.linear`, `alg.expanding`, `alg.bracket-equations` |
| `geometry` | `filter.geometry` | Coordinates & graphs | `geo.coordinates`, `alg.simultaneous` |

`topicIds` order matches today's `ids` arrays exactly (`n1,n2,n3,n5,n6` / `n4,n7,n10` /
`n8,n9,n11,n12,n14` / `n13,n15`).

The `filter.` prefix is new (§1.5). Filter ids are never rendered — `TeacherApp.tsx:420`
and `StudentApp.tsx:1095` map them into `{ key, label }` where only `label` is displayed
and `key` is a React key and a state comparison — so the prefix is invisible.

### 2.6 Subtopics (7)

`content/curriculum/subtopics.json`, in this order.

| # | **SubtopicId** | `topicId` | `label` | year | status | derived from |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `alg.linear.cross-equals` | `alg.linear` | Moving a term across the = | Year 8 | `verified` | `familyId: 'lin-cross-equals'` + `Concept.id: 'cross-equals'` (`Concept.label`) |
| 2 | `alg.linear.divide-negative` | `alg.linear` | Dividing by a negative | Year 8 | `verified` | `familyId: 'lin-divide-negative'` + `Concept.id: 'divide-negative'` (`Concept.label`) |
| 3 | `alg.substitution.two-term` | `alg.substitution` | Two-term expressions | Year 7 | `verified` | `familyId: 'sub-two-term'` (label from `problems.ts`'s section comment) |
| 4 | `alg.substitution.single-term` | `alg.substitution` | Single-term expressions | Year 7 | `verified` | `familyId: 'sub-single-term'` (ditto) |
| 5 | `num.fractions-to-percent.convert` | `num.fractions-to-percent` | Converting a fraction to a percentage | Year 8 | `verified` | `familyId: 'fracpct-convert'` |
| 6 | `num.fractions.to-decimal` | `num.fractions` | Converting a fraction to a decimal | Year 7 | **`draft`** | **New.** Line-tag target — see §3.6 |
| 7 | `num.decimals.to-percent` | `num.decimals` | Converting a decimal to a percentage | Year 7 | **`draft`** | **New.** Line-tag target — see §3.6 |

Every row also carries `difficultyTier: null`, `boardScope: []`, `aliases: []`,
`source: "teacher"`, `reviewedAt: null`.

`difficultyTier` is `null` on all seven: today's difficulty is authored per question, not
per subtopic, and inventing a tier would be fabricating curriculum. The field exists so
Phase 1's generated subtopics drop in without a migration.

Rows 6 and 7 are the only content in this whole migration that did not exist before. They
are marked `draft` so `grep '"status": "draft"' content/` finds them in one command.
Their justification is §3.6.

### 2.7 Questions (17)

`content/curriculum/questions.json`, **in exactly this order** — it is today's `PROBLEMS`
order and `questionAt(topicId, n)` depends on it (§5.6).

| file # | old id | **New QuestionId** | subtopicId | familyId | difficulty | idx within topic | `errorLineIndex` | distractors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `lin-ce-1` | `alg.linear.cross-equals.q01` | `alg.linear.cross-equals` | `cross-equals` | foundations | 0 | 1 | ✓ |
| 2 | `lin-ce-2` | `alg.linear.cross-equals.q02` | `alg.linear.cross-equals` | `cross-equals` | core | 1 | 1 | ✓ |
| 3 | `lin-ce-3` | `alg.linear.cross-equals.q03` | `alg.linear.cross-equals` | `cross-equals` | core | 2 | 1 | ✓ |
| 4 | `lin-ce-4` | `alg.linear.cross-equals.q04` | `alg.linear.cross-equals` | `cross-equals` | stretch | 3 | 1 | ✓ |
| 5 | `lin-dn-1` | `alg.linear.divide-negative.q01` | `alg.linear.divide-negative` | `divide-negative` | foundations | 4 | 3 | ✓ |
| 6 | `lin-dn-2` | `alg.linear.divide-negative.q02` | `alg.linear.divide-negative` | `divide-negative` | stretch | 5 | 3 | ✓ |
| 7 | `sub-two-1` | `alg.substitution.two-term.q01` | `alg.substitution.two-term` | `two-term` | foundations | 0 | 1 | — |
| 8 | `sub-two-2` | `alg.substitution.two-term.q02` | `alg.substitution.two-term` | `two-term` | core | 1 | 1 | — |
| 9 | `sub-two-3` | `alg.substitution.two-term.q03` | `alg.substitution.two-term` | `two-term` | stretch | 2 | 1 | — |
| 10 | `sub-two-4` | `alg.substitution.two-term.q04` | `alg.substitution.two-term` | `two-term` | core | 3 | 1 | — |
| 11 | `sub-one-1` | `alg.substitution.single-term.q01` | `alg.substitution.single-term` | `single-term` | stretch | 4 | 1 | — |
| 12 | `sub-one-2` | `alg.substitution.single-term.q02` | `alg.substitution.single-term` | `single-term` | foundations | 5 | 1 | — |
| 13 | `fracpct-1` | `num.fractions-to-percent.convert.q01` | `num.fractions-to-percent.convert` | `convert` | stretch | 0 | 1 | ✓ |
| 14 | `fracpct-2` | `num.fractions-to-percent.convert.q02` | `num.fractions-to-percent.convert` | `convert` | foundations | 1 | 1 | ✓ |
| 15 | `fracpct-3` | `num.fractions-to-percent.convert.q03` | `num.fractions-to-percent.convert` | `convert` | core | 2 | 1 | ✓ |
| 16 | `fracpct-4` | `num.fractions-to-percent.convert.q04` | `num.fractions-to-percent.convert` | `convert` | stretch | 3 | 1 | ✓ |
| 17 | `fracpct-5` | `num.fractions-to-percent.convert.q05` | `num.fractions-to-percent.convert` | `convert` | core | 4 | 1 | ✓ |

Every row also carries `boardStyle: null`, `aliases: []`, `source: "teacher"`,
`reviewedAt: null`, `status: "verified"`.

**Verify against the two ordering-sensitive call sites** (`DiagnosticTest.tsx:36–43`,
`TeacherApp.tsx:22`):

```
questionAt('alg.linear', 0)             → alg.linear.cross-equals.q01          (was lin-ce-1)
questionAt('alg.linear', 4)             → alg.linear.divide-negative.q01       (was lin-dn-1)
questionAt('alg.substitution', 0)       → alg.substitution.two-term.q01        (was sub-two-1)
questionAt('alg.substitution', 5)       → alg.substitution.single-term.q02     (was sub-one-2)
questionAt('num.fractions-to-percent', 1) → num.fractions-to-percent.convert.q02 (was fracpct-2)
questionAt('num.fractions-to-percent', 2) → num.fractions-to-percent.convert.q03 (was fracpct-3)
```

All `prompt`, `statement`, `answerLabel`, `correctAnswer`, `lines[].text`,
`lines[].note`, `distractors[].text` and `distractors[].cause` values are copied
**byte-for-byte**, including the Unicode minus `−` (U+2212), fraction slash `⁄` (U+2044),
multiplication sign `×`, division sign `÷` and right arrow `→`. Do not "normalise" them to
ASCII; `PracticeLoop`'s answer comparison and the rendered statements both depend on the
exact characters. Note that the `cause` strings contain **ASCII hyphen-minus** where the
source comments use one — do not upgrade those to en dashes.

### 2.8 Distractors and their causes (11 questions × 3)

`Question.distractors` is `{ text, cause }[]`, not `string[]` (§3.8). The `cause` values
are **not new content**: they are the per-distractor explanations already authored as
comments immediately above each `distractors` array in `problems.ts`. Lift each comment
line verbatim, minus its leading `<value>: ` prefix and its trailing full stop.

| QuestionId | text → cause |
| --- | --- |
| `alg.linear.cross-equals.q01` | `4` → `didn't flip the sign crossing the = (3x = 11 − 7) and forgot the final ÷3`<br>`18` → `correctly crossed to 3x = 18 but forgot to divide by 3`<br>`9` → `divided 18 ÷ 3 wrong` |
| `alg.linear.cross-equals.q02` | `12` → `didn't flip the sign crossing the = (5x = 16 − 4) and forgot the final ÷5`<br>`20` → `correctly crossed to 5x = 20 but forgot to divide by 5`<br>`5` → `divided 20 ÷ 5 wrong` |
| `alg.linear.cross-equals.q03` | `3⁄2` → `didn't flip the sign crossing the = (4x = 15 − 9 = 6) but still divided by 4`<br>`24` → `correctly crossed to 4x = 24 but forgot to divide by 4`<br>`8` → `divided 24 ÷ 4 wrong` |
| `alg.linear.cross-equals.q04` | `8` → `didn't flip the sign crossing the = (2x = 13 − 5) and forgot the final ÷2`<br>`18` → `correctly crossed to 2x = 18 but forgot to divide by 2`<br>`16` → `confused divide-by-2 with subtract-2 on the final step` |
| `alg.linear.divide-negative.q01` | `−2` → `forgot a negative divided by a negative is positive (−4 ÷ −2 read as −2)`<br>`−4` → `correctly reached −2x = −4 but forgot to divide by −2 at all`<br>`3` → `divided −4 ÷ −2 wrong` |
| `alg.linear.divide-negative.q02` | `−3` → `forgot a negative divided by a negative is positive (−9 ÷ −3 read as −3)`<br>`−9` → `correctly reached −3x = −9 but forgot to divide by −3 at all`<br>`4` → `divided −9 ÷ −3 wrong` |
| `num.fractions-to-percent.convert.q01` | `0.375%` → `forgot the final ×100 step`<br>`3.75%` → `multiplied by 10 instead of 100 - decimal point in the wrong place`<br>`266.7%` → `divided the wrong way round (8 ÷ 3 instead of 3 ÷ 8)` |
| `num.fractions-to-percent.convert.q02` | `0.25%` → `forgot the final ×100 step`<br>`2.5%` → `multiplied by 10 instead of 100 - decimal point in the wrong place`<br>`400%` → `divided the wrong way round (4 ÷ 1 instead of 1 ÷ 4)` |
| `num.fractions-to-percent.convert.q03` | `0.35%` → `forgot the final ×100 step`<br>`3.5%` → `multiplied by 10 instead of 100 - decimal point in the wrong place`<br>`285.7%` → `divided the wrong way round (20 ÷ 7 instead of 7 ÷ 20)` |
| `num.fractions-to-percent.convert.q04` | `0.225%` → `forgot the final ×100 step`<br>`2.25%` → `multiplied by 10 instead of 100 - decimal point in the wrong place`<br>`444.4%` → `divided the wrong way round (40 ÷ 9 instead of 9 ÷ 40)` |
| `num.fractions-to-percent.convert.q05` | `0.44%` → `forgot the final ×100 step`<br>`4.4%` → `multiplied by 10 instead of 100 - decimal point in the wrong place`<br>`227.3%` → `divided the wrong way round (25 ÷ 11 instead of 11 ÷ 25)` |

The six `alg.substitution.*` questions omit `distractors` entirely (§4.4). Distractor
**order** within each array is today's order and is preserved: `PracticeLoop` shuffles at
render time, but `E_DISTRACTOR_COUNT` and any future diffing read the authored order.

### 2.9 Question line prerequisite tags (10)

`QuestionLine.prereqSubtopicIds` is an **array** (§3.6). Nine of the ten seed values sit
on the five `num.fractions-to-percent.convert.*` questions; every other line in the seed
content has `"prereqSubtopicIds": []`.

For each of `…convert.q01` … `…convert.q05`:

```
line 0   "<n>⁄<d> as a %"       prereqSubtopicIds: []
line 1   "<n> ÷ <d> = <dec>"    prereqSubtopicIds: ["num.fractions.to-decimal"]
line 2   "<dec> × 100"          prereqSubtopicIds: ["num.decimals.to-percent"]
line 3   "<pct>%"               prereqSubtopicIds: []
```

That is 5 questions × 2 tagged lines = **10 tags across 10 lines**, out of 67 lines.

### 2.10 Lessons (1)

`content/curriculum/lessons.json`.

| old `LESSONS` key | `topicId` | prerequisites (was `concepts`) |
| --- | --- | --- |
| `linear` | `alg.linear` | `alg.linear.cross-equals`, `alg.linear.divide-negative` (in that order) |

`Lesson.id` (`'linear'`) and `Lesson.subtopic` (`'Linear equations'`) are both dropped:
the first duplicated the topic key, the second duplicated the topic label. Both are
re-supplied by hydration (§5.3).

`Concept.id` / `Concept.label` are dropped from the authored form and re-supplied by
hydration from the subtopic (`id` = the subtopic id, `label` = the subtopic label). The
subtopic labels in §2.6 rows 1–2 are the old `Concept.label` values verbatim, so
`LessonSession`'s rendering is unchanged.

`Concept.checkProblems` is dropped **and not re-supplied by hydration.** It was
`problemsForTopic('linear').filter(p => p.familyId === '…')`, which is exactly
`questionsForSubtopic(subtopicId)`; the caller now calls that directly (§3.12 and §6.4).

### 2.11 Teachers (4) and classes (8)

`content/school/teachers.json`:

| old `id` | **New TeacherId** | name | subject | classIds |
| --- | --- | --- | --- | --- |
| `t1` | `teacher.okafor` | Ms. Okafor | Mathematics | `8M2`, `8M4`, `9S1` |
| `t2` | `teacher.whitfield` | Mr. Whitfield | English | `8E1`, `9E3` |
| `t3` | `teacher.petrova` | Dr. Petrova | Science | `7S2`, `8S1` |
| `t4` | `teacher.adeyemi` | Mr. Adeyemi | History | `9H1` |

`Teacher.classKeys` is renamed `Teacher.classIds`.

`content/school/classes.json` — `SchoolClass.key` is renamed `SchoolClass.id`; the values
are unchanged. `SchoolClass.grade` is renamed `SchoolClass.yearBand`.

| **ClassId** | subject | yearBand | teacherId |
| --- | --- | --- | --- |
| `8M2` | Mathematics | Year 8 | `teacher.okafor` |
| `8M4` | Mathematics | Year 8 | `teacher.okafor` |
| `9S1` | Mathematics | Year 9 | `teacher.okafor` |
| `8E1` | English | Year 8 | `teacher.whitfield` |
| `9E3` | English | Year 9 | `teacher.whitfield` |
| `7S2` | Science | Year 7 | `teacher.petrova` |
| `8S1` | Science | Year 8 | `teacher.petrova` |
| `9H1` | History | Year 9 | `teacher.adeyemi` |

`AdminApp.tsx` generates ids for teachers added in-session. Today: `` `t${st.teacherSeq}` ``
with `teacherSeq` initialised to `TEACHERS.length + 1`. New: `` `teacher.new-${st.teacherSeq}` ``,
`teacherSeq` initialised to `teachers().length + 1`. Keep `teacherSeq` in state.

### 2.12 Class setup defaults

`content/school/class-defaults.json`.

`DEFAULT_ROSTER` — unchanged, 8 names in order: Aisha Bello, Daniel Kovač, Reuben Clarke,
Priya Shah, Tom Weller, Grace Idowu, Elif Demir, Oscar Reid.

`DEFAULT_BASKET` becomes an **array of topic ids** (`basket: TopicId[]`), since every
value in today's `Record<string, boolean>` is `true`. The accessor rebuilds the Record
(§5.6). 14 entries, in today's key order:

```
num.negatives, num.fractions, num.fractions-to-percent, num.ratio, num.proportion,
alg.notation, alg.substitution, alg.expanding, alg.factorising, alg.linear,
geo.coordinates, geo.angles, stat.averages, stat.probability
```

### 2.13 Sample student ids

Unchanged: `aisha`, `daniel`, `reuben`. `ParentApp.tsx:16` and `StudentApp.tsx:26` keep
`const STUDENT_ID = 'aisha'`; `TeacherApp.tsx`'s `ATTENTION` array keeps its `id` values.

### 2.14 Sample profile row → topic joins

`studentProfiles.ts`'s rows carry display labels that do not all match a catalogue label.
The unified schema keeps the display string **and** adds an explicit `topicId` join, which
is what lets `normalizeTopicName()` die. These are the only correct joins:

| display label (kept verbatim as `label`) | `topicId` | appears in |
| --- | --- | --- |
| `Negatives` | `num.negatives` | pace, mastery |
| `Substitution` | `alg.substitution` | pace, mastery, workingOnNow |
| `Linear equations` | `alg.linear` | pace, mastery, workingOnNow |
| `Fractions & %` | `num.fractions-to-percent` | pace, mastery |
| `Fractions → %` | `num.fractions-to-percent` | workingOnNow |
| `Algebra basics` | `alg.basics` | pace, mastery |
| `Ratio & proportion` | **`null`** | pace, mastery |

Across the three students that is 28 rows, 25 with a non-null `topicId` and 3 null (Aisha
pace, Reuben pace, Reuben mastery — all `Ratio & proportion`).

**`Ratio & proportion` is `null` on purpose.** It is a graph-filter label
(`graphFilters()[1].label`), not a topic. There is no topic it can honestly join to, and
today's fuzzy matcher failed to join it too — so `null` is behaviour-preserving.

**`Algebra basics` → `alg.basics` is a deliberate, traced behaviour delta.** Today's
matcher fails on it and leaves it unseeded; the unified id succeeds. The only consumer of
`EngineState.masteryByTopic` is `StudentApp.tsx`, which is Aisha-only, and Aisha has no
`Algebra basics` row. Daniel's and Reuben's profiles are read directly by `TeacherApp.tsx`
from `studentProfile()`, never through the engine. Net rendered change: none. This is
recorded here rather than hidden because a reviewer should be able to check it.

### 2.15 Sample node states

`content/samples/node-states.json` merges today's `NODE_STATUS_BY_STUDENT` and
`NODE_STATS_BY_STUDENT` into one map per student — they are keyed identically, always
populated together, and `initEngineState` already joins them. Both cover all 15 graph
topics for all 3 students today, so the merge is lossless and the fallbacks (§5.6) never
fire on seed data.

Keys are the topic ids from §2.2's node→topic index. Values keep today's `status`,
`last`, `next`, `reps` byte-for-byte, including `'today · free play'`,
`'2 days ago · free play'`, `'—'` (U+2014 em dash) and `'when ready'`.

---

## 3. Modelling decisions, with reasons

### 3.1 The graph is the *topic* graph

`knowledgeGraph.ts`'s docblock and `GraphSvg.tsx`'s comment both say "subtopic". They are
wrong, and constraint 4 settles it: the 15 nodes are the same entities as the curriculum
topics, so the nodes are topics.

**UI copy that says "subtopic" stays as it is** (`TeacherApp.tsx:941`, `:1103`, `:1441`;
`GraphSvg.tsx:26`). It is not part of the Concept→Prerequisite rename and changing it
would fail S6. Fix the source comments in `GraphSvg.tsx`; leave rendered strings alone.

### 3.2 One entity, three independent facets

```
Topic.catalogue: boolean            → in the teacher-facing topic picker   (37 of 39)
Topic.onGraph:  boolean             → a node in the prerequisite graph     (15 of 39)
Topic.graph:    {order,x,y,label}|null → hand-authored layout for that node  (15 of 39)
```

None implies another. This is the whole unification: one `TopicId` namespace, three
independent facts about how a topic surfaces.

`onGraph` and `graph` are split because they are genuinely different facts and they stop
coinciding at Phase 1. G3 says Phase 1 fills the graph, which means all ~200 topics become
graph nodes — and nobody is going to hand-author 200 x/y pairs and 200 short labels. Phase
1 will compute the layout, at which point `graph !== null` stops meaning "is a node" and
three validator rules break with it (`E_REF_FILTER_TOPIC`, `E_REF_SAMPLE_TOPIC`,
`W_ORPHAN_GRAPH_TOPIC` all key on graph membership). The same problem arrives again at
8,000 subtopics, which will never have authored coordinates at all.

So: **`onGraph` is the membership predicate.** `isGraphTopic()` and all three validator
rules read it. `graph` is the authored layout override, which today every graph topic has
and tomorrow most will not.

Today all 15 rows carry both and 24 carry neither, so nothing changes now. Validator:
`E_GRAPH_PLACEMENT_ORPHAN` — `graph !== null && onGraph === false` is always wrong.
`W_GRAPH_NO_PLACEMENT` — `onGraph === true && graph === null` is a warning; it must not
fire on seed data, and it becomes routine once layouts are computed.

`graphTopics()` returns only topics that have **both** `onGraph: true` and a non-null
`graph` — it cannot construct a `GraphTopic` without coordinates. When computed layout
arrives, the layout engine feeds `graph` and the accessor is unchanged.

### 3.3 `Topic.graph.label` and `Topic.graph.order` are always authored, never derived

Four graph labels differ from their catalogue labels (`% change`, `Expanding ( )`,
`Bracket eqns`, `Simultaneous`) because a 132×42 SVG node cannot hold
`Equations with brackets`. `Topic.graph.label` is therefore **required whenever `graph` is
non-null**, and is authored explicitly even when it equals `Topic.label`. No fallback
logic, so no agent can implement the fallback differently.

`Topic.graph.order` is required for the same reason, plus the rendering-change argument in
§2.2. It is a positive integer, unique across graph topics, and it is **the one sanctioned
sort key in the whole store** (§0.2). `graphTopics()` sorts ascending by it; nothing else
sorts anything. Validator: `E_GRAPH_ORDER_DUPLICATE`, `E_GRAPH_ORDER_RANGE` (`< 1` or not
an integer).

### 3.4 Subtopics are today's problem families

`problems.ts`'s `familyId` groups "same structure, different numbers". `lessons.ts`'s two
`Concept` ids (`cross-equals`, `divide-negative`) are exactly those two families. And
`build-plan.md` §0.2's own worked example is `alg.linear.cross-equals`. The seed data
already contains a subtopic layer; it was just spelled `familyId`.

### 3.5 `familyId` survives as a separate field, one level below subtopic

`build-plan.md` §0.1 gives `question` both a `subtopic_id` and a `family_id`, and §2.3
sizes a subtopic at ~40 questions in ~8 families. Family is therefore *finer* than
subtopic, and today's 1:1 family↔subtopic mapping is an artefact of a 17-question bank,
not the model.

- `Question.familyId` is a slug **scoped to the parent subtopic**, not globally unique in
  principle. Seed values are the last segment of the subtopic id (`cross-equals`,
  `divide-negative`, `two-term`, `single-term`, `convert`) — which happen also to be
  globally unique today.
- **`similarQuestion()` matches on `(subtopicId, familyId)`, not `familyId` alone.**
  Today's `similarProblem()` matches globally; with these five values the results are
  provably identical, and the scoped version stays correct when Phase 2 reuses family
  slugs across subtopics.

### 3.6 `QuestionLine.prereqSubtopicIds` — plural, and populated minimally on purpose

This is the commercially important field (`build-plan.md` §0.1). Two decisions here.

**It is an array, not a scalar.** `build-plan.md` §0.1's table and §2.1's example JSON both
show a singular `prereq_subtopic_id`, and this is a deliberate, recorded deviation from
them. A single line of working frequently exercises more than one prerequisite —
`3/8 = 0.375` tests fraction-to-decimal conversion *and* division; the build plan's own
example line `total = 3 + 5 = 8` is tagged only `num.arith.addition` because the schema
had one slot. Widening after generation is a rewrite of ~1.3M `question_line` rows plus
every reader including the ancestry gate. Widening now costs ten seed tags. An array is a
strict superset of the build plan's field, so a generator that emits one id per line drops
in unchanged. Empty array replaces `null`; §8.5 rule 9 iterates.

**It is populated on ten lines and no others.** Leaving it entirely empty would ship a
schema nobody has exercised and an ancestry check nobody has run. Populating it broadly
would require inventing ~20 subtopics, which is fabricating curriculum. The middle path:

- Add exactly two `draft` subtopics named by the existing sample content's own prose —
  `num.fractions.to-decimal` ("divide the numerator by the denominator") and
  `num.decimals.to-percent` ("multiply by 100 to convert to a percentage"), both taken
  verbatim from `problems.ts`'s `solNotes` on the `fracpct` family.
- Tag lines 1 and 2 of all five `num.fractions-to-percent.convert.*` questions with them
  (§2.9). Every one of those five questions has the identical four-line shape.
- **Every other question line in the seed content has `prereqSubtopicIds: []`.**

This exercises the ancestry check (§8.5, rule 9) end to end under its tier-B rule, and it
passes: `num.fractions → num.fractions-to-percent` (edge 3) and `num.decimals →
num.fractions-to-percent` (edge 4) both exist, so both tags name a strict topic-graph
ancestor of the question's topic. Nothing in the UI reads `prereqSubtopicIds`, so this
cannot affect rendering.

### 3.7 `lines` + `solNotes` merge into `QuestionLine[]`

Today `Problem.lines: string[]` and `Problem.solNotes: string[]` are parallel arrays,
equal-length in all 17 problems, and `build-plan.md` §0.1's `question_line` row is
`(latex, prereq_subtopic_id, note)` — one row, three fields. Merging them is the
build-plan shape and it is where the prerequisite tags have to hang.

**The field is `text`, not `latex`.** The seed content is plain Unicode maths
(`3x − 7 = 11`), rendered as a string by `PracticeLoop`. Calling it `latex` would
misdescribe every row in the store and invite a renderer that tries to parse it. Rename
to `latex` (or add a `format` discriminator) when real LaTeX arrives; a field rename is a
one-line codemod, a mis-rendered question bank is not.

`Problem.errIdx` becomes `Question.errorLineIndex` and stays question-level: it marks
which *step* students typically slip on, which is a property of the question, not of a
line.

### 3.8 Distractors carry their misconception

`distractors` becomes `{ text, cause }[]` rather than `string[]`. Three reasons:

1. `build-plan.md` §2.1's mandated generation output has `distractor_causes` alongside
   `distractors`, and §2.6 gate 4 is "each distractor traces to a named misconception, not
   a random number". Neither the storage nor the check exists in a `string[]`.
2. Two parallel arrays is precisely the mistake §3.7 just spent a paragraph undoing. Doing
   it again one field later would be indefensible.
3. **The causes already exist.** All 33 of them are authored as comments directly above
   the `distractors` arrays in `problems.ts` (§2.8). This is not new content; it is
   existing authored content that the current type has nowhere to put. Nothing is
   fabricated and no seed row needs an empty `cause`.

Retro-fitting causes across 320,000 questions after generation is exactly the "add it
afterwards" pass `build-plan.md` §2.1 says not to do.

`distractors` remains **absent** (not `[]`, not `null`) on a question with none —
`PracticeLoop`'s `mcq` path keys on absence. Call-site change: `distractors.slice(0, 3)`
becomes `distractors.slice(0, 3).map(d => d.text)` (§6.7).

### 3.9 Status vocabulary and provenance

`ContentStatus` is six values, not two:

```ts
export type ContentStatus =
  | 'draft' | 'generated' | 'in-review' | 'verified' | 'rejected' | 'retired'
```

A two-value enum with `E_STATUS` making any third an error cannot represent what
`build-plan.md` §2.6's own exit criterion implies: "≥85% of generated questions usable
without edit" means ~48,000 of 320,000 questions are neither draft nor verified. A
rejected question must be *data* — kept, queryable, and countable — not a deletion.
`retired` is what §1.4's "ordinals are never reused" needs in order to be true.

Alongside it, `Topic`, `Subtopic` and `Question` each carry:

```ts
source: ContentSource         // 'ai' | 'teacher' | 'imported'
reviewedAt: string | null     // ISO-8601 date, or null
```

`PrereqEdge` already had `source`/`confidence` for `build-plan.md` §1.4's three-source
verification ladder; the entities that actually get reviewed in bulk did not. All three
are `source: "teacher"`, `reviewedAt: null` throughout the seed content: it was
hand-authored by a human, and no formal review has happened.

**Accessors do not filter on status in Phase 0.** Every authored row is served. This is
deliberate and it is not an oversight: `questionAt(topicId, n)` addresses a question by
its *position* in `questionsForTopic`, so the moment an accessor drops `rejected` or
`retired` rows, retiring one question silently re-points `questionAt('alg.linear', 4)` at
a different question and `DiagnosticTest` changes. The serving policy is a Phase 2
decision and needs a positional-addressing fix first; it is recorded in §9.2 (D3). Widening
the enum now is free; deciding the filter now is not.

### 3.10 Exam boards live on subtopics and questions, not topics

`Topic.examBoardTags: string[]` is **deleted**, not carried forward.

`build-plan.md` §0.1's table put `exam_board_tags[]` on `topic`; §4 — the phase that
actually does the work — specifies "a `board_scope` tag per **subtopic** per board (AQA /
Edexcel / OCR / WJEC)" and "a `board_style` tag on **questions**". §4 is the more specific
and later statement and it wins. A flat `string[]` on Topic would be empty everywhere by
G7's own admission, superseded rather than filled, and would invite a Phase 4 agent to
populate the wrong entity — which is worse than the field being absent.

A flat string array also cannot express what UK GCSE requires. Scope is a relation over
(subtopic, board, **tier**), and Foundation vs Higher is the load-bearing distinction:

```ts
Subtopic.boardScope: readonly BoardScope[]   // [] in all 7 seed rows
Question.boardStyle: string | null           // null in all 17 seed rows
```

Zero cost today, correctly shaped for Phase 4. `E_REF_BOARD` (§8.5 rule 5) checks the
board and tier enums.

### 3.11 `ST` and `OVERSIGHT_KIND_META` are design tokens, not content

Both are palettes keyed by a domain enum. They move to `src/theme.ts`, next to the rest of
the palette:

- `ST` → **`NODE_STYLE: Record<NodeStatus, NodeStyle>`** (renamed; `ST` is unreadable in
  a design-token file). 3 call sites.
- `OVERSIGHT_KIND_META` → **`Record<OversightKind, OversightKindStyle>`**, same name,
  moved. 1 call site. Its value shape is anonymous today
  (`{ label; color; bg; bd }`, `oversight.ts:30–37`); it gets a declared name in
  `schema.ts` so two agents cannot invent two names for it.

`theme.ts` imports nothing but `CSSProperties` today. It gains one type-only import,
which §5.8's direct-import exemption permits:

```ts
import type { NodeStatus, NodeStyle, OversightKind, OversightKindStyle } from './content/schema'
```

`edgePath()` is SVG geometry, not content: it moves to `src/content/graphGeometry.ts` and
reads coordinates from the store.

### 3.12 Two tiers: CORE and BANK

The loader is `async` at the seam and synchronous everywhere below it (constraint 2), and
that does not change. What does change is the claim that "the future HTTP swap is
`readBundle` and nothing else". At Phase 2 scale that is false, and saying it out loud
now is cheap while fixing it later is not:

- `questions` is ~320,000 rows (~1.3M `QuestionLine` objects) and `reteach-cards` is
  ~1.6M rows (`build-plan.md` §2.2). A `fetch()` of `/curriculum/questions` is still the
  whole bank.
- A `buildStore` that iterates every question to build `questionById`, `questionsByTopic`
  and `questionsBySubtopic` does hundreds of MB of work on the main thread before first
  render.
- Eagerly hydrating `LessonPrerequisite.checkProblems` is a store-build-time join across
  the full bank, per lesson, per prerequisite.

So the content splits into two tiers, **today, at zero cost on 17 questions**:

| tier | files | size at Phase 2 | loading |
| --- | --- | --- | --- |
| **CORE** | meta, strands, topics, subtopics, both edge files, graph-filters, lessons, all of `school/`, all of `samples/` | a few MB at 8,000 subtopics | always eager, always fully indexed, always synchronous |
| **BANK** | questions, reteach-cards | ~40 MB+ | reached **only** through `QuestionBank`, the documented future-async surface |

Concretely (§5.4): `RawContentBundle` is `{ core: CoreBundle; bank: RawQuestionBank }`;
`ContentStore.bank` is a `QuestionBank` **interface**, implemented today by
`createInMemoryBank()` and tomorrow by a fetch-and-cache bank; `buildStore` never iterates
the bank. The six accessors that reach it — `questionById`, `questionsForTopic`,
`questionsForSubtopic`, `questionAt`, `similarQuestion`, `reteachCardFor` — keep their
present names, signatures and synchrony, so **no call site changes**.

Two consequences worth stating explicitly:

- **There is no `questions()` accessor and no `ContentStore.questions` array.** "Give me
  every question" is the one operation a lazy bank cannot serve, and nothing in the app
  needs it (nothing imports `PROBLEMS` today — `DiagnosticTest`'s own comment says it
  deliberately goes through `problemAt` instead). The validator reads the JSON files
  directly, not the store.
- **`LessonPrerequisite.checkProblems` is dropped from the hydrated type.**
  `LessonSession.tsx:159`'s `const pool = concept.checkProblems` becomes
  `const pool = questionsForSubtopic(prereq.subtopicId)` — one line now, instead of a
  refactor of the lesson hydration later. The pool is the identical array, in the identical
  order.

What is **not** in scope: making bank accessors return "empty pending load" and requiring
call sites to tolerate it. Today's call sites demonstrably do not
(`ReviewSession.tsx:126` does `pool[Math.min(s.qIdx, pool.length - 1)]`;
`StudentApp.tsx:575` does `pool[s.fpProblemIdx % pool.length]`; both crash on an empty
pool), and making them tolerate it is a behaviour change, not a refactor. It is recorded
in §9.2 (D1) as a precondition for whoever ships the async bank.

### 3.13 No compatibility re-exports

Every deleted module is deleted outright. No `src/data/curriculum.ts` shim re-exporting
`topicLabel`. With five agents working in parallel, a shim is exactly the mechanism by
which two of them ship against different APIs and nobody notices until integration. A
hard break makes divergence a compile error.

---

## 4. `content/` — the JSON file layout

### 4.1 Directory tree (17 files)

```
content/
  curriculum/                         ← what Phase 1 & 2 generation writes
    meta.json                         CORE
    strands.json                      CORE
    topics.json                       CORE
    subtopics.json                    CORE
    prereq-edges.topic.json           CORE
    prereq-edges.subtopic.json        CORE   ← "items": [] today
    graph-filters.json                CORE
    lessons.json                      CORE
    questions.json                    BANK
    reteach-cards.json                BANK   ← "items": [] today
  school/                             ← org configuration, all CORE
    teachers.json
    classes.json
    class-defaults.json
  samples/                            ← demo fixtures, all CORE; a real deployment has a database here
    node-states.json
    student-profiles.json
    activity-log.json
    oversight.json
  __fixtures__/                       ← deliberately-broken (and one deliberately-fine) bundles for the validator's own tests
    invalid-cycle/…
    invalid-year-band/…
    invalid-ref/…
    invalid-grammar/…
    invalid-ancestry/…
    valid-ancestry-sibling/…
```

**17 content files**: 10 curriculum + 3 school + 4 samples. Every count in §8 uses this
number. The `__fixtures__/` bundles are not part of `content/`'s own validation run.

CORE / BANK is the tiering from §3.12. It is a loading and indexing distinction, not a
directory one — the files stay where they are.

### 4.2 One file per entity type; sharding when it matters

**Decision: one file per entity type, not one file per strand.**

Reasons:
1. It matches the target tables in `build-plan.md` §0.1 one-to-one, so the Phase 2
   generator writes a file per table and drops it in.
2. Every cross-entity relationship (edges, question→subtopic, filter→topic) is
   inherently cross-strand. `alg.simultaneous` sits in the `filter.geometry` filter; edge
   10 runs `alg.basics → geo.coordinates`. A per-strand layout would need a "cross-strand"
   file, which is a per-entity-type file with extra steps.
3. Diffs stay legible: a curriculum change touches one file, not four.

**How it scales — and the shard key is not the strand.** Any `items` file may be replaced
by a directory of shards, but the shard key must be the intended *lazy-load unit*, because
sharding only buys anything if the loader can fetch one shard instead of all of them:

| file | shard key | shards | rows/shard at Phase 2 | loader rule |
| --- | --- | --- | --- | --- |
| `subtopics.json` | strand | ~15 | ~500 | **concatenate all**, in `index.json` order |
| `prereq-edges.*.json` | strand of `to` | ~15 | ~2,000 | **concatenate all**, in `index.json` order |
| `questions.json` | **topic id** | ~200 | ~1,600 | **fetch the shard containing the requested id** |
| `reteach-cards.json` | **topic id** | ~200 | ~8,000 | **fetch the shard containing the requested id** |

```
content/curriculum/questions/
  index.json      { "shardKey": "topic", "shards": ["num.negatives", "num.fractions", …] }
  num.negatives.json   { schemaVersion, kind: "question", items: [ … ] }
  num.fractions.json
  …
```

Sharding a CORE file by strand and concatenating is legitimate: it is a git-diff
ergonomics win on a tier that is loaded whole anyway. Sharding a BANK file by strand and
concatenating buys **nothing** — four strands over 320,000 questions is ~80,000 rows and
~40 MB per shard, past what a browser should download, and concatenation means the bytes
loaded are unchanged either way. Topic-keyed shards are the unit `QuestionBank.forTopic`
already asks for, and `QuestionBank.byId` derives the shard from the id by taking the
first two segments.

**Ordering contract under sharding** (§5.6): authored order is *within-shard order, in
the shard order `index.json` declares*. Stated that way it survives partial loading; stated
as "the concatenation of every shard" it would require the whole set to exist before any
order is defined.

Today: no shards, and `X.json` is present for every entity type. The loader's rule is: if
`X.json` exists, read it; else read `X/index.json` and apply the rule from the table
above. **Do not build the shard reader now.** §5.2's swap point is the same place it will
go.

### 4.3 File envelope

Every file except `meta.json` and `class-defaults.json`:

```json
{
  "schemaVersion": 1,
  "kind": "topic",
  "items": [ … ]
}
```

- `schemaVersion` — integer, `1`. Must equal `meta.json`'s `schemaVersion`.
- `kind` — one of: `meta`, `class-defaults`, `strand`, `topic`, `subtopic`,
  `topic-prereq-edge`, `subtopic-prereq-edge`, `graph-filter`, `question`,
  `reteach-card`, `lesson`, `teacher`, `school-class`, `student-node-states`,
  `student-profile`, `student-activity-log`, `oversight-item`. **17 values.**
  `meta` and `class-defaults` are the two that do **not** carry an `items` envelope; they
  are in the enum because `E_ENVELOPE` checks `kind` against this list for every file
  including those two. Redundant with the filename by design: a shard file carries its own
  kind, and a mis-wired loader fails loudly.
- `items` — array. **Order is significant** (§5.6).

`meta.json`:

```json
{
  "schemaVersion": 1,
  "kind": "meta",
  "contentVersion": "2026-08-02.1",
  "topicGraphVersion": "topic-graph-2026-08-02.1",
  "subtopicGraphVersion": "subtopic-graph-2026-08-02.0",
  "graphHashes": { "topic": "<sha256 hex>", "subtopic": "<sha256 hex>" },
  "yearBands": ["Year 7", "Year 8", "Year 9"]
}
```

`build-plan.md` §0.2 requires a graph version so a re-run of the edge pass cannot silently
invalidate a stored student profile. Three corrections to the naive single-scalar form:

1. **Two versions, not one.** `prereq-edges.topic.json` and `prereq-edges.subtopic.json`
   are re-run independently and at different times (`build-plan.md` §1.2 vs §1.3). One
   scalar would make the Phase 1 subtopic pass invalidate every topic-level profile too.
2. **The version is enforced, not merely present.** `graphHashes.topic` /
   `.subtopic` hold the SHA-256, lowercase hex, of `JSON.stringify(items)` for the
   corresponding edge file — its `items` array exactly as parsed, with keys in the order
   §4.4 mandates, so the serialisation is deterministic. `E_GRAPH_VERSION_STALE` (§8.5
   rule 12) errors when a recorded hash disagrees with the recomputed one. Without this,
   "it must change whenever `prereq-edges.*.json` changes" is a sentence with nothing
   behind it.
3. **The version strings themselves are never machine-written.** Bumping one is a
   deliberate authoring act. `npm run validate:content -- --write-hashes` updates
   `graphHashes` in place and prints a reminder to bump the matching version string; it
   never touches the version strings itself.

Bootstrapping: agent 2 writes `"graphHashes": { "topic": "", "subtopic": "" }`. An empty
string produces `W_GRAPH_HASH_UNSET` (warning), not an error, so the bundle validates
before agent 4's CLI exists. Agent 4 runs `--write-hashes` once and commits the result; S5
then holds with zero warnings.

Nothing in the app reads any of these fields today.

`class-defaults.json`:

```json
{
  "schemaVersion": 1,
  "kind": "class-defaults",
  "roster": ["Aisha Bello", … ],
  "basket": ["num.negatives", … ]
}
```

### 4.4 Per-file item shapes

Formatting rules for every file: 2-space indent, LF endings, trailing newline, keys in
the order the TypeScript interface declares them, UTF-8 with no BOM. Do not escape
non-ASCII (`−`, `⁄`, `→`, `·`, `—`, `×`, `÷` appear literally).

```jsonc
// strands.json
{ "id": "num", "label": "Number" }

// topics.json
{
  "id": "num.negatives",
  "strandId": "num",
  "label": "Negatives",
  "yearBand": "Year 7",
  "catalogue": true,
  "onGraph": true,
  "graph": { "order": 1, "x": 24, "y": 44, "label": "Negatives" },
  "aliases": [],
  "source": "teacher",
  "reviewedAt": null,
  "status": "verified"
}
// …and, for a topic not on the graph:
{ "id": "num.rounding", …, "catalogue": true, "onGraph": false, "graph": null, "aliases": [], "source": "teacher", "reviewedAt": null, "status": "verified" }

// subtopics.json
{
  "id": "alg.linear.cross-equals",
  "topicId": "alg.linear",
  "label": "Moving a term across the =",
  "yearBand": "Year 8",
  "difficultyTier": null,
  "boardScope": [],
  "aliases": [],
  "source": "teacher",
  "reviewedAt": null,
  "status": "verified"
}

// prereq-edges.topic.json  /  prereq-edges.subtopic.json
{ "from": "num.negatives", "to": "num.negatives-arithmetic", "strength": 1, "source": "teacher", "confidence": 1 }
// `evidence` is optional and omitted entirely on all 17 seed edges.

// graph-filters.json
{ "id": "filter.number", "label": "Number", "topicIds": ["num.negatives", "num.fractions", "num.decimals", "num.negatives-arithmetic", "num.fractions-to-percent"] }

// questions.json
{
  "id": "alg.linear.cross-equals.q01",
  "topicId": "alg.linear",
  "subtopicId": "alg.linear.cross-equals",
  "familyId": "cross-equals",
  "difficulty": "foundations",
  "prompt": "Solve for x",
  "statement": "3x − 7 = 11",
  "answerLabel": "x =",
  "correctAnswer": "6",
  "lines": [
    { "text": "3x − 7 = 11",  "note": "",                                  "prereqSubtopicIds": [] },
    { "text": "3x = 11 + 7",  "note": "−7 crosses the =, so it becomes +7", "prereqSubtopicIds": [] },
    { "text": "3x = 18",      "note": "",                                  "prereqSubtopicIds": [] },
    { "text": "x = 6",        "note": "divide both sides by 3",            "prereqSubtopicIds": [] }
  ],
  "errorLineIndex": 1,
  "distractors": [
    { "text": "4",  "cause": "didn't flip the sign crossing the = (3x = 11 − 7) and forgot the final ÷3" },
    { "text": "18", "cause": "correctly crossed to 3x = 18 but forgot to divide by 3" },
    { "text": "9",  "cause": "divided 18 ÷ 3 wrong" }
  ],
  "boardStyle": null,
  "aliases": [],
  "source": "teacher",
  "reviewedAt": null,
  "status": "verified"
}
// `distractors` is omitted entirely (not `null`, not `[]`) on the six substitution
// questions that have none today — PracticeLoop's `mcq` path checks for its absence.

// reteach-cards.json  →  "items": []   (shape defined in §5.3; Phase 2 populates it)

// lessons.json
{
  "topicId": "alg.linear",
  "prerequisites": [
    {
      "subtopicId": "alg.linear.cross-equals",
      "transferIn": { "hook": "Two pans, always level", "body": ["…", "…"] },
      "teach": { "heading": "…", "body": ["…"], "exampleTitle": "…", "exampleSteps": ["…"] },
      "transferOut": { "prompt": "…", "placeholder": "…" }
    },
    { "subtopicId": "alg.linear.divide-negative", … }
  ]
}

// teachers.json
{ "id": "teacher.okafor", "name": "Ms. Okafor", "subject": "Mathematics", "classIds": ["8M2", "8M4", "9S1"] }

// classes.json
{ "id": "8M2", "subject": "Mathematics", "yearBand": "Year 8", "teacherId": "teacher.okafor" }

// samples/node-states.json
{
  "studentId": "aisha",
  "nodes": {
    "num.negatives": { "status": "mastered", "last": "today · free play", "next": "in 11 days", "reps": 16 },
    …15 entries, keyed by TopicId, written in ascending Topic.graph.order
       (i.e. the n1..n15 sequence in §2.2's node→topic index)…
  }
}

// samples/student-profiles.json
{
  "studentId": "aisha",
  "whereToStart": ["…", "…", "…"],
  "pace": [{ "label": "Ratio & proportion", "topicId": null, "tag": "Ahead · +1 term", "kind": "ahead", "actual": 0.88, "expected": 0.6 }, …],
  "mastery": [{ "label": "Negatives", "topicId": "num.negatives", "foundations": 1, "core": 0.9, "stretch": 0.6 }, …],
  "workingOnNow": { "label": "Linear equations", "topicId": "alg.linear", "detail": "…", "note": "…" }
}

// samples/activity-log.json
{ "studentId": "aisha", "activities": [ …LogActivity, verbatim from LOG_RAW… ] }

// samples/oversight.json
{ "kind": "uncertain", "student": "Aisha Bello", "context": "…", "title": "…", "body": "…", "asks": "…", "detail": { … } }
```

`LogActivity`, `LogQuestion`, `OversightItem` and `OversightDetail` are **pure
lift-and-shift**: same fields, same values, no `topicId` joins added. Nothing joins on
them today and adding speculative joins is how sample data drifts. Phase 3 adds them (G9).

`samples/activity-log.json` has 3 items: `aisha` (5 activities, today's `LOG_RAW`),
`daniel` (2), `reuben` (2) — 9 activities in total, exactly today's `LOG_BY_STUDENT`.
`samples/oversight.json` has 4 items, today's `OVERSIGHT_RAW` order.

---

## 5. TypeScript definitions and the store API

### 5.1 Module layout under `src/content/`

```
src/content/
  schema.ts          entity + id types.  NO imports except `type` imports from within this dir.
  validate.ts        hand-rolled structural predicates + slugify(), shared by the loader and the CLI.
  bank.ts            QuestionBank interface + createInMemoryBank().
  store.ts           ContentStore, buildStore(), the module singleton, requireStore().
  load.ts            loadContent(). The ONLY module that knows how content files are read.
  accessors.ts       the synchronous free functions components call.
  graphGeometry.ts   edgePath().
  index.ts           barrel. Everything outside src/content imports from here.
```

**Rule:** `schema.ts` and `validate.ts` are compiled by *both* `tsconfig.app.json` and
`tsconfig.node.json` — the CLI imports them, and only them, from `src/content/`. Every
import inside those two files must use an **explicit `.ts` extension**
(`import type { Topic } from './schema.ts'`) so they resolve under
`moduleResolution: "nodenext"` and under Node's native type stripping. `bank.ts` may use
the extension too (`allowImportingTsExtensions` is set in the app config) but is not
dual-compiled: the CLI never builds a store and never touches the bank. The other five
files are app-only and keep the extensionless style used elsewhere in `src/`.

### 5.2 The async seam

`src/content/load.ts` is the only module containing an `import()` or `fetch()` of content.
Today it uses dynamic JSON imports — verified working with `tsc -b` + `vite build` under
this repo's exact config, code-split into their own chunk:

```ts
async function readBundle(): Promise<RawContentBundle> {
  const [meta, strands, topics /* … */] = await Promise.all([
    import('../../content/curriculum/meta.json'),
    import('../../content/curriculum/strands.json'),
    import('../../content/curriculum/topics.json'),
    // …one entry per file in §4.1…
  ])
  return {
    core: { meta: meta.default, strands: strands.default, topics: topics.default, /* … */ },
    bank: { questions: questions.default, reteachCards: reteachCards.default },
  }
}
```

**Required tsconfig change:** add `"resolveJsonModule": true` to `tsconfig.app.json`'s
`compilerOptions`. (Already applied on this branch.) Nothing else in the build config
changes.

**The future HTTP swap is `readBundle` plus one `QuestionBank` implementation, and
nothing else.** For the CORE tier, replace each `import()` with
`fetch(`${BASE}/curriculum/topics`).then(r => r.json())` and keep the return type. For the
BANK tier, replace `createInMemoryBank(bundle.bank)` with a fetch-and-cache implementation
of the same interface. No other file in the repo changes, and no accessor signature
changes. That is the entire point of the seam; do not leak `import()` or `fetch` anywhere
else.

### 5.3 `src/content/schema.ts`

```ts
// ---------------------------------------------------------------------------
// ID aliases. Aliases, not brands: components pass plain strings today and
// branding them would add casts to ~40 call sites for no runtime benefit.
// ---------------------------------------------------------------------------
export type StrandId = string
export type TopicId = string
export type SubtopicId = string
export type QuestionId = string
export type GraphFilterId = string
export type TeacherId = string
export type ClassId = string
export type StudentId = string
export type FamilyId = string
/** Open on purpose: `meta.yearBands` is authored and grows past Year 9. */
export type YearBand = string

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------
/**
 * Six values, not two. build-plan §2.6's own exit criterion ("≥85% usable
 * without edit") implies ~48,000 questions that are neither draft nor
 * verified; a rejected question is data, not a deletion. See §3.9.
 * NOTE: no accessor filters on this field in Phase 0. See §3.9 and §9.2 D3.
 */
export type ContentStatus =
  | 'draft' | 'generated' | 'in-review' | 'verified' | 'rejected' | 'retired'
/** Provenance of an authored entity. Mirrors PrereqEdgeSource. */
export type ContentSource = 'ai' | 'teacher' | 'imported'
export type DifficultyTier = 'foundations' | 'core' | 'stretch'
export type NodeStatus = 'mastered' | 'inprogress' | 'frontier' | 'notready' | 'locked'
export type PrereqEdgeSource = 'ai' | 'teacher' | 'empirical'
export type ExamBoard = 'aqa' | 'edexcel' | 'ocr' | 'wjec'
export type ExamTier = 'foundation' | 'higher' | 'both'

// `MasteryTier` was declared in engine.ts and is structurally identical to
// DifficultyTier — the same three tiers, one naming the question and one naming
// the mastery slot it updates. Keep the alias so engine.ts's public type name
// survives; do not declare a second union.
export type MasteryTier = DifficultyTier

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------
export interface ContentMeta {
  schemaVersion: number
  contentVersion: string
  /** build-plan §0.2. Bumped by hand when prereq-edges.topic.json changes. */
  topicGraphVersion: string
  /** Bumped by hand when prereq-edges.subtopic.json changes. */
  subtopicGraphVersion: string
  /** SHA-256 hex of each edge file's `items`. '' = not yet computed. §4.3. */
  graphHashes: { topic: string; subtopic: string }
  yearBands: readonly YearBand[]
}

export interface Strand {
  id: StrandId
  label: string
}

/**
 * Hand-authored layout for a topic drawn on the knowledge graph. OPTIONAL in
 * the model (`Topic.graph` may be null while `Topic.onGraph` is true) because
 * Phase 1 computes layouts for ~200 topics rather than authoring them. §3.2.
 */
export interface TopicGraphPlacement {
  /**
   * 1-based draw order across graph topics; unique. The ONE sanctioned sort
   * key in the store — `graphTopics()` sorts by it and nothing else sorts
   * anything. Decoupled from topics.json order, which is catalogue order. §3.3.
   */
  order: number
  x: number
  y: number
  /** Always authored, even when identical to Topic.label. See §3.3. */
  label: string
}

export interface Topic {
  id: TopicId
  strandId: StrandId
  label: string
  yearBand: YearBand
  /** Appears in the teacher-facing topic catalogue (class setup, homework). */
  catalogue: boolean
  /** Membership in the prerequisite graph. What isGraphTopic() reads. §3.2. */
  onGraph: boolean
  /** Authored layout override. Non-null implies onGraph. May be null when onGraph. */
  graph: TopicGraphPlacement | null
  /** Retired ids that still resolve to this topic. §1.6. [] in seed content. */
  aliases: readonly TopicId[]
  source: ContentSource
  /** ISO-8601 date, or null if never formally reviewed. */
  reviewedAt: string | null
  status: ContentStatus
}

/** Which board/tier a subtopic is examinable in. build-plan §4. */
export interface BoardScope {
  board: ExamBoard
  tier: ExamTier
  inScope: boolean
}

export interface Subtopic {
  id: SubtopicId
  topicId: TopicId
  label: string
  yearBand: YearBand
  /** null in seed content; Phase 1 populates. */
  difficultyTier: DifficultyTier | null
  /** [] until Phase 4. build-plan §4's `board_scope`. §3.10. */
  boardScope: readonly BoardScope[]
  aliases: readonly SubtopicId[]
  source: ContentSource
  reviewedAt: string | null
  status: ContentStatus
}

/** One (source, confidence) assessment of an edge, with its evidence base. */
export interface PrereqEdgeEvidence {
  source: PrereqEdgeSource
  confidence: number
  /** Sample size, for an empirical assessment. */
  n?: number
  /** ISO-8601 date this assessment was made. */
  at?: string
}

export interface PrereqEdge<Id extends string = string> {
  from: Id
  to: Id
  /** 0..1. How strongly `to` depends on `from`. */
  strength: number
  /** The current best assessment. */
  source: PrereqEdgeSource
  /** 0..1. Confidence in the edge itself, per build-plan §1.4. */
  confidence: number
  /**
   * Append-only history. build-plan §1.4 applies three verification sources at
   * different times (AI now, teacher ~week 18, empirical in year two); the
   * year-two pass must not destroy the teacher's provenance to record its own.
   * Absent on all 17 seed edges.
   */
  evidence?: readonly PrereqEdgeEvidence[]
}
export type TopicPrereqEdge = PrereqEdge<TopicId>
export type SubtopicPrereqEdge = PrereqEdge<SubtopicId>

export interface GraphFilter {
  id: GraphFilterId
  label: string
  topicIds: readonly TopicId[]
}

export interface QuestionLine {
  /** Rendered source. Plain Unicode maths today, not LaTeX. See §3.7. */
  text: string
  /** The "why" for this step. '' where the original solNotes entry was empty. */
  note: string
  /**
   * The prerequisite subtopics this line of working tests. The field the
   * product sells: it turns "student flagged line 3" into a named gap.
   * PLURAL — a line routinely tests more than one prerequisite, and widening
   * after generation is a rewrite of ~1.3M rows. Empty array, never null.
   * Every entry must satisfy validator rule E_ANCESTRY (§8.5 rule 9).
   */
  prereqSubtopicIds: readonly SubtopicId[]
}

/** A wrong answer plus the misconception it traces to. build-plan §2.6 gate 4. */
export interface Distractor {
  text: string
  /** Named misconception. Never ''. Seed values are §2.8's table. */
  cause: string
}

export interface Question {
  id: QuestionId
  /** Denormalised parent of subtopicId. Validator enforces agreement. */
  topicId: TopicId
  subtopicId: SubtopicId
  /** Scoped within subtopicId, not globally unique in principle. See §3.5. */
  familyId: FamilyId
  difficulty: DifficultyTier
  prompt: string
  statement: string
  answerLabel: string
  correctAnswer: string
  lines: readonly QuestionLine[]
  /** Index into `lines` of the step students typically get wrong. */
  errorLineIndex: number
  /**
   * Three plausible wrong answers for the MCQ confidence-rebuild retry.
   * ABSENT (not [], not null) when the question has none — PracticeLoop's
   * `mcq` path falls back to free-typed input on absence.
   */
  distractors?: readonly Distractor[]
  /** build-plan §4's `board_style`. null until Phase 4. §3.10. */
  boardStyle: string | null
  aliases: readonly QuestionId[]
  source: ContentSource
  reviewedAt: string | null
  status: ContentStatus
}

export type ReteachScope = 'Focused re-teach' | 'Quick reminder' | 'Full walk-back' | 'No re-teach needed'

/**
 * Authored re-teach content. NOT the same thing as reteach.ts's `ReteachCard`,
 * which is a view model with CSSProperties on it. Empty in seed content;
 * buildReteach() synthesises today and consults this store first (§6.10).
 */
export interface ReteachCardContent {
  questionId: QuestionId
  lineIndex: number | 'all'
  scope: ReteachScope
  heading: string
  body: readonly string[]
  workedExample: readonly string[] | null
}

// ---------------------------------------------------------------------------
// Lessons — authored form, then the hydrated form the store returns
// ---------------------------------------------------------------------------
export interface TransferIn { hook: string; body: readonly string[] }
export interface TransferOut { prompt: string; placeholder?: string }
export interface TeachBlock {
  heading: string
  body: readonly string[]
  exampleTitle?: string
  exampleSteps?: readonly string[]
}

export interface LessonPrerequisiteContent {
  subtopicId: SubtopicId
  transferIn?: TransferIn
  teach: TeachBlock
  transferOut?: TransferOut
}

export interface LessonContent {
  topicId: TopicId
  prerequisites: readonly LessonPrerequisiteContent[]
}

/**
 * Hydrated by the store. What LessonSession.tsx consumes.
 * NOTE: there is deliberately no `checkProblems` here. It was a bank-wide join
 * performed at store-build time; the caller now calls
 * questionsForSubtopic(subtopicId) instead. See §3.12.
 */
export interface LessonPrerequisite extends LessonPrerequisiteContent {
  /** === subtopicId. Present because LessonSession keys React nodes on it. */
  id: SubtopicId
  /** === the subtopic's label. */
  label: string
}

export interface Lesson {
  topicId: TopicId
  /** === topicLabel(topicId). Was `Lesson.subtopic`. */
  topicLabel: string
  prerequisites: readonly LessonPrerequisite[]
}

// ---------------------------------------------------------------------------
// School
// ---------------------------------------------------------------------------
export interface Teacher {
  id: TeacherId
  name: string
  subject: string
  classIds: readonly ClassId[]
}

export interface SchoolClass {
  id: ClassId
  subject: string
  yearBand: YearBand
  teacherId: TeacherId
}

export interface ClassDefaults {
  roster: readonly string[]
  basket: readonly TopicId[]
}

// ---------------------------------------------------------------------------
// Sample (demo) data
// ---------------------------------------------------------------------------
export interface NodeStats { last: string; next: string; reps: number }

export interface SampleNodeState extends NodeStats {
  status: NodeStatus
}

export interface SampleStudentNodeStates {
  studentId: StudentId
  nodes: Readonly<Record<TopicId, SampleNodeState>>
}

export interface PaceRow {
  /** Display string, verbatim from the prototype. Was `PaceRow.topic`. */
  label: string
  /** null where the label names no topic (e.g. 'Ratio & proportion'). §2.14. */
  topicId: TopicId | null
  tag: string
  kind: 'ahead' | 'onpace' | 'behind'
  actual: number
  expected: number
}

export interface MasteryRow {
  /** Was `MasteryRow.name`. */
  label: string
  topicId: TopicId | null
  foundations: number
  core: number
  stretch: number
}

export interface WorkingOnNow {
  /** Was `WorkingOnNow.topic`. */
  label: string
  topicId: TopicId | null
  detail: string
  note: string
}

/**
 * The teacher-dashboard drill-down fixture for one sample student. This is
 * NOT build-plan §5.2's transferable profile — that document is
 * {student_id, graph_version, node_states[], mastery_by_topic,
 * activity_summary}, does not exist yet, and is recorded in §9.2 (D5).
 */
export interface StudentProfile {
  studentId: StudentId
  whereToStart: readonly string[]
  pace: readonly PaceRow[]
  mastery: readonly MasteryRow[]
  workingOnNow: WorkingOnNow
}

// Lift-and-shift from activityLog.ts / oversight.ts — field-for-field identical.
export interface LogQuestion {
  label: string
  q: string
  hit: boolean
  note: string
  work?: readonly string[]
  wrong?: readonly number[]
  why?: readonly string[]
}

export type LogKind = 'Review' | 'Problem set' | 'Lesson'

export interface LogActivity {
  kind: LogKind
  date: string
  title: string
  result: string
  flag: 'attention' | 'ok'
  summary: string
  detail: readonly string[]
  upload: boolean
  items: readonly LogQuestion[]
}

export interface StudentActivityLog {
  studentId: StudentId
  activities: readonly LogActivity[]
}

export type OversightKind = 'uncertain' | 'gaming' | 'probe'

export interface OversightDetail {
  kind: string
  title: string
  date: string
  result: string
  flag: 'attention' | 'ok'
  upload: boolean
  items: readonly LogQuestion[]
}

export interface OversightItem {
  kind: OversightKind
  student: string
  context: string
  title: string
  body: string
  asks: string
  detail: OversightDetail
}

// ---------------------------------------------------------------------------
// Derived / view types
// ---------------------------------------------------------------------------
/** A topic projected onto the graph. Shape-identical to the old KnowledgeNode. */
export interface GraphTopic {
  id: TopicId
  x: number
  y: number
  label: string
}

/** One group in the teacher-facing topic picker. Replaces CurriculumGroup. */
export interface CatalogueGroup {
  strandId: StrandId
  /** The strand label. Rendered as the group heading. */
  label: string
  /** Catalogue topics in this strand, in authored order. */
  topics: readonly Topic[]
}

/** Directed prerequisite pair. The tuple view of a TopicPrereqEdge. */
export type EdgePair = readonly [from: TopicId, to: TopicId]

/** Visual style per mastery status. Lives in theme.ts; declared here for reuse. */
export interface NodeStyle {
  fill: string
  stroke: string
  text: string
  sw: number
  dash: string
}

/** Visual style per Oversight kind. Lives in theme.ts; declared here for reuse. */
export interface OversightKindStyle {
  label: string
  color: string
  bg: string
  bd: string
}
```

> `readonly` on arrays is deliberate: it stops a component mutating shared content in
> place. Where a consumer needs a mutable copy (`[...DEFAULT_ROSTER]` in `TeacherApp`,
> `[...TEACHERS]` in `AdminApp`), it already spreads.

### 5.4 `src/content/bank.ts` and `src/content/store.ts`

#### `bank.ts` — the future-async surface

```ts
import type { Question, QuestionId, ReteachCardContent, SubtopicId, TopicId } from './schema.ts'

export interface RawQuestionBank {
  questions: readonly Question[]
  reteachCards: readonly ReteachCardContent[]
}

/**
 * Everything the app can ask of the question bank. Six methods, all
 * synchronous. Today: createInMemoryBank, backed by the arrays above.
 * Tomorrow: a fetch-and-cache implementation over §4.2's topic-keyed shards.
 * Swapping the implementation must not change a single call site. §3.12.
 *
 * There is deliberately no `all()`. "Give me every question" is the one
 * operation a lazy bank cannot serve, and nothing in the app asks for it.
 */
export interface QuestionBank {
  byId(id: QuestionId): Question | undefined
  forTopic(topicId: TopicId): readonly Question[]
  forSubtopic(subtopicId: SubtopicId): readonly Question[]
  at(topicId: TopicId, n: number): Question | undefined
  similar(id: QuestionId, exclude?: readonly QuestionId[]): Question | undefined
  reteachCardFor(questionId: QuestionId, lineIndex: number | 'all'): ReteachCardContent | undefined
}

/** Builds every bank index up front. Correct at 17 rows, wrong at 320,000. */
export function createInMemoryBank(raw: RawQuestionBank): QuestionBank
```

`createInMemoryBank` builds, internally and once: `byId` (`Map<QuestionId, Question>`),
`byTopic` and `bySubtopic` (`Map<…, Question[]>`, each preserving authored order), and
`byQuestionLine` (`Map<string, ReteachCardContent>` keyed `` `${questionId}#${lineIndex}` ``
where `lineIndex` is a number or the literal `'all'`). `similar` matches on
`(subtopicId, familyId)`, excludes the question itself and anything in `exclude`, and
returns the first match in authored order — deterministic, never random.

#### `store.ts` — the store

```ts
import type { /* … */ } from './schema'
import type { QuestionBank, RawQuestionBank } from './bank'

/**
 * Precomputed CORE lookups. Built once at load; every accessor below is O(1)
 * or O(k). Nothing here iterates the BANK tier.
 */
export interface ContentIndex {
  topicById: ReadonlyMap<TopicId, Topic>
  subtopicById: ReadonlyMap<SubtopicId, Subtopic>
  strandById: ReadonlyMap<StrandId, Strand>
  teacherById: ReadonlyMap<TeacherId, Teacher>
  classById: ReadonlyMap<ClassId, SchoolClass>
  graphFilterById: ReadonlyMap<GraphFilterId, GraphFilter>
  /** Retired id → live id, across topics, subtopics and questions. §1.6. */
  aliasTo: ReadonlyMap<string, string>

  subtopicsByTopic: ReadonlyMap<TopicId, readonly Subtopic[]>

  /** Graph topics sorted by Topic.graph.order. Replaces NODES. §3.3. */
  graphTopics: readonly GraphTopic[]
  graphTopicById: ReadonlyMap<TopicId, GraphTopic>
  /** Topic-level edges as [from, to]. Replaces EDGES. Authored order. */
  edgePairs: readonly EdgePair[]
  /** Direct prerequisites of each topic, in edge-file order. */
  prereqsByTopic: ReadonlyMap<TopicId, readonly TopicId[]>
  /** Transitive topic-graph ancestors. Used by the validator, not the app. */
  ancestorsByTopic: ReadonlyMap<TopicId, ReadonlySet<TopicId>>
  /**
   * Transitive subtopic-graph ancestors. Empty today (the subtopic edge file
   * is empty); it is what §8.5 rule 9's tier-A ancestry check reads.
   */
  ancestorsBySubtopic: ReadonlyMap<SubtopicId, ReadonlySet<SubtopicId>>

  catalogueGroups: readonly CatalogueGroup[]
  lessonByTopic: ReadonlyMap<TopicId, Lesson>

  defaultBasket: Readonly<Record<TopicId, boolean>>
}

export interface ContentStore {
  meta: ContentMeta
  strands: readonly Strand[]
  topics: readonly Topic[]
  subtopics: readonly Subtopic[]
  topicEdges: readonly TopicPrereqEdge[]
  subtopicEdges: readonly SubtopicPrereqEdge[]
  graphFilters: readonly GraphFilter[]
  lessons: readonly LessonContent[]

  teachers: readonly Teacher[]
  classes: readonly SchoolClass[]
  classDefaults: ClassDefaults

  sampleNodeStates: Readonly<Record<StudentId, Readonly<Record<TopicId, SampleNodeState>>>>
  sampleProfiles: Readonly<Record<StudentId, StudentProfile>>
  sampleActivityLog: Readonly<Record<StudentId, readonly LogActivity[]>>
  sampleOversight: readonly OversightItem[]

  /** The BANK tier. The ONLY way to reach a question or a re-teach card. §3.12. */
  bank: QuestionBank

  index: ContentIndex
}

/**
 * Every CORE content file as parsed, before indexing. Field names match
 * §4.1's filenames; each holds the file's `items` array (or the whole object
 * for `meta` / `classDefaults`).
 */
export interface CoreBundle {
  meta: ContentMeta
  strands: readonly Strand[]
  topics: readonly Topic[]
  subtopics: readonly Subtopic[]
  topicEdges: readonly TopicPrereqEdge[]
  subtopicEdges: readonly SubtopicPrereqEdge[]
  graphFilters: readonly GraphFilter[]
  lessons: readonly LessonContent[]
  teachers: readonly Teacher[]
  classes: readonly SchoolClass[]
  classDefaults: ClassDefaults
  nodeStates: readonly SampleStudentNodeStates[]
  profiles: readonly StudentProfile[]
  activityLogs: readonly StudentActivityLog[]
  oversight: readonly OversightItem[]
}

/**
 * The ONLY type `load.ts` produces and the ONLY type `buildStore` consumes.
 * Two tiers, so the HTTP swap in §5.2 is `readBundle` plus one QuestionBank
 * implementation and nothing else.
 */
export interface RawContentBundle {
  core: CoreBundle
  bank: RawQuestionBank
}

/**
 * Pure: raw parsed bundle in, fully indexed store out. No I/O, no globals.
 * Indexes the CORE tier exhaustively; hands the BANK tier straight to
 * createInMemoryBank() and never iterates it.
 */
export function buildStore(bundle: RawContentBundle): ContentStore

/** Throws if loadContent() has not resolved. Message names the fix. */
export function requireStore(): ContentStore

/** True once loadContent() has resolved. */
export function isContentLoaded(): boolean

/** Internal: called by loadContent(). Not exported from index.ts. */
export function setStore(store: ContentStore): void
```

`requireStore()` on an unloaded store throws:

```
Error: Anadromos content store not loaded. main.tsx must `await loadContent()`
before rendering. (Called from a synchronous accessor.)
```

It **throws**; it does not return an empty store. A silently-empty store renders a blank
knowledge graph and a working-looking app, which is the worst possible failure mode for a
demo. A thrown error surfaces in the first render and is unmissable.

**Lesson hydration.** `buildStore` hydrates each `LessonContent` into a `Lesson` by
filling `topicLabel` from the topic and, per prerequisite, `id` (= `subtopicId`) and
`label` (= the subtopic's label). It does **not** attach `checkProblems`; see §3.12.

### 5.5 `src/content/load.ts` — the async seam

```ts
/**
 * Reads every content file, validates (dev only), indexes, and installs the
 * module singleton. Idempotent: the second call returns the same store, and
 * concurrent calls share one in-flight promise.
 */
export async function loadContent(): Promise<ContentStore>
```

Implementation contract:

```ts
let inFlight: Promise<ContentStore> | null = null

export async function loadContent(): Promise<ContentStore> {
  if (isContentLoaded()) return requireStore()
  if (inFlight) return inFlight
  inFlight = (async () => {
    const bundle = await readBundle()
    if (import.meta.env.DEV) assertContentBundle(bundle)   // dead-code-eliminated in prod
    const store = buildStore(bundle)
    setStore(store)
    return store
  })()
  return inFlight
}
```

**Runtime validation policy.** `assertContentBundle` runs only in dev. It is a cheap
structural pass — required fields present, enum members valid, array lengths sane — and
runs no graph algorithms. It checks the **CORE tier exhaustively** and the **BANK tier by
spot-check only** (each bank array is an array; its first and last item are structurally
valid), so it stays O(1) in bank size. The expensive structural checks (§8) already ran
offline at build time via `npm run validate:content`, which `npm run build` gates on. In
production the bundle is cast. This keeps constraint 6 (zero runtime deps, hand-rolled
validation).

### 5.6 `src/content/accessors.ts` — the complete synchronous surface

Every function below reads `requireStore()`. **All are synchronous.** Components call
them exactly where they read a constant today. This list is exhaustive: there are no other
accessors, and no agent may add one.

> **Ordering contract.** `topics()`, `questionsForTopic()`, `questionsForSubtopic()`,
> `edgePairs()`, `graphFilters()`, `catalogueGroups()`, `strands()`, `subtopics()`,
> `subtopicsForTopic()`, `prereqsOf()`, `topicEdges()`, `subtopicEdges()`, `teachers()`,
> `schoolClasses()`, `defaultRoster()`, `oversightItems()` and `activityLogFor()` all
> return **authored file order** — and under sharding (§4.2), within-shard order in the
> shard order `index.json` declares.
>
> **`graphTopics()` is the single exception:** it returns graph topics sorted ascending by
> `Topic.graph.order`. That is the only sort anywhere in the store.
>
> No accessor dedupes, and none filters beyond what its name says — in particular none
> filters on `status` (§3.9). `questionAt()` and the class-setup picker both break if this
> is violated.

```ts
// ---- meta ----------------------------------------------------------------
export function contentMeta(): ContentMeta
export function yearBands(): readonly YearBand[]              // was GRADES

// ---- strands & topics ----------------------------------------------------
export function strands(): readonly Strand[]
export function strandById(id: StrandId): Strand | undefined
export function topics(): readonly Topic[]
/** Resolves live ids first, then aliases (§1.6). */
export function topicById(id: TopicId): Topic | undefined
/** Display label. Falls back to the id itself, matching today's topicLabel(). */
export function topicLabel(id: TopicId): string
/** Catalogue topics grouped by strand, in authored order. Was CURRIC. */
export function catalogueGroups(): readonly CatalogueGroup[]

// ---- knowledge graph -----------------------------------------------------
/** Sorted by Topic.graph.order. Was NODES. */
export function graphTopics(): readonly GraphTopic[]
export function graphTopicById(id: TopicId): GraphTopic | undefined  // was NODE_BY_ID
/** Reads Topic.onGraph — NOT `graph !== null`. See §3.2. */
export function isGraphTopic(id: TopicId): boolean
export function edgePairs(): readonly EdgePair[]               // was EDGES
/** Direct prerequisites of `id`, in edge-file order. */
export function prereqsOf(id: TopicId): readonly TopicId[]
export function topicEdges(): readonly TopicPrereqEdge[]       // rich form
export function graphFilters(): readonly GraphFilter[]         // was BASKETS

// ---- subtopics -----------------------------------------------------------
export function subtopics(): readonly Subtopic[]
/** Resolves live ids first, then aliases (§1.6). */
export function subtopicById(id: SubtopicId): Subtopic | undefined
export function subtopicsForTopic(topicId: TopicId): readonly Subtopic[]
export function subtopicEdges(): readonly SubtopicPrereqEdge[]

// ---- questions (the BANK tier — §3.12) -----------------------------------
/** Resolves live ids first, then aliases (§1.6). Was problemById. */
export function questionById(id: QuestionId): Question | undefined
export function questionsForTopic(topicId: TopicId): readonly Question[]  // was problemsForTopic
export function questionsForSubtopic(id: SubtopicId): readonly Question[]
/** "Question N for a topic" = its 0-indexed position in questionsForTopic. */
export function questionAt(topicId: TopicId, n: number): Question | undefined  // was problemAt
/**
 * A same-(subtopic, family) "different numbers" variant, for the silly-mistake
 * retry. Deterministic first match in authored order — not random. Excludes the
 * question itself and anything in `exclude`. Was similarProblem.
 */
export function similarQuestion(id: QuestionId, exclude?: readonly QuestionId[]): Question | undefined
/** Convenience: the `text` of every line, in order. Replaces reads of `problem.lines`. */
export function lineTexts(q: Question): string[]

// ---- re-teach (BANK tier) ------------------------------------------------
export function reteachCardFor(questionId: QuestionId, lineIndex: number | 'all'): ReteachCardContent | undefined

// ---- lessons -------------------------------------------------------------
/** Hydrated: topicLabel + per-prerequisite id/label filled in. Was LESSONS[key]. */
export function lessonForTopic(topicId: TopicId): Lesson | undefined

// ---- school --------------------------------------------------------------
export function teachers(): readonly Teacher[]                             // was TEACHERS
export function schoolClasses(): readonly SchoolClass[]                    // was SCHOOL_CLASSES
export function defaultRoster(): readonly string[]                         // was DEFAULT_ROSTER
/** Rebuilt from ClassDefaults.basket; every listed topic maps to `true`. */
export function defaultBasket(): Readonly<Record<TopicId, boolean>>         // was DEFAULT_BASKET

// ---- samples -------------------------------------------------------------
/** The `studentId`s in samples/node-states.json, in authored order: aisha, daniel, reuben. */
export function sampleStudentIds(): readonly StudentId[]
export function sampleNodeStates(studentId: StudentId): Readonly<Record<TopicId, SampleNodeState>>
/** Falls back to 'notready'. Was statusFor(). */
export function sampleNodeStatus(studentId: StudentId, topicId: TopicId): NodeStatus
/** Falls back to { last: '—', next: '—', reps: 0 }. Was statsFor(). */
export function sampleNodeStats(studentId: StudentId, topicId: TopicId): NodeStats
export function studentProfile(studentId: StudentId): StudentProfile | undefined   // was PROFILE_BY_ID[id]
export function activityLogFor(studentId: StudentId): readonly LogActivity[]       // was LOG_BY_STUDENT[id] / LOG_RAW
export function oversightItems(): readonly OversightItem[]                         // was OVERSIGHT_RAW
```

#### Missing-key fallbacks — exhaustive and non-negotiable

Every accessor that can miss appears here. There are no undocumented fallbacks.

| accessor | result when the key is absent |
| --- | --- |
| `strandById` | `undefined` |
| `topicById` | `undefined` |
| `topicLabel` | **the `id` string itself** (load-bearing: today's `topicLabel()` does this) |
| `graphTopicById` | `undefined` |
| `isGraphTopic` | `false` |
| `prereqsOf` | **`[]`** |
| `subtopicById` | `undefined` |
| `subtopicsForTopic` | **`[]`** |
| `questionById` | `undefined` |
| `questionsForTopic` | **`[]`** |
| `questionsForSubtopic` | **`[]`** |
| `questionAt` | `undefined` |
| `similarQuestion` | `undefined` |
| `reteachCardFor` | `undefined` |
| `lessonForTopic` | `undefined` |
| `defaultBasket` | n/a — always a complete Record, `{}` only if `basket` is empty |
| `sampleNodeStates` | `{}` |
| `sampleNodeStatus` | `'notready'` |
| `sampleNodeStats` | `{ last: '—', next: '—', reps: 0 }` — note `next: '—'`, **not** `'when ready'` |
| `studentProfile` | `undefined` |
| `activityLogFor` | `[]` |

> **`tsc` will not catch a missing `?? []`.** `tsconfig.app.json` sets no `"strict"` and
> no `"strictNullChecks"`, so a `ReadonlyMap.get(id)` typed `readonly Question[] | undefined`
> is silently assignable to `readonly Question[]`. Every one of the five `[]` rows above
> has a consumer that crashes on `undefined` rather than failing to compile:
> `engine.ts:152` does `prereqs.length === 0` on `prereqsOf(topicId)` — and five of the
> fifteen graph topics (`num.negatives`, `num.fractions`, `num.decimals`, `num.ratio`,
> `alg.expanding`) have no incoming edges at all; `ReviewSession.tsx:126` does
> `pool[Math.min(s.qIdx, pool.length - 1)]`; `StudentApp.tsx:575` does
> `pool[s.fpProblemIdx % pool.length]`. Write the `?? []`.

### 5.7 `src/content/graphGeometry.ts`

```ts
/** Bezier path from the right edge of topic A's node to the left edge of B's. */
export function edgePath(a: TopicId, b: TopicId): string
```

Body is unchanged from `knowledgeGraph.ts:79–87`, with `NODE_BY_ID[a]` replaced by
`graphTopicById(a)`. The magic numbers (`+132`, `+21`, `±38`) stay: they are the node
rect's width and half-height, matched to `GraphSvg.tsx`'s hardcoded `width={132}
height={42}`.

### 5.8 `src/content/index.ts`

Re-exports everything from `accessors.ts`, `graphGeometry.ts`, `load.ts` (`loadContent`
only) and `store.ts` (`isContentLoaded`, `ContentStore` type only). Re-exports all types
from `schema.ts`. Does **not** re-export `setStore`, `buildStore`, `createInMemoryBank` or
anything from `validate.ts`.

Consumers import from `'../content'` (or `'./content'` from `main.tsx`), never from the
individual modules — **except type-only imports of `schema.ts`, which may be direct.**
That exemption is what lets `src/theme.ts` write
`import type { NodeStatus, NodeStyle, OversightKind, OversightKindStyle } from './content/schema'`
without a value dependency on the store.

### 5.9 `src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadContent } from './content'

const root = createRoot(document.getElementById('root')!)

try {
  await loadContent()
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (err) {
  console.error('Anadromos: content failed to load', err)
  root.render(
    <div style={{ padding: 32, fontFamily: 'system-ui', color: '#b6531f' }}>
      Content failed to load. See the console.
    </div>,
  )
}
```

Top-level `await` is verified working under this repo's `target: es2023` /
`module: esnext` / Vite 8 config. No `<Suspense>`, no loading state, no per-component
fetching: the app renders once, with everything present.

**This does not protect module-scope code.** `import App from './App.tsx'` is hoisted and
the whole import graph is evaluated *before* `await loadContent()` executes. See §6.12 —
it is not a style note, it is a boot-failure class.

---

## 6. Consumer-by-consumer migration

Import lists below were taken by `grep -n "^import"` on each file, not from memory.

### 6.1 `src/admin/AdminApp.tsx`

| today | replace with |
| --- | --- |
| `import { SCHOOL_CLASSES, TEACHERS } from '../data/school'` | `import { schoolClasses, teachers } from '../content'` |
| `import type { SchoolClass, Teacher } from '../data/school'` | `import type { SchoolClass, Teacher } from '../content'` |
| `import { GRADES } from '../data/curriculum'` | `import { yearBands } from '../content'` |

Call sites: `:107` `teachers: [...TEACHERS]` → `[...teachers()]`; `:108`
`classes: [...SCHOOL_CLASSES]` → `[...schoolClasses()]`; `:109`
`teacherSeq: TEACHERS.length + 1` → `teachers().length + 1`; **`:111`
`caTeacherId: TEACHERS[0]?.id ?? ''` → `teachers()[0]?.id ?? ''`**; `:299` `GRADES.map` →
`yearBands().map`; `:133` `` id: `t${st.teacherSeq}` `` → `` `teacher.new-${st.teacherSeq}` ``.

Field renames throughout this file: `SchoolClass.key` → `.id` (`:155` `removeClass`,
class list rendering, `classes.filter(c => c.key !== key)`), `SchoolClass.grade` →
`.yearBand`, `Teacher.classKeys` → `.classIds`.

`INITIAL` (`:106–112`) is defined at module scope and reads the store four times
(`:107`, `:108`, `:109`, `:111`). **Those reads execute before `loadContent()` resolves
and will throw.** Move `INITIAL` into the component as `useState<AdminState>(() => ({ … }))`.
This is mandatory, not defensive — see §6.12.

### 6.2 `src/teacher/TeacherApp.tsx`

| today | replace with |
| --- | --- |
| `import { BASKETS, EDGES, NODES, ST, edgePath, statsFor, statusFor } from '../data/knowledgeGraph'` | `import { edgePairs, edgePath, graphFilters, graphTopics, sampleNodeStats, sampleNodeStatus } from '../content'` + `import type { Topic } from '../content'` + `import { NODE_STYLE } from '../theme'` |
| `import { LOG_BY_STUDENT } from '../data/activityLog'` | `import { activityLogFor } from '../content'` |
| `import type { LogQuestion } from '../data/activityLog'` | `import type { LogQuestion } from '../content'` |
| `import { CURRIC, DEFAULT_BASKET, DEFAULT_ROSTER, GRADES } from '../data/curriculum'` | `import { catalogueGroups, defaultBasket, defaultRoster, yearBands } from '../content'` |
| `import { OVERSIGHT_KIND_META, OVERSIGHT_RAW } from '../data/oversight'` | `import { oversightItems } from '../content'` + `import { OVERSIGHT_KIND_META } from '../theme'` |
| `import type { OversightDetail } from '../data/oversight'` | `import type { OversightDetail } from '../content'` |
| `import { PROFILE_BY_ID } from '../data/studentProfiles'` | `import { studentProfile } from '../content'` |
| `import { problemAt } from '../data/problems'` | `import { questionAt } from '../content'` |
| `import { getLiveFlags } from '../data/liveOversight'` | unchanged |
| `import { getLiveSessions } from '../data/liveSessions'` | unchanged |
| `import { addProblemSet, getProblemSets } from '../data/teacherProblemSets'` | unchanged |
| `import type { AuthoredQuestion } from '../data/teacherProblemSets'` | unchanged |

Specific call sites:

| line | today | new |
| --- | --- | --- |
| 22 | `const PREVIEW_PROBLEM = problemAt('linear', 0)!` | `questionAt('alg.linear', 0)!` — **and move inside the component** (§6.12) |
| 235 | `NODES.filter(n => pred(statusFor(studentId, n.id)))` | `graphTopics().filter(n => pred(sampleNodeStatus(studentId, n.id)))` |
| 267 | `suRoster: [...DEFAULT_ROSTER]` | `[...defaultRoster()]` |
| 269 | `suBasket: { ...DEFAULT_BASKET }` | `{ ...defaultBasket() }` |
| 304 | `OVERSIGHT_RAW.map(…)` | `oversightItems().map(…)` |
| 386 | `PROFILE_BY_ID[s.selectedStudentId]` | `studentProfile(s.selectedStudentId)` |
| 390 | `NODES.map(n => …)` | `graphTopics().map(n => …)` |
| 391 | `ST[statusFor(s.selectedStudentId, n.id)]` | `NODE_STYLE[sampleNodeStatus(s.selectedStudentId, n.id)]` |
| 408–410 | `EDGES.map(([a,b]) => …)`, `statusFor(…, b)` | `edgePairs().map(([a,b]) => …)`, `sampleNodeStatus(…, b)` |
| 413 | `BASKETS.find(b => b.key === gf)` | `graphFilters().find(f => f.id === gf)` |
| 414 | `activeBasket.ids.indexOf(id) > -1` | `activeBasket.topicIds.indexOf(id) > -1` |
| 417 | `EDGES[idx]` | `edgePairs()[idx]` |
| 420 | `BASKETS.map(b => ({ key: b.key, label: b.label }))` | `graphFilters().map(f => ({ key: f.id, label: f.label }))` |
| 422 | `NODES.find(n => n.id === s.selectedNode)` | `graphTopics().find(…)` |
| 428–434 | `statsFor(…)`, `statusFor(…)` | `sampleNodeStats(…)`, `sampleNodeStatus(…)` |
| 453 | `LOG_BY_STUDENT.aisha`, `LOG_BY_STUDENT[s.selectedStudentId]` | `activityLogFor('aisha')`, `activityLogFor(s.selectedStudentId)` — the `?? []` fallbacks become redundant, drop them |
| 457–458 | `matchTopic = (t: [string,string,string]) => (s.suYear === 'all' \|\| t[2] === s.suYear) && (!q \|\| t[1].toLowerCase()…)` | `matchTopic = (t: Topic) => (s.suYear === 'all' \|\| t.yearBand === s.suYear) && (!q \|\| t.label.toLowerCase().indexOf(q) > -1)` |
| **460–462** | `CURRIC.map(g => ({ group: g.group, topics: g.topics.filter(matchTopic) })).filter(g => g.topics.length > 0)` | `catalogueGroups().map(g => ({ group: g.label, topics: g.topics.filter(matchTopic) })).filter(g => g.topics.length > 0)` — **keep the trailing filter** |
| **469–472** | `CURRIC.map(g => ({ group: g.group, topics: g.topics.filter(([, label]) => !hq \|\| …) })).filter(g => g.topics.length > 0)` | `catalogueGroups().map(g => ({ group: g.label, topics: g.topics.filter(t => !hq \|\| t.label.toLowerCase().indexOf(hq) > -1) })).filter(g => g.topics.length > 0)` — **keep the trailing filter** |
| 474 | `CURRIC.flatMap(g => g.topics).filter(([key]) => s.hwBasket[key])` | `catalogueGroups().flatMap(g => g.topics).filter(t => s.hwBasket[t.id])` |
| 475, 506 | `hwSelectedTopics.map(([, label]) => label)` | `hwSelectedTopics.map(t => t.label)` |
| 482–484 | `CURRIC.flatMap(…).filter(([k]) => hwBasket[k]).map(([, label]) => label)` | `catalogueGroups().flatMap(g => g.topics).filter(t => hwBasket[t.id]).map(t => t.label)` |
| 1267 | `OVERSIGHT_KIND_META[o.kind]` | unchanged (import moves to `../theme`) |
| 1363, 1444 | `GRADES.map(…)` | `yearBands().map(…)` |
| ~1470 | `grp.topics.map(([key, label]) => …)` | `grp.topics.map(t => …)` with `t.id` / `t.label` |
| 879–882 | `p.topic` (React key + display) | `p.label` |
| 909–910 | `t.name` (React key + display) | `t.label` |
| 1043 | `selectedProfile.workingOnNow.topic` | `.label` |

> **The two trailing `.filter((g) => g.topics.length > 0)` calls are load-bearing.** Drop
> them and filtering Class setup to e.g. "Year 9" + search "surds" renders empty
> `Number` / `Algebra` / `Geometry & graphs` / `Statistics & probability` group headings
> with no chips beneath them, and makes the `basketGroups.length > 0` empty state at
> `:1463` ("No topics match that filter…") unreachable. Same for `hwBasketGroups` at
> `:1594`. Two visible screens, so this fails S6.

Every remaining `basketGroups` / `hwBasketGroups` render loop that destructures a
`[key, label, year]` tuple becomes property access on a `Topic`. Grep for `([key` and
`([,` in this file to find them all; there are no others outside the lines listed.

### 6.3 `src/student/StudentApp.tsx`

| today | replace with |
| --- | --- |
| `import { BASKETS, EDGES, NODES, ST, edgePath } from '../data/knowledgeGraph'` | `import { edgePairs, edgePath, graphFilters, graphTopics, isGraphTopic } from '../content'` + `import type { TopicId } from '../content'` + `import { NODE_STYLE } from '../theme'` |
| `import type { EngineNodeState, EngineState, MasteryTier } from '../data/engine'` | `import type { EngineNodeState, EngineState } from '../data/engine'` + `import type { MasteryTier } from '../content'` |
| `import { initEngineState, recordAttempt } from '../data/engine'` | unchanged |
| `import { LOG_RAW } from '../data/activityLog'` | `import { activityLogFor } from '../content'` |
| `import { LESSONS } from '../data/lessons'` | `import { lessonForTopic } from '../content'` |
| `import { problemById, problemsForTopic } from '../data/problems'` | `import { questionById, questionsForTopic } from '../content'` |
| `import { topicLabel } from '../data/curriculum'` | `import { topicLabel } from '../content'` |
| rest (`teacherProblemSets`, `liveOversight`, `liveSessions`, components, theme) | unchanged |

Specific call sites:

| line | today | new |
| --- | --- | --- |
| 88–95 | `PATH_TOPIC_KEY` values `'linear'`, `'fracpct'` | `'alg.linear'`, `'num.fractions-to-percent'` |
| 96–98 | `FREEPLAY_TOPIC_KEY: { Substitution: 'substitution' }` | `{ Substitution: 'alg.substitution' }` |
| **100–111** | **`TOPIC_TO_NODE_ID` — delete the constant AND its six-line docblock entirely** | — |
| 114 | `FALLBACK_NODE_STATE` docblock references "knowledgeGraph.ts" and "all 15 ids" | keep the value; rewrite the docblock to name `content/samples/node-states.json` |
| 125–128 | `FP_LIVE_UNLOCK_TOPIC_KEY` values | `'alg.substitution'`, `'alg.linear'` |
| 274–279 | `PROGRESS_TOPIC_KEY` values | `num.negatives`, `num.fractions-to-percent`, `alg.substitution`, `alg.linear` |
| 328 | `engineNode(nodeId: string)` | `engineNode(topicId: TopicId)` — body unchanged |
| **332–338** | `recordTopicAttempt` docblock: "No-ops for a topic with no knowledge-graph node behind it (nothing outside TOPIC_TO_NODE_ID's three topics currently reaches this)." | **rewrite to drop the name**, e.g. "No-ops for a topic that is not on the knowledge graph (`isGraphTopic`); nothing outside the three topics with a question bank currently reaches this." — **required for S1** |
| 339–344 | `const nodeId = TOPIC_TO_NODE_ID[topic]; if (!nodeId) return; …recordAttempt(prev, { nodeId, topic, … })` | `if (!isGraphTopic(topicId)) return; …recordAttempt(prev, { topicId, difficulty, correct, weak })` |
| **345–352** | `recordDiagnosticAttempt` docblock: "same TOPIC_TO_NODE_ID mapping, same problemById difficulty lookup" | **rewrite to drop the name**, e.g. "same `isGraphTopic` guard, same `questionById` difficulty lookup" — **required for S1** |
| 355–360 | same shape in `recordDiagnosticAttempt` | same change as 339–344 |
| 342, 358 | `problemById(…)` | `questionById(…)` |
| 371 | `topicLabel(topic)` | unchanged (import source changed) |
| 413–418 | `const topicKey = FP_LIVE_UNLOCK_TOPIC_KEY[su.name]; const nodeId = topicKey ? TOPIC_TO_NODE_ID[topicKey] : undefined; if (!nodeId) return su.unlocked; engineNode(nodeId)` | `const topicId = FP_LIVE_UNLOCK_TOPIC_ID[su.name]; if (!topicId \|\| !isGraphTopic(topicId)) return su.unlocked; engineNode(topicId)` |
| 538, 542, 556 | `LESSONS[s.practiceTopic]`, `LESSONS[topic]` | `lessonForTopic(s.practiceTopic)`, `lessonForTopic(topic)` |
| 574 | `problemsForTopic(topic)` | `questionsForTopic(topic)` |
| 666–667 | `NODES.map(n => …)`, `ST[…]` | `graphTopics().map(…)`, `NODE_STYLE[…]` |
| 684, 693 | `EDGES.map`, `EDGES[idx]` | `edgePairs().map`, `edgePairs()[idx]` |
| 689 | `BASKETS.find(b => b.key === gf)` | `graphFilters().find(f => f.id === gf)` |
| 690 | `activeBasket.ids.indexOf(id) > -1` | `activeBasket.topicIds.indexOf(id) > -1` |
| 696 | `NODES.find(…)` | `graphTopics().find(…)` |
| 727 | `[...getLiveSessions(), ...LOG_RAW]` | `[...getLiveSessions(), ...activityLogFor(STUDENT_ID)]` |
| 1095 | `BASKETS.map(b => ({ key: b.key, label: b.label }))` | `graphFilters().map(f => ({ key: f.id, label: f.label }))` |

Rename `PATH_TOPIC_KEY` → `PATH_TOPIC_ID`, `FREEPLAY_TOPIC_KEY` → `FREEPLAY_TOPIC_ID`,
`PROGRESS_TOPIC_KEY` → `PROGRESS_TOPIC_ID`, `FP_LIVE_UNLOCK_TOPIC_KEY` →
`FP_LIVE_UNLOCK_TOPIC_ID`; their types become `Record<string, TopicId>`. These four are
label→id lookup tables with no store reads, so they may stay at module scope.

### 6.4 `src/components/LessonSession.tsx` — the Concept→Prerequisite rename

| today | replace with |
| --- | --- |
| `import type { Concept, Lesson } from '../data/lessons'` | `import type { Lesson, LessonPrerequisite, TeachBlock } from '../content'` + `import { lineTexts, questionsForSubtopic } from '../content'` |
| `import type { Problem } from '../data/problems'` | `import type { Question } from '../content'` |
| `import type { LogActivity, LogQuestion } from '../data/activityLog'` | `import type { LogActivity, LogQuestion } from '../content'` |
| `import { routeFor } from '../data/routing'` | unchanged |
| `import { MASTERY_PROMOTE_THRESHOLD } from '../data/engine'` | unchanged |

Identifier renames (mechanical, no behaviour change):

| today | new |
| --- | --- |
| `Concept` (type) | `LessonPrerequisite` |
| `ConceptOutcome` | `PrerequisiteOutcome` |
| `conceptId` (field, `:70`, `:403`) | `prerequisiteId` |
| `conceptIdx` (state field) | `prerequisiteIdx` |
| `lesson.concepts` | `lesson.prerequisites` |
| local `concept` / `cpt` | `prereq` |
| `startPhase(concept)` | `startPhase(prereq)` |
| `problemFor(concept, …)` | `questionFor(prereq, …)`, return type `Question` |
| `lesson.subtopic` (8 sites: 136, 293, 306, 320, 340, 365, 397, 418) | `lesson.topicLabel` |
| `scaffoldExample(teach: Concept['teach'], …)` | `scaffoldExample(teach: TeachBlock, …)` |

**Visible UI copy — the sanctioned exception to S6.** Change exactly these:

| line | today | new |
| --- | --- | --- |
| 137 | `` `${masteredCount} of ${st.outcomes.length} concepts covered` `` | `…prerequisites covered` |
| 140 | `'Worked through cleanly; every concept covered today.'` | `…every prerequisite covered today.` |
| 141 | `'Moved on before every concept fully clicked - the rest are first in the next review.'` | `…before every prerequisite fully clicked…` |
| 320, 340, 365 | `Concept {s.conceptIdx + 1} of {lesson.concepts.length}` | `Prerequisite {s.prerequisiteIdx + 1} of {lesson.prerequisites.length}` |
| 399 | `{…} of {s.outcomes.length} concepts covered` | `…prerequisites covered` |

Data-shape edits:

| line | today | new |
| --- | --- | --- |
| 122 | `problem.solNotes[problem.errIdx] \|\| 'See the worked steps above.'` | `problem.lines[problem.errorLineIndex]?.note \|\| 'See the worked steps above.'` |
| 128 | `work: result.correct ? undefined : problem.lines` | `… : lineTexts(problem)` |
| 129 | `wrong: … [problem.errIdx]` | `… [problem.errorLineIndex]` |
| **157–160** | `function problemFor(concept: Concept, problemIdx: number): Problem { const pool = concept.checkProblems; return pool[problemIdx % pool.length] }` | `function questionFor(prereq: LessonPrerequisite, questionIdx: number): Question { const pool = questionsForSubtopic(prereq.subtopicId); return pool[questionIdx % pool.length] }` — the pool is the identical array in the identical order; `checkProblems` no longer exists on the hydrated type (§3.12) |
| 300 | `` key={`${concept.id}-…`} `` | `` key={`${prereq.id}-…`} `` (hydrated `id` === subtopic id) |

Do **not** touch `StudentApp.tsx:25` or `ParentApp.tsx:15` — those use "concept" as an
English word about the app's design, not the domain term.

### 6.5 `src/parent/ParentApp.tsx`

| today | replace with |
| --- | --- |
| `import { EDGES, NODES, ST, edgePath, statsFor, statusFor } from '../data/knowledgeGraph'` | `import { edgePairs, edgePath, graphTopics, sampleNodeStats, sampleNodeStatus } from '../content'` + `import { NODE_STYLE } from '../theme'` |

Call sites: `:160` `NODES.find` → `graphTopics().find`; `:162` `NODES.map` →
`graphTopics().map`; `:163` `ST[statusFor(…)]` → `NODE_STYLE[sampleNodeStatus(…)]`;
`:179` `EDGES.map` → `edgePairs().map`; `:410–412` `statusFor`/`statsFor` →
`sampleNodeStatus`/`sampleNodeStats`.

### 6.6 `src/components/DiagnosticTest.tsx`

| today | replace with |
| --- | --- |
| `import type { Problem } from '../data/problems'` | `import type { Question } from '../content'` |
| `import { problemAt } from '../data/problems'` | `import { questionAt } from '../content'` |
| `import { topicLabel } from '../data/curriculum'` | `import { topicLabel } from '../content'` |

`:36–45` — `RAW_QUESTIONS` **and** the `QUESTIONS` filter derived from it. **Both move
inside the component** (§6.12) and are rewritten:

```ts
const RAW_QUESTIONS: Array<Question | undefined> = [
  questionAt('alg.linear', 0),                 // …cross-equals.q01 · foundations
  questionAt('alg.linear', 4),                 // …divide-negative.q01 · foundations
  questionAt('alg.substitution', 0),           // …two-term.q01 · foundations
  questionAt('alg.substitution', 5),           // …single-term.q02 · foundations
  questionAt('num.fractions-to-percent', 1),   // …convert.q02 · foundations
  questionAt('num.fractions-to-percent', 2),   // …convert.q03 · core
]
const QUESTIONS: Question[] = RAW_QUESTIONS.filter((p): p is Question => !!p)
```

Both go inside the component body (before the `if (QUESTIONS.length === 0) return null`
guard at `:111`, which is unchanged). `QUESTIONS` is derived from module-scope accessor
calls and must move with them.

Field and type edits:

| line | today | new |
| --- | --- | --- |
| 36, 45, 112 | `Problem` | `Question` |
| **83–91** | `onAnswer` docblock: "Deliberately just (topic, problemId, correct, weak) rather than a knowledge-graph node id - StudentApp already owns `TOPIC_TO_NODE_ID` and the live engine setter; this component only knows problems.ts topics." | **rewrite to drop the name** — e.g. "…rather than a knowledge-graph node id: StudentApp owns the graph check (`isGraphTopic`) and the live engine setter; this component only knows topic ids." **Required for S1** — that grep fails otherwise even after a perfect implementation. |
| 91 | `onAnswer: (topic: string, problemId: string, …)` | `onAnswer: (topicId: TopicId, questionId: QuestionId, …)` (add the two type imports) |
| **123** | `onAnswer(problem.topic, problem.id, correct, false)` | `onAnswer(problem.topicId, problem.id, correct, false)` |
| **135** | `onAnswer(problem.topic, problem.id, false, true)` | `onAnswer(problem.topicId, problem.id, false, true)` |
| **222** | `topicLabel(problem.topic)` | `topicLabel(problem.topicId)` |

`Question` has no `.topic`; the field is `.topicId`. There are no `.lines` / `.solNotes`
reads in this file.

### 6.7 `src/components/PracticeLoop.tsx`

| today | replace with |
| --- | --- |
| `import { buildReteach } from '../data/reteach'` | unchanged |
| `import type { Problem } from '../data/problems'` | `import type { Question } from '../content'` |
| `import { topicLabel } from '../data/curriculum'` | `import { topicLabel } from '../content'` |

| line | today | new |
| --- | --- | --- |
| 100 | `if (!mcq \|\| !problem.distractors \|\| problem.distractors.length < 3) return null` | unchanged |
| **101** | `[problem.correctAnswer, ...problem.distractors.slice(0, 3)]` | `[problem.correctAnswer, ...problem.distractors.slice(0, 3).map(d => d.text)]` (§3.8) |
| 203 | `problem.lines[curLine] \|\| ''` | `problem.lines[curLine]?.text ?? ''` |
| 235 | `lineTex: problem.lines[li]` | `lineTex: problem.lines[li]?.text ?? ''` |
| 269 | `const tex = problem.lines[i]` | `const tex = problem.lines[i].text` |
| 270 | `const note = problem.solNotes[i]` | `const note = problem.lines[i].note` |
| 361 | `topicLabel(problem.topic)` | `topicLabel(problem.topicId)` |
| 549, 559, 570 | `problem.lines.map((_, i) => …)` | unchanged (index-only) |

`problem.prompt`, `.statement`, `.answerLabel`, `.correctAnswer` are unchanged.

### 6.8 `src/components/ReviewSession.tsx`

| today | replace with |
| --- | --- |
| `import type { Problem } from '../data/problems'` | `import type { Question } from '../content'` |
| `import { problemsForTopic, similarProblem } from '../data/problems'` | `import { lineTexts, questionsForTopic, similarQuestion } from '../content'` |
| `import type { LogActivity, LogQuestion } from '../data/activityLog'` | `import type { LogActivity, LogQuestion } from '../content'` |
| `import { routeFor } from '../data/routing'` | unchanged |

| line | today | new |
| --- | --- | --- |
| 77 | `problem.solNotes[problem.errIdx] \|\| 'See the worked steps above.'` | `problem.lines[problem.errorLineIndex]?.note \|\| 'See the worked steps above.'` |
| 83 | `work: … problem.lines` | `work: … lineTexts(problem)` |
| 84 | `wrong: … [problem.errIdx]` | `wrong: … [problem.errorLineIndex]` |
| 117 | `problemsForTopic(topic)` | `questionsForTopic(topic)` |
| 126 | `similarProblem(s.lastProblemId)` | `similarQuestion(s.lastProblemId)` |

`:117` is inside the component body already, so no move is needed.

### 6.9 `src/data/engine.ts` — logic only, `normalizeTopicName` deleted

| today | replace with |
| --- | --- |
| `import { EDGES, NODE_STATS_BY_STUDENT, NODE_STATUS_BY_STUDENT } from './knowledgeGraph'` | `import { edgePairs, prereqsOf, sampleNodeStates, studentProfile } from '../content'` |
| `import type { NodeStatus } from './knowledgeGraph'` | `import type { MasteryTier, NodeStatus, TopicId } from '../content'` |
| `import { PROFILE_BY_ID } from './studentProfiles'` | (folded into the line above) |
| `import { CURRIC } from './curriculum'` | **delete** |

Deletions:
- `normalizeTopicName()` (`:97–103`) — **delete the function and the 12-line comment block
  above it (`:84–95`).**
- `TOPIC_KEY_BY_NORMALIZED_LABEL` (`:105–107`) — **delete.**
- `export type MasteryTier = 'foundations' | 'core' | 'stretch'` (`:22`) — delete; re-export
  the schema alias instead so `import type { MasteryTier } from '../data/engine'` keeps
  working for anyone who still does it: `export type { MasteryTier } from '../content'`.

The module docblock (`:1–16`) references "knowledgeGraph.ts / studentProfiles.ts"; update
it to name the store accessors.

Type changes:

```ts
export interface EngineState {
  /**
   * Keyed by TopicId — the same key space as masteryByTopic. Phase 3's
   * cross-topic credit widens this to TopicId | SubtopicId; both are dotted
   * strings, so that is a documentation change, not a type change. §9.2 D4.
   */
  nodes: Record<TopicId, EngineNodeState>
  masteryByTopic: Record<TopicId, TierMastery>
}

export interface AttemptEvent {
  /** Was `{ nodeId, topic }` — two keys for one entity. Now one. */
  topicId: TopicId
  difficulty: MasteryTier
  correct: boolean
  weak?: boolean
}
```

Body changes:

```ts
export function initEngineState(studentId: string): EngineState {
  const states = sampleNodeStates(studentId)            // was two maps, joined by hand
  const nodes: Record<TopicId, EngineNodeState> = {}
  for (const topicId of Object.keys(states)) {
    const st = states[topicId]
    nodes[topicId] = { status: st.status, last: st.last ?? '—', next: st.next ?? 'when ready', reps: st.reps ?? 0 }
  }

  const masteryByTopic: Record<TopicId, TierMastery> = {}
  for (const row of studentProfile(studentId)?.mastery ?? []) {
    if (!row.topicId) continue                          // was: fuzzy label match, unseeded on miss
    masteryByTopic[row.topicId] = { foundations: row.foundations, core: row.core, stretch: row.stretch }
  }

  return { nodes, masteryByTopic }
}
```

`deriveFrontier`: `const prereqs = EDGES.filter(([, b]) => b === nodeId).map(([a]) => a)`
→ `const prereqs = prereqsOf(topicId)`. Same values, same order; the `prereqs.length === 0`
guard stays (root topics must not be vacuously promoted). **`prereqsOf` must return `[]`,
not `undefined`, for a topic with no incoming edges** — five of the fifteen graph topics
are in that state and `.length` on `undefined` throws (§5.6).

`recordAttempt`: `event.nodeId` and `event.topic` both become `event.topicId`; the
trickle-down loop becomes `for (const [a, b] of edgePairs())`. Everything else — rates,
thresholds, interval doubling, promotion rule — is untouched.

Keep `MASTERY_PROMOTE_THRESHOLD`, `MAX_INTERVAL_DAYS`, `MS_PER_DAY`, the three rate
constants, `clamp01`, `parseIntervalDays`, `intervalLabel` exactly as they are.

### 6.10 `src/data/reteach.ts` — logic only

| today | replace with |
| --- | --- |
| `import type { Problem } from './problems'` | `import type { Question } from '../content'` |
| `import { topicLabel } from './curriculum'` | `import { lineTexts, reteachCardFor, topicLabel } from '../content'` |
| `import type { CSSProperties } from 'react'` / `import { FONT_MONO } from '../theme'` | unchanged |

The exported view-model interface stays named `ReteachCard` (it has `scopeStyle:
CSSProperties`, `route`, `cta` — it is not the content entity). The content entity is
`ReteachCardContent`. **Do not conflate them.**

| line | today | new |
| --- | --- | --- |
| 51 | `buildReteach(line, reason, problem: Problem)` | `buildReteach(line: number \| 'all', reason: string \| undefined, problem: Question)` |
| 52 | `topicLabel(problem.topic)` | `topicLabel(problem.topicId)` |
| 53 | `problem.solNotes[problem.errIdx] \|\| 'that step is where it slipped'` | `problem.lines[problem.errorLineIndex]?.note \|\| 'that step is where it slipped'` |
| 76, 91, 105, 118 | `exampleSteps: problem.lines` | `exampleSteps: lineTexts(problem)` |
| 81, 86, 92, 112 | `problem.errIdx` | `problem.errorLineIndex` |

Add the authored-card seam at the top of `buildReteach`, before the `reason === 'slip'`
branch:

```ts
const authored = reteachCardFor(problem.id, line)
if (authored) {
  return {
    ...scope(authored.scope),
    heading: authored.heading,
    body: [...authored.body],
    hasExample: authored.workedExample !== null,
    exampleTitle: authored.workedExample ? 'Worked through' : undefined,
    exampleSteps: authored.workedExample ? [...authored.workedExample] : undefined,
    route: `Routed to: ${topicLabel(problem.topicId)} on your map.`,
    cta: 'Practise this step →',
  }
}
```

`reteach-cards.json` is empty today, so this branch never fires and behaviour is
unchanged. It exists so Phase 2's generated cards are a data drop, not a code change.

### 6.11 `src/data/lessons.ts` — deleted

The whole file goes. Its two hardcoded family filters (`:33–35`) are replaced by the
caller's `questionsForSubtopic(prereq.subtopicId)` (§3.12, §6.4). Its `Concept` / `Lesson`
interfaces move to `schema.ts` as `LessonPrerequisite` / `Lesson`. Its content moves to
`content/curriculum/lessons.json`.

### 6.12 Module-scope reads of the store — mandatory, not defensive

**The rule is absolute: any accessor call at module scope in a module reachable from
`main.tsx`'s import graph WILL throw.**

This is not a matter of evaluation order being unreliable. ES module imports are hoisted
and the entire graph is evaluated before any statement in `main.tsx` runs, including
`await loadContent()`. `main.tsx` imports `App.tsx` (`src/App.tsx:3–6`), which imports
`TeacherApp`, `StudentApp`, `ParentApp` and `AdminApp` at module scope. Every module-scope
accessor call in those files therefore executes with no store installed, `requireStore()`
throws, and the app dies on a white screen with §5.4's error message before `main.tsx`
reaches its first statement.

Six sites. All six must move; none is optional.

| file | line | today | fix |
| --- | --- | --- | --- |
| `TeacherApp.tsx` | 22 | `const PREVIEW_PROBLEM = problemAt('linear', 0)!` | move inside the component |
| `TeacherApp.tsx` | 249–270 | `const INITIAL: TeacherState = { … [...DEFAULT_ROSTER] … { ...DEFAULT_BASKET } … }` | `useState<TeacherState>(() => ({ … }))` |
| `AdminApp.tsx` | 106–112 | `const INITIAL: AdminState = { teachers: [...TEACHERS], classes: [...SCHOOL_CLASSES], teacherSeq: TEACHERS.length + 1, … }` | `useState<AdminState>(() => ({ … }))` |
| `AdminApp.tsx` | 111 | `caTeacherId: TEACHERS[0]?.id ?? ''` | (same `INITIAL`; listed separately because §6.1's call-site list must not miss it) |
| `DiagnosticTest.tsx` | 36–43 | `const RAW_QUESTIONS = [problemAt(…), …]` | move inside the component |
| `DiagnosticTest.tsx` | 45 | `const QUESTIONS = RAW_QUESTIONS.filter(…)` | move with it — it is derived from the four calls above |

Sites that are **not** affected and must not be moved: `TeacherApp.tsx`'s `chipStyle` /
`monoCap` / `idForName`, `StudentApp.tsx`'s `PATH_TOPIC_ID` / `FREEPLAY_TOPIC_ID` /
`PROGRESS_TOPIC_ID` / `FP_LIVE_UNLOCK_TOPIC_ID` / `FALLBACK_NODE_STATE`,
`DiagnosticTest.tsx`'s `PALETTE_DEFS` / `FRESH`. None of them reads the store.

Grep for the pattern after migrating: any `const X = <accessor>(…)` at column 0 in a
`.tsx` file is a boot failure.

### 6.13 Files with no content imports — unchanged

`src/components/GraphSvg.tsx`, `src/components/NodeInfoCard.tsx`,
`src/components/TeachingCard.tsx`, `src/data/routing.ts`, `src/App.tsx`,
`src/components/Logo.tsx`. (`GraphSvg.tsx:26`'s "subtopic nodes" comment should say
"topic nodes" — comment only.)

`src/data/liveSessions.ts` and `src/data/liveOversight.ts` change one import each
(`LogActivity` / `OversightItem` now come from `'../content'`). `src/data/teacherProblemSets.ts`
is unchanged; its `AuthoredQuestion.topic` remains a display label, which is a known gap
logged in §9.1 (G8).

---

## 7. The fate of every `src/data/*.ts`

| file | fate | reason |
| --- | --- | --- |
| `knowledgeGraph.ts` | **DELETED** | `NODES`/`EDGES`/`BASKETS` → JSON. `NodeStatus`/`NodeStats`/`NodeStyle` → `schema.ts`. `ST` → `theme.ts` as `NODE_STYLE`. `edgePath()` → `content/graphGeometry.ts`. `NODE_BY_ID`/`statusFor`/`statsFor` → store accessors. Nothing left. |
| `curriculum.ts` | **DELETED** | `CURRIC`/`GRADES`/`DEFAULT_BASKET`/`DEFAULT_ROSTER` → JSON. `topicLabel()` → store accessor (it is a lookup, not logic). `CurriculumGroup` → `CatalogueGroup` in `schema.ts`. |
| `problems.ts` | **DELETED** | `PROBLEMS` → JSON. `Problem` → `Question` in `schema.ts`. All four accessors → `QuestionBank`, indexed instead of `.filter()`/`.find()` over an array — which is what makes them survive 320k rows. |
| `lessons.ts` | **DELETED** | `LESSONS` → JSON. `Concept`/`Lesson` → `schema.ts`. Its family filters become a `questionsForSubtopic` call at the one call site. |
| `school.ts` | **DELETED** | `TEACHERS`/`SCHOOL_CLASSES` → JSON. `Teacher`/`SchoolClass` → `schema.ts`. |
| `studentProfiles.ts` | **DELETED** | `PROFILE_BY_ID` → JSON. Four interfaces → `schema.ts`, with `topicId` joins added. |
| `activityLog.ts` | **DELETED** | `LOG_RAW`/`LOG_BY_STUDENT` → JSON. `LogQuestion`/`LogActivity` → `schema.ts`. |
| `oversight.ts` | **DELETED** | `OVERSIGHT_RAW` → JSON. Types → `schema.ts`. `OVERSIGHT_KIND_META` is a colour palette keyed by an enum — it goes to `theme.ts` with the rest of the palette, typed `Record<OversightKind, OversightKindStyle>`. |
| `engine.ts` | **KEPT, reduced to logic** | The mastery engine is the product's logic, not its content. Loses `normalizeTopicName`, `TOPIC_KEY_BY_NORMALIZED_LABEL`, and the `CURRIC` import; gains store accessors. |
| `reteach.ts` | **KEPT** | Card *selection* is logic, and the returned view model carries `CSSProperties`. Gains an authored-card lookup that no-ops today. |
| `routing.ts` | **KEPT, unchanged** | Pure reason-code logic. No data imports today, none after. |
| `liveSessions.ts` | **KEPT** | In-memory session store. One type import re-pointed. |
| `liveOversight.ts` | **KEPT** | Ditto. |
| `teacherProblemSets.ts` | **KEPT, unchanged** | In-memory session store for teacher-authored sets. Not curriculum. |

**No compatibility re-exports.** See §3.13.

`src/data/` survives as the home of the six logic modules. Moving them is churn with no
benefit and would touch every import in the app for cosmetics.

---

## 8. The offline validation CLI

### 8.1 Invocation

`package.json`:

```jsonc
"scripts": {
  "dev": "vite",
  "build": "npm run validate:content && tsc -b && vite build",
  "lint": "oxlint",
  "preview": "vite preview",
  "validate:content": "node --no-warnings=ExperimentalWarning scripts/validate-content.ts"
}
```

```
npm run validate:content                  # human-readable report
npm run validate:content -- --json        # single JSON object on stdout, nothing else
npm run validate:content -- --strict      # warnings become errors. THIS is what CI runs.
npm run validate:content -- --verbose     # also print info-level findings
npm run validate:content -- --write-hashes            # rewrite meta.json's graphHashes
npm run validate:content -- --dir content/__fixtures__/invalid-cycle   # validate another bundle
```

`npm run build` deliberately does **not** pass `--strict`: a warning must never block a
local build (§8.5 rule 7). CI runs `--strict` and does.

`scripts/validate-content.ts` is plain Node ESM TypeScript, run through Node's native
type stripping (verified on Node 23.11; `erasableSyntaxOnly: true` is already set in both
tsconfigs, which guarantees strip-compatibility). **Zero dependencies** — not even zod as
a devDependency: the same structural predicates and the same `slugify()` must run in the
browser loader where a schema library is banned, and one implementation in
`src/content/validate.ts` shared by both beats two implementations drifting apart.
`node:crypto` is used for the SHA-256 in rule 12; it is a built-in, CLI-only, and never
imported by the browser loader.

Add `"scripts"` to `tsconfig.node.json`'s `include`, and `"resolveJsonModule": true` to
its `compilerOptions`, so `tsc -b` type-checks the CLI.

The CLI reads files with `fs.readFileSync` + `JSON.parse` — not `import()` — so it also
catches malformed JSON, byte-order marks, and files the bundler would have silently
tolerated. It never builds a `ContentStore`; it works directly on the parsed files, so it
is unaffected by §3.12's CORE/BANK split.

### 8.2 Exit codes

| code | meaning |
| --- | --- |
| 0 | No errors. Warnings may be present (unless `--strict`). |
| 1 | One or more errors. |
| 2 | Could not read or parse a content file; nothing was validated. |

### 8.3 Human output format

```
anadromos · content validation · content/
  meta          schemaVersion 1 · contentVersion 2026-08-02.1
                topicGraphVersion topic-graph-2026-08-02.1 · subtopicGraphVersion subtopic-graph-2026-08-02.0
  curriculum    4 strands · 39 topics (15 on graph, 37 in catalogue) · 7 subtopics
                17 topic edges · 0 subtopic edges · 17 questions · 67 lines · 10 line tags
                33 distractors · 0 reteach cards · 1 lesson · 4 graph filters
  school        4 teachers · 8 classes · 8 roster names · 14 basket topics
  samples       3 students · 45 node states · 3 profiles · 9 activities · 4 oversight items

  ✓ file-envelope           17 files
  ✓ id-grammar              83 ids
  ✓ id-containment          63 ids
  ✓ id-uniqueness           83 ids
  ✓ referential-integrity   296 references
  ✓ dag-acyclicity          17 edges
  ✓ year-band-monotonicity  17 edges
  ✓ reachability            15 graph topics
  ✓ line-prereq-ancestry    10 tags
  ✓ question-structure      17 questions
  ✓ sample-integrity        45 node states
  ✓ graph-version           2 edge files

  17 files · 12 checks · 0 errors · 0 warnings
```

**Every subject count above is derived, not asserted.** The counting rules, so an
implementer reproduces them exactly:

| check | subjects = |
| --- | --- |
| `file-envelope` | content files read: 10 curriculum + 3 school + 4 samples = **17** |
| `id-grammar` | authored entity ids: 4 strands + 39 topics + 7 subtopics + 17 questions + 4 graph filters + 4 teachers + 8 classes = **83**. `familyId`, `studentId` and aliases are checked by the same predicates but are not separate subjects. |
| `id-containment` | ids with a parent level: 39 topics + 7 subtopics + 17 questions = **63** |
| `id-uniqueness` | the same 83 ids, plus every alias (0 today) = **83** |
| `referential-integrity` | 39 `Topic.strandId` + 7 `Subtopic.topicId` + 17 `Question.subtopicId` + 17 `Question.topicId` + 34 edge endpoints + 10 line tags + 15 `GraphFilter.topicIds` + 14 basket topics + 1 lesson topic + 2 lesson prerequisites + 0 re-teach questions + 8 `SchoolClass.teacherId` + 8 `Teacher.classIds` + 45 sample node-state keys + 25 non-null profile `topicId`s + 54 year-band references (39 + 7 + 8) + 0 `boardScope` entries = **296** |
| `dag-acyclicity` | 17 topic edges + 0 subtopic edges = **17** |
| `year-band-monotonicity` | the same **17** |
| `reachability` | topics with `onGraph: true` = **15** |
| `line-prereq-ancestry` | non-empty entries across every `prereqSubtopicIds` = **10** |
| `question-structure` | questions = **17** |
| `sample-integrity` | sample node-state entries = 3 × 15 = **45** |
| `graph-version` | edge files hashed = **2** |

A failing check prints its findings indented beneath it, one per line:

```
  ✗ dag-acyclicity          17 edges · 1 error
      E_CYCLE  content/curriculum/prereq-edges.topic.json
               cycle: alg.linear → alg.bracket-equations → alg.linear
  ⚠ year-band-monotonicity  17 edges · 1 warning
      W_YEAR_BAND  content/curriculum/prereq-edges.topic.json[13]
                   alg.bracket-equations (Year 9) is a prerequisite of alg.linear (Year 8)

  17 files · 12 checks · 1 error · 1 warning
```

Finding line format: `  {6 spaces}{CODE}  {file}[{index}]` then a wrapped explanation
indented to align under the code. Codes are uppercase, `E_`/`W_`/`I_` prefixed, and
**stable** — CI greps for them.

### 8.4 `--json` output

```json
{
  "ok": false,
  "dir": "content",
  "counts": {
    "files": 17, "strands": 4, "topics": 39, "subtopics": 7,
    "questions": 17, "questionLines": 67, "lineTags": 10, "distractors": 33,
    "topicEdges": 17, "subtopicEdges": 0
  },
  "checks": [
    { "name": "id-grammar", "subjects": 83, "errors": 0, "warnings": 0 },
    { "name": "dag-acyclicity", "subjects": 17, "errors": 1, "warnings": 0 }
  ],
  "findings": [
    {
      "severity": "error",
      "code": "E_CYCLE",
      "check": "dag-acyclicity",
      "file": "content/curriculum/prereq-edges.topic.json",
      "index": null,
      "id": null,
      "message": "cycle: alg.linear → alg.bracket-equations → alg.linear",
      "path": ["alg.linear", "alg.bracket-equations", "alg.linear"]
    }
  ],
  "errors": 1,
  "warnings": 0
}
```

`checks[].subjects` is the same number the human report prints for the same check on the
same bundle. The two renderings must agree; if they disagree, one of them is a bug.

Nothing else goes to stdout in `--json` mode. Progress and diagnostics go to stderr.

### 8.5 The rules

Checks run in this order and **all of them run** — the CLI never short-circuits after the
first failure, because fixing one content error at a time is how a 39-row change takes a
week.

#### 1. `file-envelope`
- `E_FILE_MISSING` — a file listed in §4.1 is absent.
- `E_FILE_PARSE` — invalid JSON. Exit code 2.
- `E_ENVELOPE` — missing or wrong `schemaVersion` / `kind`, or `items` is not an array.
  `kind` is checked against §4.3's 17-value list, which includes `meta` and
  `class-defaults`; those two files are exempt from the `items` requirement and from
  nothing else.
- `E_SCHEMA_VERSION` — a file's `schemaVersion` differs from `meta.json`'s.

#### 2. `id-grammar`
- `E_ID_GRAMMAR` — an id fails its level's regex from §1.2, or a teacher/class/filter/
  student/family id fails its namespace regex from §1.5.
- `E_ID_LEVEL` — an id has the wrong segment count for its entity type (a `Subtopic.id`
  with 2 or 4 segments).
- `E_ID_SEGMENT_LENGTH` — a segment exceeds `MAX_SEGMENT_LENGTH` (40). Names the segment.

#### 3. `id-containment`
- `E_ID_PARENT_MISSING` — `id.slice(0, id.lastIndexOf('.'))` does not name an existing
  entity one level up. Applies to topic→strand, subtopic→topic, question→subtopic.
- `E_ID_PARENT_MISMATCH` — the declared parent field disagrees with the id.
  Specifically: `Topic.strandId !== parentOf(Topic.id)`,
  `Subtopic.topicId !== parentOf(Subtopic.id)`,
  `Question.subtopicId !== parentOf(Question.id)`,
  `Question.topicId !== parentOf(Question.subtopicId)`.
  All four are **errors**, including the topic→strand one. §1.6 explains why, and pays
  for it with the alias mechanism rather than by weakening this check.

#### 4. `id-uniqueness`
- `E_ID_DUPLICATE` — two entities of the same type share an id.
- `E_ALIAS_COLLIDES` — an entry of any `aliases` array equals a live id of any entity
  type. An alias must never shadow something real.
- `E_ALIAS_DUPLICATE` — the same alias string appears on two entities.
- `E_ALIAS_GRAMMAR` — an alias fails the level regex for its owner's entity type.
- `W_FAMILY_CROSS_SUBTOPIC` — the same `familyId` appears under two different subtopics.
  **Warning, not error**: family ids are subtopic-scoped by §3.5, so this is legal. It is
  worth knowing today (all five seed families are globally unique) and becomes routine
  once Phase 2 reuses slugs like `standard` across thousands of subtopics.
- `W_ID_NEAR_DUPLICATE` — two sibling ids under the same parent whose final segments are
  both ≥ 6 characters and have Levenshtein distance ≤ 3. **Warning**, and the threshold
  is a documented tuning knob. It exists because `E_ID_DUPLICATE` cannot see
  `alg.linear.solve-both-sides` next to `alg.linear.solving-both-sides`, and 8,000
  auto-slugged siblings need to be inspectable. Does not fire on seed data.

#### 5. `referential-integrity`
Every one of these is `E_REF_*` with the dangling id in the message:

| code | rule |
| --- | --- |
| `E_REF_TOPIC_STRAND` | `Topic.strandId` resolves |
| `E_REF_SUBTOPIC_TOPIC` | `Subtopic.topicId` resolves |
| `E_REF_QUESTION_SUBTOPIC` | `Question.subtopicId` resolves |
| `E_REF_QUESTION_TOPIC` | `Question.topicId` resolves |
| `E_REF_EDGE_ENDPOINT` | both `from` and `to` of every edge resolve, **and both are the same level** (`E_EDGE_LEVEL_MIX` otherwise) |
| `E_REF_LINE_PREREQ` | every entry of every `QuestionLine.prereqSubtopicIds` resolves to a real subtopic |
| `E_REF_FILTER_TOPIC` | every `GraphFilter.topicIds[]` entry resolves **and has `onGraph: true`** (`E_FILTER_NOT_GRAPH` otherwise) |
| `E_REF_BASKET_TOPIC` | every `ClassDefaults.basket[]` entry resolves **and has `catalogue: true`** (`E_BASKET_NOT_CATALOGUE` otherwise) |
| `E_REF_LESSON_TOPIC` | `LessonContent.topicId` resolves |
| `E_REF_LESSON_PREREQ` | every `LessonPrerequisiteContent.subtopicId` resolves, **and its `topicId` equals the lesson's `topicId`** (`E_LESSON_PREREQ_FOREIGN` otherwise) |
| `E_REF_RETEACH_QUESTION` | `ReteachCardContent.questionId` resolves, and `lineIndex` is `'all'` or in range |
| `E_REF_CLASS_TEACHER` | `SchoolClass.teacherId` resolves |
| `E_REF_TEACHER_CLASS` | every `Teacher.classIds[]` entry resolves, **and that class's `teacherId` points back** (`E_TEACHER_CLASS_ASYMMETRIC` otherwise) |
| `E_REF_SAMPLE_TOPIC` | every key of `SampleStudentNodeStates.nodes` resolves **and has `onGraph: true`** |
| `E_REF_PROFILE_TOPIC` | every non-null `topicId` on a `PaceRow` / `MasteryRow` / `WorkingOnNow` resolves |
| `E_REF_YEAR_BAND` | every `Topic.yearBand`, `Subtopic.yearBand`, `SchoolClass.yearBand` is in `meta.yearBands` |
| `E_REF_BOARD` | every `BoardScope.board` is in `ExamBoard` and every `.tier` is in `ExamTier` |

References resolve against **live ids only**, never through aliases. An alias is a
read-path convenience for stored external references (§1.6); content that ships in this
repo must point at live ids.

#### 6. `dag-acyclicity`
- `E_CYCLE` — the topic prerequisite graph, and separately the subtopic prerequisite
  graph, must each be a DAG. Use Kahn's algorithm; when nodes remain, run a DFS from each
  remaining node to recover a concrete cycle and report it as a `→`-joined path with the
  entry node repeated at the end. **Report every distinct cycle; never auto-break one**
  (`build-plan.md` §1.2). This one stays fatal — the build plan is explicit that a cycle
  is always a bug.
- `E_SELF_EDGE` — `from === to`.
- `W_DUPLICATE_EDGE` — the same `(from, to)` pair appears twice. **Stays a warning
  precisely because merging is the intended resolution**: `build-plan.md` §1.4 applies
  three verification sources at different times, and the year-two empirical pass scoring
  an edge a teacher already confirmed should append to `evidence` (§5.3), not be rejected
  as a duplicate.

#### 7. `year-band-monotonicity`
- `W_YEAR_BAND` — **warning, not error.** For every edge `from → to`,
  `meta.yearBands.indexOf(from.yearBand) <= meta.yearBands.indexOf(to.yearBand)`.
  Message names both entities and both bands. Equality is fine (a Year 8 topic may depend
  on another Year 8 topic).
- Runs on the subtopic graph too, using `Subtopic.yearBand`.
- **Why a warning.** `build-plan.md` §1.2 says band violations are "usually a mislabelled
  year band, occasionally a genuinely misplaced curriculum item. Both are worth knowing"
  — it reserves fatal treatment for cycles alone. At 17 hand-drawn edges an error is
  harmless; on a generated graph over 8,000 subtopics with real spiral-curriculum banding,
  a single mis-banded row would block every local build for everyone with no waiver
  mechanism. `--strict` (which CI runs) makes it fatal; `npm run build` does not.
  It must not fire on seed data — all 17 edges are monotone (§2.3).

#### 8. `reachability`
- `W_ORPHAN_GRAPH_TOPIC` — a topic with `onGraph: true` that has neither an incoming nor
  an outgoing edge. `build-plan.md` §1.2's "orphans mean a missing edge". Warning: a
  brand-new topic legitimately has no edges for a moment.
- `W_UNREACHABLE` — a graph topic not reachable from any zero-in-degree topic. In a DAG
  this cannot fire; it exists to catch a fully-cyclic subgraph that `E_CYCLE` reports
  from the other direction, and it will matter on the generated 8,000-node graph.
- `E_GRAPH_PLACEMENT_ORPHAN` — `graph !== null` while `onGraph === false`. Authored
  coordinates for a topic that is not on the graph are always a mistake (§3.2).
- `W_GRAPH_NO_PLACEMENT` — `onGraph === true` while `graph === null`. Warning; must not
  fire on seed data, becomes routine when Phase 1 computes layouts.
- `E_GRAPH_ORDER_DUPLICATE` — two graph topics share a `graph.order`.
- `E_GRAPH_ORDER_RANGE` — a `graph.order` that is not an integer ≥ 1.
- `I_TOPIC_NOT_ON_GRAPH` — a catalogue topic with `onGraph: false`. **Info level, printed
  only under `--verbose`.** 24 of the 39 seed topics are in this state by design; making
  it a warning would train everyone to ignore warnings.
- `W_SUBTOPIC_NO_QUESTIONS` — a subtopic with zero questions. **`draft` subtopics are
  exempt**: a subtopic that has just been named legitimately has no bank yet, and the two
  line-tag targets from §3.6 are exactly that case. Without the exemption the seed bundle
  would carry two permanent warnings and S5 could never hold, which is how a team learns
  to ignore warnings. Fires on any non-`draft` subtopic with no questions.

#### 9. `line-prereq-ancestry`
The check `build-plan.md` §2.1 calls "the single best automated quality check available",
and the gate `build-plan.md` §2.6 lists third. It is a **two-tier rule over the subtopic
graph**, not a topic-level rule.

For every entry `tag` of every `QuestionLine.prereqSubtopicIds`, on a question `q`:

- `E_ANCESTRY_SELF` — `tag === q.subtopicId`. A line cannot be a prerequisite of itself.
  Fires under both tiers.
- **Tier A — `prereq-edges.subtopic.json` is non-empty.** `E_ANCESTRY` unless `tag` is in
  `ancestorsBySubtopic.get(q.subtopicId)`, i.e. the transitive closure of the subtopic
  prerequisite graph. This is `build-plan.md` §2.1's rule stated exactly: "every `prereq`
  on every line must be an ancestor of the question's **subtopic** in the Phase 1 graph".
  It is the operative rule at Phase 2, because Phase 1 runs first.
- **Tier B — the subtopic graph is empty (today).** Let `tagTopic = parentOf(tag)`.
  `E_ANCESTRY` unless `tagTopic === q.topicId` **or** `tagTopic ∈ ancestorsByTopic.get(q.topicId)`.

> **Tier B allows same-topic tags on purpose, and this is the load-bearing correction.**
> A strict topic-level ancestor rule ("`parentOf(tag)` must be a *strict* ancestor of
> `q.topicId`") rejects every within-topic prerequisite, because a topic is not a strict
> ancestor of itself. `build-plan.md` §1.3 states that a subtopic's legitimate candidate
> pool is "other subtopics within the same topic (~40), plus subtopics in topics that are
> ancestors (~120)" — so roughly a quarter of all correct Phase-2 line tags are same-topic
> siblings. Rejecting them would fail correct data and pressure the generator away from
> within-topic tagging, which is curriculum damage. The seed data hides this (both of
> §2.9's tags are cross-topic), which is exactly why it is written down here and why
> §8.6 adds a fixture that proves the sibling case is accepted.

Message must name the failing chain so the author can tell whether the tag is wrong or the
graph is missing an edge: `line 1 of alg.linear.cross-equals.q01 tags
num.fractions.to-decimal, but num.fractions is neither alg.linear nor an ancestor of it`.

#### 10. `question-structure`
- `E_QUESTION_NO_LINES` — `lines` is empty.
- `E_ERR_LINE_INDEX` — `errorLineIndex` outside `0..lines.length - 1`.
- `E_DIFFICULTY` — `difficulty` not in `foundations | core | stretch`.
- `E_DISTRACTOR_COUNT` — `distractors` present with fewer than 3 entries
  (`PracticeLoop.tsx:100–101` requires ≥ 3 and renders four options).
- `E_DISTRACTOR_COLLIDES` — a distractor's `text` equals `correctAnswer`.
- `W_DISTRACTOR_NO_CAUSE` — a distractor whose `cause` is empty or whitespace.
  `build-plan.md` §2.6 gate 4. Does not fire on seed data: all 33 causes are authored
  (§2.8).
- `E_STATUS` — `status` not in `ContentStatus`'s six values (§3.9). Also checked on
  `Topic` and `Subtopic`.
- `E_SOURCE` — `source` not in `ContentSource`'s three values. Also checked on `Topic`
  and `Subtopic`.
- `W_EMPTY_STRING` — a required display string (`prompt`, `statement`, `correctAnswer`,
  `label`) is empty or whitespace. `answerLabel` and `QuestionLine.note` may legitimately
  be `''`.

#### 11. `sample-integrity`
- `E_SAMPLE_STATUS` — a `SampleNodeState.status` outside the five `NodeStatus` values.
- `W_SAMPLE_COVERAGE` — a sample student's `nodes` map does not cover every graph topic.
  Warning, because the fallbacks in §5.6 handle it; but on seed data it must not fire.
- `E_SAMPLE_DUPLICATE_STUDENT` — two entries with the same `studentId` in any samples file.

#### 12. `graph-version`
- `E_GRAPH_VERSION_STALE` — `meta.graphHashes.topic` is non-empty and disagrees with the
  SHA-256 of `prereq-edges.topic.json`'s `items` as serialised in §4.3; likewise
  `.subtopic`. This is the only thing that makes `build-plan.md` §0.2's guarantee real: a
  CLI re-run that forgets to bump the version silently invalidates nothing and corrupts
  every stored profile.
- `W_GRAPH_HASH_UNSET` — a hash is `''`. Bootstrap state only; `--write-hashes` clears it.
- `E_GRAPH_VERSION_EMPTY` — `topicGraphVersion` or `subtopicGraphVersion` is empty.

### 8.6 The validator's own tests

`content/__fixtures__/` holds six minimal bundles, each a complete valid bundle with one
deliberate property. Five must fail; **one must pass**.

| fixture | run | must report |
| --- | --- | --- |
| `invalid-cycle/` | exits 1 | `E_CYCLE` |
| `invalid-year-band/` | exits 1 under `--strict` | `W_YEAR_BAND` |
| `invalid-ref/` | exits 1 | `E_REF_QUESTION_SUBTOPIC` |
| `invalid-grammar/` | exits 1 | `E_ID_GRAMMAR` |
| `invalid-ancestry/` | exits 1 | `E_ANCESTRY` (a tag whose parent topic is neither the question's topic nor an ancestor of it) |
| **`valid-ancestry-sibling/`** | **exits 0** | **nothing.** A question in topic `T`, subtopic `T.a`, with a line tagged `T.b` — a same-topic sibling. This case will dominate at 320,000 questions and is the one the original rule would have rejected. The fixture exists so nobody re-tightens rule 9 without noticing. |

`invalid-year-band/` is the one fixture that needs `--strict`, because rule 7 is a warning.

The seed bundle at `content/` emits exactly **two** warnings before `--write-hashes` runs
(`W_GRAPH_HASH_UNSET`, once per edge file) and **zero** after — which is what S5 asserts,
and why agent 4 runs `--write-hashes` as its last integration step. No other warning may
fire on seed data. In particular `W_SUBTOPIC_NO_QUESTIONS` does not: the two line-tag
targets from §3.6 carry `status: "draft"`, which the check exempts (§8.5 rule 8).

A rule with no failing fixture is a rule nobody has run. These are six small JSON
directories, not a test framework — checking them is a six-line shell loop, which is the
right amount of machinery for this repo.

---

## 9. Known gaps and deferred work

### 9.1 Known gaps in this change

Not bugs. Things this change chose not to do, recorded so they are decisions rather than
oversights.

| # | Gap | When |
| --- | --- | --- |
| G1 | `alg.basics` ("Algebra basics", graph-only) and `alg.notation` ("Algebraic notation", catalogue-only) are plausibly one topic. Merging changes a rendered graph label, so it waits. | Phase 1, teacher review |
| G2 | `num.negatives-arithmetic` has no catalogue entry. Either add one or fold it into `num.negatives` as a subtopic. | Phase 1 |
| G3 | 15 of 39 topics are on the graph; the other 24 have no edges. The graph is a demo slice, not the curriculum. When Phase 1 fills it, layouts are computed and `Topic.graph` goes mostly null while `onGraph` goes mostly true — which is why §3.2 splits them. | Phase 1 |
| G4 | `Subtopic.difficultyTier` is `null` everywhere. | Phase 1 |
| G5 | Only **10 of 67** question lines carry a prerequisite tag (§3.6). | Phase 2 |
| G6 | `reteach-cards.json` is empty; `buildReteach()` still synthesises. | Phase 2 §2.2 |
| G7 | `Subtopic.boardScope` is `[]` and `Question.boardStyle` is `null` everywhere. The types are correct (§3.10); only the values are outstanding. `Topic.examBoardTags` was deleted rather than carried forward empty. | Phase 4 |
| G8 | `AuthoredQuestion.topic` (teacher-authored problem sets) is still a display label, not a `TopicId`. | Phase 5 basket builder |
| G9 | `LogActivity` / `OversightItem` carry no `topicId`; the teacher dashboard joins them by prose. | Phase 3 |
| G10 | `GraphFilter` is authored. Phase 5 derives it from the teacher's basket, at which point `graph-filters.json` is deleted. | Phase 5.1 |
| G11 | The loader still bundles the BANK tier into the JS payload. Fine at 17 questions, wrong at 320,000. §3.12 confines the change to `readBundle` + one `QuestionBank` implementation; §4.2 gives the shard layout. | Phase 2 |
| G12 | `meta.graphHashes` protects the edge files only. A `topics.json` edit that adds a node is not hashed and does not invalidate a stored profile, though arguably it should. | Phase 5.2 |

### 9.2 Deferred design decisions, with shapes recorded

Legitimate work that is explicitly **out of Phase 0 scope**. Each row records the shape so
the later phase implements a decision rather than reinventing one.

| # | Deferred | Why not now | Recorded shape / requirement |
| --- | --- | --- | --- |
| **D1** | Bank accessors that may return empty while a fetch is in flight, and call sites that tolerate it. | Today's call sites demonstrably do not tolerate an empty pool (`ReviewSession.tsx:126`, `StudentApp.tsx:575`, `LessonSession.tsx:159` all index into it directly). Making them tolerate it is a behaviour change, not a refactor, and it would ship UI states nobody has designed. | **Precondition for the async `QuestionBank`:** before the fetch-backed implementation lands, every consumer of `questionsForTopic` / `questionsForSubtopic` must have an authored empty-pool state. `QuestionBank`'s interface does not change; only its timing does. |
| **D2** | Machine-interpretable answers. `Question.correctAnswer` is an opaque string compared with `normalize()` string equality. `build-plan.md` §2.6 gate 2 ("execute the maths, don't ask a model") needs more, and at 320,000 questions marking cannot be exact string equality across `6`, `6.0`, `x = 6`, `3/8`, `0.375`, `12 cm²`. | No consumer exists. Adding four unused optional fields invites four divergent implementations. | `answerFormat?: 'exact' \| 'numeric' \| 'fraction' \| 'algebraic'`, `answerTolerance?: number`, `acceptedAnswers?: readonly string[]`, `unit?: string \| null`. Additive; decide before the generation run, not after. |
| **D3** | Status-based serving. Accessors currently serve every authored row regardless of `status`. | `questionAt(topicId, n)` addresses a question by position, so filtering out `rejected`/`retired` rows silently re-points `questionAt('alg.linear', 4)` and changes `DiagnosticTest`. Positional addressing must be fixed first. | Intended policy: serve `draft \| generated \| in-review \| verified`; never `rejected \| retired`. Requires replacing `questionAt`'s ordinal addressing with explicit ids at its two call sites first. |
| **D4** | Line-level and subtopic-level evidence in the engine. `build-plan.md` §3.2's cross-topic credit — "the feature nobody else has" — operates at line and subtopic granularity; `AttemptEvent` carries neither. | `EngineState` is session-scoped and resets on reload (`engine.ts`'s own docblock), so there is no persisted artefact whose key space a later change would migrate. Adding fields no producer populates and no consumer reads is speculative code that no success criterion can check. | `AttemptEvent` gains `subtopicId?: SubtopicId` and `lineOutcomes?: readonly { lineIndex: number; correct: boolean; prereqSubtopicIds: readonly SubtopicId[] }[]`. `EngineState.nodes` and `.masteryByTopic` widen to `Record<TopicId \| SubtopicId, …>` — both are dotted strings, so this is a documentation change. `E_REF_SAMPLE_TOPIC` relaxes to "resolves to a topic or subtopic; if it is a topic it must have `onGraph: true`" **at that point and not before** — it currently guards real sample fixtures and weakening it early buys nothing. |
| **D5** | The transferable student profile. `build-plan.md` §5.2 defines `{student_id, graph_version, node_states[], mastery_by_topic, activity_summary}`. | It does not exist yet, in any form. `StudentProfile` in §5.3 is the teacher-dashboard *sample fixture* (whereToStart / pace / mastery / workingOnNow) — a different entity — and stamping a graph version onto it would put the field on the wrong document. | `interface TransferableProfile { studentId: StudentId; topicGraphVersion: string; subtopicGraphVersion: string; nodeStates: Record<TopicId, EngineNodeState>; masteryByTopic: Record<TopicId, TierMastery>; activitySummary: … }`. The two version fields come from `meta` at export time; the receiving bundle compares them against its own. §4.3's split into two versions exists so this comparison can be partial. |
| **D6** | Lesson identity. `LessonContent` has no id; its identity is `topicId`, indexed 1:1 by `lessonByTopic`, so a topic can never have more than one lesson. At 8,000 subtopics the taught unit is the subtopic and you will want ~8,000 lessons, not ~200. | Lessons are not one of `build-plan.md` §0.1's target tables, so there is no Phase-2 drop-in to protect. The blast radius is `lessonForTopic()` and its three call sites, all in `StudentApp.tsx` (`:538`, `:542`, `:556`) — bounded, single-file, single-agent. | `LessonContent` gains `id: LessonId` (dotted, same grammar) and `scope: { kind: 'topic' \| 'subtopic'; id: TopicId \| SubtopicId }`; the index becomes `lessonsByScope: ReadonlyMap<string, readonly Lesson[]>`; `lessonForTopic(topicId)` survives as a thin convenience returning the first topic-scoped lesson. |
| **D7** | Turning on `strictNullChecks`. | It is not a content change, and it produces errors across ~4,400 lines of component code that this refactor must not touch (constraint 7). | Every `ReadonlyMap.get()` in `src/content/` must be written with an explicit `?? []` / `?? undefined` today, because the compiler will not ask for one. §5.6's fallback table is the checklist. |
| **D8** | Deriving `graph-filters.json` from the teacher's basket (G10), and topic-level board-scope roll-ups from `Subtopic.boardScope` (§3.10). | Both need product surfaces that do not exist. | Roll-up, when needed, is a derived accessor over `subtopicsForTopic(id)` — never an authored field on `Topic`. |

---

## 10. Suggested work split for five parallel agents

Shared prerequisite: **agent 1 lands first.** Everything else depends on `schema.ts`
existing. Agents 2–5 may start against the interfaces in §5.3 immediately, but must not
merge before agent 1.

| Agent | Owns | Files |
| --- | --- | --- |
| **1 — Schema & store** | §5 in full | `src/content/*` (including `bank.ts`), `src/theme.ts` additions (`NODE_STYLE`, `OVERSIGHT_KIND_META`), `tsconfig.app.json` |
| **2 — Curriculum content** | §2.1–2.10, §4 | `content/curriculum/*.json` |
| **3 — School & sample content** | §2.11–2.15, §4, §8.6 | `content/school/*.json`, `content/samples/*.json`, `content/__fixtures__/*` (all six) |
| **4 — Validator** | §8 in full, plus `slugify()` (§1.3) | `scripts/validate-content.ts`, `src/content/validate.ts`, `package.json` scripts; runs `--write-hashes` as the last integration step |
| **5 — Consumer migration** | §6 | all of `src/admin`, `src/teacher`, `src/student`, `src/parent`, `src/components`, the six surviving `src/data/*.ts`, `src/main.tsx`; deletes the eight dead `src/data` files |

Invariants nobody may change unilaterally:

- The ID strings in §2. If one looks wrong, it is still the one to implement.
- Accessor names, signatures and fallbacks in §5.6.
- Field names in §5.3.
- The ordering contract in §5.6, including the single `graph.order` sort exception.
- The file paths, tiering and envelope in §4.
- The CORE/BANK boundary in §3.12. In particular: no agent adds a `questions()` accessor,
  and no agent re-adds `LessonPrerequisite.checkProblems`.

Integration order: 1 → (2 ‖ 3 ‖ 4) → 5. Agent 5 cannot compile until 1 and 2 have landed,
and cannot pass `npm run build` until 3 and 4 have.

---

## 11. Review disposition

Two adversarial reviews raised 27 findings. Dispositions below; every ACCEPT is reflected
in the body of this document, every DEFER is recorded in §9.2, every REJECT states why.

### Accepted (20)

| Finding | Where it landed |
| --- | --- |
| **`graphTopics()` order breaks the frontier chip list** (blocker). Verified against `TeacherApp.tsx:233–241`: `buildFrontierGroups` renders `NODES.filter(…).map(n => n.label)` as an *ordered* chip list, and catalogue order would reorder Aisha's chips on a visible screen. The reviewer's illustrative chip lists were slightly off (`n11`/`n12` are `frontier` for Aisha, not `notready`), but the defect and its direction are real. | New required `Topic.graph.order`, §2.2 + §3.3; sanctioned sort exception in §0.2 and §5.6; §4.4's node-states comment now names the order it means. |
| **ESM hoisting makes §6.12 mandatory, not defensive** (major). Verified: `main.tsx` → `App.tsx:3–6` → four apps, all module-scope. | §5.9 and §6.12 rewritten as an absolute rule; both "in practice"/"not something to rely on" hedges deleted; `DiagnosticTest.tsx:45` (`QUESTIONS`) and `AdminApp.tsx:111` (`caTeacherId`) added as the fifth and sixth sites. |
| **`DiagnosticTest.tsx` reads `problem.topic` three times** (major). Verified at `:123`, `:135`, `:222`; `Question` has no `.topic`. And `:88`'s docblock contains the literal `TOPIC_TO_NODE_ID`, so S1 fails without touching it. | Four new rows in §6.6. Two further docblocks found in the same sweep (`StudentApp.tsx:337`, `:348`) added to §6.3, and S1 reworded to name all of them. |
| **Collection accessors missing from the fallback table** (major). Verified: `tsconfig.app.json` has no `strict`/`strictNullChecks`, so a missing `?? []` is a runtime crash `tsc` will not report; `engine.ts:152`, `ReviewSession.tsx:126`, `StudentApp.tsx:575` all crash on `undefined`. | §5.6's fallback table is now exhaustive (21 rows) with `prereqsOf`, `questionsForTopic`, `questionsForSubtopic`, `subtopicsForTopic` → `[]`, plus the `strictNullChecks` note and the five-root-topics detail. |
| **`basketGroups` / `hwBasketGroups` lose their trailing `.filter(g => g.topics.length > 0)`** (minor). Verified at `TeacherApp.tsx:460–462` and `:469–472`; the empty states at `:1463` and `:1594` become unreachable without it. | §6.2 rows corrected, with the consequence spelled out. |
| **`OVERSIGHT_KIND_META` has no declared value type** (minor). Verified: `oversight.ts:30–37` types it inline; `theme.ts` imports only `CSSProperties`. | `OversightKindStyle` added to §5.3; §3.11 states the permitted type-only import. |
| **G5 says 68 lines, the real count is 67** (minor). Verified: 16 × 4 + `sub-one-2`'s 3. | Fixed in §0.3, §8.3 and G5. |
| **§8.3 vs §8.4 count inconsistencies** (minor). | All counts now derived from a published counting rule (§8.3): 17 files, 83 / 63 / 83 ids, 296 references, 12 checks. `--json` and the human report share them by construction. |
| **`kind` enum omits `meta` and `class-defaults`** (minor). | §4.3's enum is now 17 values with the exemption stated. |
| **Ancestry gate rejects same-topic sibling tags** (blocker). Verified against `build-plan.md` §1.3 ("other subtopics within the same topic (~40)") and §2.1 (the rule is over the question's *subtopic*, in the subtopic graph). | §8.5 rule 9 restated as a two-tier rule; `ancestorsBySubtopic` added to `ContentIndex`; sixth fixture `valid-ancestry-sibling/` added to §8.6 that must **pass**. |
| **Loader bakes a total-load assumption the swap cannot undo** (blocker) — accepted in modified form; see Partially accepted. | §3.12, §4.1 tiering, §5.2, §5.4 `QuestionBank`. |
| **§4.2's shard key doesn't scale and concatenation buys nothing** (major). | §4.2 rewritten: strand-sharded + concatenated for CORE, topic-sharded + fetch-the-shard for BANK, ordering contract restated as within-shard order in declared shard order. |
| **No mechanism for reparenting under immutable hierarchical ids** (major). | §1.6: policy stated, `aliases` added to Topic/Subtopic/Question, resolvers required to consult them, `E_ALIAS_*` rules added. The alternative fix (weakening `E_ID_PARENT_MISMATCH`) is rejected in-place with reasons. |
| **No deterministic slug producer; grammar bans leading digits** (major). | §1.2 relaxes the first character to `[a-z0-9]` (so `3d-shapes` is legal) and caps segments at 40; §1.3 specifies `slugify()` normatively with its transliteration table and collision rule, shipped in `validate.ts`; `W_ID_NEAR_DUPLICATE` added. §1.3 also states that §2's hand-authored ids are not retro-slugged. |
| **Distractors are bare strings with no misconception** (major) — and the causes already exist as comments in `problems.ts`. | §3.8 and §5.3: `Distractor { text, cause }`. §2.8 tabulates all 33 causes verbatim so nothing is fabricated. `W_DISTRACTOR_NO_CAUSE` added; it does not fire on seed data. §6.7 updates `PracticeLoop.tsx:101`. |
| **`Topic.graph` conflates membership with layout** (major). | §3.2: `onGraph: boolean` split from `graph`; `isGraphTopic()`, `E_REF_FILTER_TOPIC`, `E_REF_SAMPLE_TOPIC` and `W_ORPHAN_GRAPH_TOPIC` all re-pointed at `onGraph`; `E_GRAPH_PLACEMENT_ORPHAN` / `W_GRAPH_NO_PLACEMENT` added. |
| **Exam-board tagging is on the wrong entity and cannot express tier** (major). | §3.10: `Topic.examBoardTags` deleted; `Subtopic.boardScope: BoardScope[]` and `Question.boardStyle: string \| null` added; `E_REF_BOARD` added; G7 rewritten. |
| **Four strands stated as fiat against a ~15-strand target** (minor). | §1.4 states four is today's subset, names the target, reserves abbreviations, and confirms adding a strand is additive — reconciled with §4.2's shard-key decision. |
| **`PrereqEdge` cannot hold three verification sources over time** (minor). | Optional `evidence?: PrereqEdgeEvidence[]` added in §5.3; §8.5 rule 6 states why `W_DUPLICATE_EDGE` stays a warning. |
| **Year-band monotonicity as a build-blocking error** (minor). Verified against `build-plan.md` §1.2, which reserves fatal treatment for cycles alone. | Downgraded to `W_YEAR_BAND`, fatal only under `--strict` (which CI runs, and `npm run build` does not). `E_CYCLE` stays fatal. §2.3 reworded; §8.6's fixture now runs with `--strict`. |
| **`GraphFilterId` shares a namespace with `StrandId`** (minor). Verified that filter ids are never rendered (`TeacherApp.tsx:420`, `StudentApp.tsx:1095` display only `label`), so renaming is invisible. | Namespaced `filter.*` in §1.5 and §2.5. |
| **`prereqSubtopicId` is singular** (minor). | Widened to `prereqSubtopicIds: readonly SubtopicId[]` (§3.6), with the deviation from `build-plan.md` §0.1 stated explicitly. Ten seed tags today; ~1.3M rows later. |

### Partially accepted (3)

| Finding | Accepted | Not accepted |
| --- | --- | --- |
| **CORE/BANK loader split** (blocker) | The tiering (§3.12, §4.1), `RawContentBundle = { core, bank }`, the `QuestionBank` interface with `createInMemoryBank()` today and a fetch-backed implementation later, `buildStore` never iterating the bank, dropping eager `checkProblems` hydration (`LessonSession.tsx:157–160` — one line), deleting the `questions()` accessor, and correcting §5.2's "this function and nothing else" claim. | "State explicitly that bank accessors may return empty/undefined pending load and that call sites must already tolerate it." Today's call sites verifiably do not tolerate it, and making them do so ships undesigned UI states — a behaviour change, not a refactor, and outside constraint 7. Recorded as **D1**, a precondition for the async bank. Accessor signatures stay synchronous per constraint 2. |
| **`ContentStatus` too narrow** (major) | Widening to six values, `E_STATUS` updated, and `source: ContentSource` + `reviewedAt: string \| null` added to Topic, Subtopic and Question (all `"teacher"` / `null` in seed content). | "State which statuses the accessors serve." Filtering by status would silently re-point `questionAt(topicId, n)` the first time a question is retired, and `DiagnosticTest` pins six such ordinals. Recorded as **D3** with the intended policy and the prerequisite fix. |
| **`graphVersion` is on the wrong document** (major) | Splitting `meta.graphVersion` into `topicGraphVersion` and `subtopicGraphVersion`, adding `meta.graphHashes` and `E_GRAPH_VERSION_STALE` / `W_GRAPH_HASH_UNSET` / `E_GRAPH_VERSION_EMPTY` (§4.3, §8.5 rule 12) — which is what turns "must change whenever the edge file changes" into an enforced statement. | "Add `graphVersion: string` to `StudentProfile`." `StudentProfile` here is the **teacher-dashboard sample fixture** lifted from `studentProfiles.ts` (`whereToStart`, `pace`, `mastery`, `workingOnNow`) — not `build-plan.md` §5.2's transferable document, which corresponds to `EngineState` + activity summary and does not exist yet. Stamping a version on the wrong entity is worse than leaving it off. The real artefact and its version fields are recorded as **D5**. |

### Deferred (3) — recorded in §9.2

| Finding | Deferred as | Reason |
| --- | --- | --- |
| **Line-level / subtopic-level evidence in `AttemptEvent` and `EngineState`** (major) | **D4** | `EngineState` is session-scoped and resets on reload, so there is no persisted artefact whose key space a later change would migrate — the "costs a migration" argument does not hold here. Fields no producer writes and no consumer reads are speculative code no success criterion can check. The exact shape is recorded, and `EngineState.nodes`'s docblock now says the key space widens in Phase 3. |
| **Lessons keyed 1:1 by topic** (minor) | **D6** | Lessons are not one of `build-plan.md` §0.1's target tables, so no Phase-2 drop-in depends on this. The blast radius is `lessonForTopic()` and three call sites in one file. The `id` + `scope` + `lessonsByScope` shape is recorded so Phase 5.3 implements a decision rather than a new design. |
| **`correctAnswer` is an opaque string** (minor) | **D2** | The reviewer's own recommendation was to record rather than build. Four optional fields with no consumer would invite four divergent implementations; the shape is written down instead, with a note that it must be decided *before* the $6,000 generation run. |

### Rejected (1, plus the in-place rejections noted above)

| Finding | Why |
| --- | --- |
| **Relax `E_REF_SAMPLE_TOPIC` now** (part of the `AttemptEvent` finding) | The rule currently guards three real sample fixtures against being keyed on a non-graph topic — which would render nothing on the map. There is no subtopic-level sample state to permit, and weakening a live check in anticipation of data that does not exist buys nothing. Recorded in **D4** as part of the same change that introduces subtopic-level state. |

Also rejected in place, with reasons stated at the point of decision:

- **Downgrading the topic→strand half of `E_ID_PARENT_MISMATCH` to a warning** (offered as
  an alternative to the alias mechanism) — §1.6. That check being fatal is the entire
  value of the hierarchical scheme; the alias mechanism is the cheaper way to buy
  reparenting.
- **Reordering `topics.json` so graph topics appear in `n1..n15` relative order** (offered
  as an alternative to `graph.order`) — §2.2. It would move the class-setup and homework
  pickers, trading one visible change for another.
- **Adding a `meta.acceptedExceptions` waiver list for year-band violations** (offered as
  an alternative to downgrading the severity) — §8.5 rule 7. One mechanism, not two;
  `--strict` already separates "CI must be clean" from "a local build must not be blocked".
