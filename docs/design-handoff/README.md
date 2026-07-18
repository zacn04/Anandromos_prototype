# Handoff: Anadromos — mastery-based maths learning platform

## Overview
Anadromos is a diagnostic, un-gamified maths learning tool for UK secondary schools (sample data is Year 7–8). It has three audiences, each a separate prototype:

- **Teacher POV** — triage a class, drill into a student's knowledge profile and history, pinpoint *why* a student is stuck, run an Oversight queue of AI moments that need a human, keep an "Address in person" to-do list, and set up classes/baskets.
- **Student POV** — a calm home of mastery-path lessons/reviews + teacher-set problem sets, a diagnostic practice loop (final-answer + pinpoint-the-wrong-line + reason + re-teach), a Free-play area over the whole curriculum, a personal "My map", sessions history, and progress.
- **Parent POV** — read-only: child progress, previous sessions (what they struggled with **and why, but never the mark**), upcoming lessons/homework, and the child's map.

The product's guiding principle: **no streaks, points, or rankings.** It surfaces the diagnostic signal (where it went wrong and why), difficulty-weighted mastery, and next-best actions — never a leaderboard or a bare score.

## About the Design Files
The files in this bundle are **design references created in HTML** — single-file prototypes ("Design Components") showing intended look and behaviour. They are **not** production code to copy directly. The task is to **recreate these designs in the target codebase's environment** (React/Vue/native/etc.) using its established patterns, routing, and component library. If no environment exists yet, pick the most appropriate framework (a React + TypeScript SPA is a natural fit) and implement there.

Each `.dc.html` file is a small custom runtime: a `<template>`-style body plus a `class Component` whose `renderVals()` returns the data/handlers the markup binds to. Treat the logic class as the **spec for state and data**, and the markup as the **spec for layout and styling**.

## Fidelity
**High-fidelity.** Final colours, typography, spacing, copy, and interactions are all intended as shown. Recreate pixel-closely using the codebase's libraries. All styling in the prototypes is inline; consolidate into the target design system on the way in.

## Design Tokens

**Palette (nautical):**
- Deep navy (chrome, primary text on light, mastered): `#0e2a43`; secondary navy `#1f4e75`; mid-blue `#3f82ab` / `#4a86ad`; light node blue `#7fb0cd`
- Scarce orange (attention, primary actions, frontier): `#dd6a2f`; deep orange text `#b6531f`; soft orange bg `#fdf0e6` / `#fbe7d8`; orange border `#f0d3bc` / `#eecab0`
- Driftwood / paper surfaces: page bg `#f6f1e7`; card bg `#fff`; warm panel `#faf6ee` / `#fbf3ea`; sand `#efe7d9` / `#f2ece0`; borders `#e4dccb` / `#ece3d2` / `#d8cbb2`
- Blue-info panel: bg `#eef3f7` / `#e4edf3`, border `#d3e0ea` / `#cddceb`, text `#2b4a63`
- Neutral text: `#1a2129` (headings), `#5c6773` (body), `#8a7c63` (muted mono/caption), `#a99e88` (faint)

**Type:**
- Display / headings: **Spectral** (serif), weights 400–700
- UI / body: **Public Sans**, 400–700
- Mono labels & metadata (uppercase, letterspaced): **IBM Plex Mono**, 400–600
- Minimums: never below ~11px for mono captions; body 12.5–14px; H1 ~26–28px.

**Shape & elevation:** border-radius 8–16px (cards 12–14, pills 20, buttons 9–10); shadows are subtle (`0 1px 3px rgba(20,48,74,.05–.06)`). Layouts use flex/grid with `gap`; max content widths ~680–960px centred.

**Status colour semantics:** mastered = navy fill; building/in-progress = light blue; frontier / "learning now" = orange outline on soft-orange; not-ready = sand; locked = dashed sand border. Attention = orange; on-track = navy; ahead = teal `#2f6f92`.

## Screens / Views

### TEACHER POV (`Anadromos Prototype - Teacher POV.dc.html`)
Left nav: **Dashboard · Students · Oversight · Class setup** (a former Admin screen was intentionally removed). Persistent footer: teacher identity ("Ms. Okafor · 8M2, 8M4, 9S1").

1. **Dashboard** — a class switcher (8M2 · Y8, 8M4 · Y8, 9S1 · Y9) updates the header/count. Three switchable layouts:
   - *Attention first* (default): "Needs attention" students pulled to top with topic, cause, and a diagnostic line; the rest collapsed into "On track" / "Ahead of pace" expandable groups.
   - *Three lanes*: needs-attention / on-track / ahead columns.
   - *Full roster*: table (Student · Current topic + per-student insight sub-line · Status chip · Last active).
   - Also on the dashboard: an **"Address in person"** to-do panel (add via `+` free note, or pushed from logs/oversight; remove via a `···` menu per card) and a **Class mastery by topic** chart (difficulty-weighted tiers: Foundations / Core / Stretch).
2. **Student drill-down** — header (name, Year/class), **"Where to start"** callout rendered as 3 bullets (state / root cause / next move — deliberately bulleted to avoid AI-narrative prose). Then: *Against expected pace* ribbon, *Mastery, difficulty-weighted* bars, two buttons opening **Focused knowledge graph** (this class's basket) and **Full knowledge graph** (all maths, mastered coloured), a **Frontier** (mastered / ready-to-learn / not-ready), and an **Activity log** (lessons/problem sets/reviews; each expands to a summary with an "Open where it happened →" button and an "Address in person" button).
3. **Activity-log detail** — every item in an activity with hiccups flagged (orange rows). Clicking a flagged **question** expands: the student's full working in plain text with the **student-selected wrong line(s) highlighted**, then each flagged line listed with its reason, plus an "Address in person →" button. Handwritten-working upload shown when present. (This mirrors the student's diagnostic; the teacher can also open a **"Preview her practice view"** which runs the full student practice loop.)
4. **Oversight** — a short, triaged list (not a transcript archive) of AI moments needing judgement: *uncertain diagnosis*, *possible gaming* ("I don't know" to skip), *probe may have cued the answer* (Clever-Hans). Each card: **Go to the question →** (jumps straight to the exact contention items via the log-detail view, back returns to Oversight), **Address in person**, and **Resolve** (= defer to the AI's judgement).
5. **Class setup** — class basics (name + grade band), a **basket of topics** for the year built from the full catalogue (~34 topics) with a **year-group filter** and **search**, and roster management (add/remove students; the sample class has 8: Aisha Bello, Daniel Kovač, Reuben Clarke, Priya Shah, Tom Weller, Grace Idowu, Elif Demir, Oscar Reid).

### STUDENT POV (`Anadromos Prototype - Student POV.dc.html`)
Top nav: **Home · Free play · Sessions · My map · Progress** (student "Aisha Bello").

1. **Home** — two sections:
   - *Your path*: 6 lessons/reviews on subtopics from the mastery path, progress ("2 of 6 done"), the next item highlighted "Start →", completed ones dimmed with ✓; when all 6 are done, a "Load the next six →" refresh appears.
   - *Problem sets*: teacher-set homework across multiple topics, each with a **due-date sticker** (urgency-coloured) and a **lock note** — locked until prerequisite lessons are done; unlocked ones show "Start homework →".
2. **Practice (diagnostic loop)** — top bar + progress ribbon (informational, never a score). Steps: (a) **Solve** — student types **only a final answer** (`x = ▢`) with a notation palette for characters a keyboard can't produce, plus an *optional* handwriting-photo upload (a `requireHandwriting` prop can make it mandatory); (b) **Solution** — the typed answer beside the correct answer, then the worked solution as **numbered plain text**, then a **multi-select** list ("tick every line where the technique went wrong or you don't understand it — pick more than one"); (c) **Reason** — for **each** flagged line in turn ("Line 1 of 2 you flagged"), pick why: slip / silly mistake / too hard / haven't learned it / **Other** (free-text box; coded as "lack of understanding" for the recommendation engine, saved as extra teacher context, surfaced later as "In your words"); (d) **Re-teach** — one card per flagged line, scoped (focused re-teach / quick reminder / full walk-back / no re-teach for a slip), with example steps and the routing note.
3. **Problem-set solving screen** — multi-question homework: header (title, topics, due sticker), a **question navigator** (answered = blue, current = navy, unanswered = sand), one question at a time with topic chip + final-answer input + palette + optional whole-set handwriting upload, free Prev/Next + jump navigation, then **Submit homework →** → a confirmation ("Sent to Ms. Okafor · N of M answered"). Homework is submitted as a whole set — it does *not* run the per-line diagnostic.
4. **Free play** — *only reachable from the Free-play tab.* A grid of the **complete map of maths** (topics as cards showing "X of Y unlocked"). Tap a topic → its **subtopics**; each has unlimited (AI-generated) practice, but is **only playable if the student has already done that subtopic's lesson** — locked subtopics show "🔒 Do the lesson first". Free play opens the practice loop with a "Free play" banner and **contributes to the "last studied" recency** stat (never a grade).
5. **My map** — "This year's topics" (focused, basket + topic filter) / "All of maths" (full) toggle; tap a node → status, **last worked (incl. "· free play")**, next review, times practised. Caption notes free play counts toward recency.
6. **Sessions** — every past lesson/problem set/review; open one → per-item hiccups + the student's own uploaded handwriting.
7. **Progress** — personal, never comparative: "what you've built up" mastery bars over time.

### PARENT POV (`Anadromos Prototype - Parent POV.dc.html`)
Top nav: **Overview · Sessions · Map** (parent of "Aisha Bello"). **No marks/scores anywhere** — a banner states this explicitly.

1. **Overview** — child header (Year/class/teacher), *Where she's growing* difficulty-weighted mastery bars, and two "coming up" columns: **Lessons coming up** (path) and **Homework due** (problem sets with dates).
2. **Sessions** — every completed lesson/problem set/review; each shows a "Found tricky" / "Went well" tag; expanding one reveals **only what the child struggled with and why** (never the mark), or a "went smoothly" note. Copy reassures parents that follow-up practice is already built into the path.
3. **Map** — the child's knowledge profile graph; tap a topic → how secure it is, **last worked (incl. free play)**, and next review. No score.

## Interactions & Behaviour
- **Navigation** is state-driven (a single `screen` string per POV) — implement as routes/views. Sub-state: selected student/log/node, expanded groups, practice step, question index, address-list, tweak flags.
- **Practice loop** is a small state machine: `solve → solution → reason (iterated over flagged lines) → reteach`. `pLines` (array of flagged line indices), `pReasons` (map line→reason key), `pNotes` (map line→free-text for "Other"), `pIdx` (current line in the reason phase). "Other" writes reason `notlearned` + a note.
- **Problem set**: `psAnswers` (map index→string), `psIdx`, `psSubmitted`; navigator jumps set `psIdx`; submit sets `psSubmitted`.
- **Free play**: `fpTopic` (selected topic) → subtopic list; opening a subtopic sets `fpLabel` and enters the practice loop; exit returns to the subtopic list when `fpLabel` is set, else Home.
- **Oversight "Go to the question"** navigates into the shared log-detail view with `detailReturn:'oversight'` so Back returns to Oversight. **Resolve** = accept AI judgement.
- **Address in person**: pushable from activity-log items, oversight cards, and per-question detail; removable via a per-card `···` menu; addable as a free note via `+`.
- Transitions are light (hover/opacity/border-colour ~120ms). No score animations, confetti, or streaks anywhere.

## State Management
Each POV is one component with local state (see each file's `class Component` / `state` + `renderVals()`), the cleanest source of truth for the data model. Key entities: **students** (name, initials, status, topic, insight, last-active, cause/line), **class/basket** (topic catalogue with year bands), **activity log items** (kind, title, date, flag, summary, detail paragraphs, per-question `items` with `hit`, `work` lines, `wrong` indices, `why`), **knowledge graph** (`NODES` {id,x,y,st,label}, `EDGES` [a,b], `ST` status→style, plus lastMap/nextMap/repsMap keyed by node id), **problem sets** (title, topics, due, urgency, locked, lockNote, questions), **mastery** (difficulty-weighted tiers). In a real build, replace the hardcoded arrays with API data; keep the same shapes.

## Assets
No external images. The Anadromos logo is an inline SVG (a stylised salmon/anadromous-fish + arrow, in `#dd6a2f`) repeated in each top bar — extract once into a shared component. Icons are Unicode glyphs (🗓 🔒 📎 📄 ✓ ← → · arrows) and small inline SVG; swap for the codebase's icon set. Handwriting uploads are represented by a lined-paper placeholder.

## Files
- `Anadromos Prototype - Teacher POV.dc.html`
- `Anadromos Prototype - Student POV.dc.html`
- `Anadromos Prototype - Parent POV.dc.html`
- `Anadromos MVP Design Brief.md`, `Anadromos Business Plan.md`, `masterfile.md` — product context/source.

Each `.dc.html` opens directly in a browser to view the live prototype. Read the `class Component` at the bottom for data shapes and behaviour; the markup above it for exact layout/styling.
