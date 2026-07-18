# Anadromos MVP: Design Brief for Claude Design

## Design System

Anadromos should look and feel nautical: calm, precise, and built to be trusted by a teacher rather than to hook a consumer. The palette is orange, blue, white, light brown, and black used only where necessary for contrast or text. Blue (a deep, ocean-leaning navy rather than a bright tech blue) should carry the bulk of the interface, navigation, headers, and structural chrome, since it reads as credible and calm rather than playful. Orange should be reserved for the things that matter most in the moment: primary actions, live mastery and progress indicators, and anything flagged for the teacher's attention, so it keeps its power by staying scarce. White carries the background and gives the whole product room to breathe; this is a tool a teacher will look at for extended stretches during a working day, not a feed designed to be scrolled. Light brown (driftwood, sand, unbleached paper rather than anything orange-leaning or saturated) should be used for secondary surfaces, cards, and to separate content areas without resorting to grey, giving the product warmth without adding visual noise. Black is used sparingly, for body text and small high-contrast icon work, never as a dominant surface. The overall tone should avoid the bright, high-saturation, gamified aesthetic common in consumer ed-tech (leaderboards, badges, confetti); the research behind this product found that competitive, reward-driven visual design measurably demoralises lower-performing students, which are exactly the students Anadromos exists to serve, so restraint here is a functional requirement, not just a style preference. The logo is a koi fish swimming upstream against smaller fish moving the other way, referencing the name Anadromos (Greek for a fish that swims upstream to spawn), and the visual system should feel like it belongs next to that mark: nautical, deliberate, and built for someone swimming against a difficult current.

## What Anadromos Is

Anadromos is a diagnostic and instructional layer for schools, not a consumer tutoring app. It is sold to schools and school districts; the teacher is the primary user and the person whose daily workflow the product has to make measurably easier; the student is the end user generating the data the teacher relies on. The core idea: a Math Academy-style knowledge graph and mastery engine tracks what a student actually knows, and instead of just reporting a score, an AI diagnostic layer works out why a student got something wrong and hands that read to the teacher, who decides what to do with it. The product does not replace the teacher, does not talk directly to parents, and is not designed to be played with independently the way a consumer app is. It is a professional tool.

## Who to Design For

**Teacher.** The primary user and the main design target for this brief. Needs a fast, low-effort way to see, at a glance, which students are stuck, on what, and why, without having to read raw data or transcripts to get there.

**Student.** Uses the product during class or assigned practice time to work through maths problems. The experience should feel calm and focused, not gamified, and should never feel like it is grading the student socially against classmates.

**School admin (light touch for MVP).** Sets up the school account, imports or creates class rosters, and assigns teachers to classes. This role needs the minimum viable interface for MVP, not a full admin console.

## MVP Scope

The MVP is Mathematics only, for one or two grade bands, piloted with a small number of design-partner schools. In scope:

- The knowledge graph and mastery engine: topics as nodes, prerequisites as edges, a computed "frontier" (what a student is ready to learn next), and spaced repetition that trickles down to simpler topics a mastered topic depends on.
- The error-classification loop: when a student gets a problem wrong, they classify why (a typing or clicking slip, a silly mistake, the question was genuinely too hard, or they have not learned the content yet), and that classification feeds the diagnostic model.
- The teacher-facing dashboard: a live, per-student and per-class map of demonstrated understanding, flagged gaps, and a plain-language explanation of why a student is stuck, not just a percentage score.

Explicitly out of scope for this MVP, but worth knowing about so the architecture and visual system can accommodate them later without a redesign:

- "Probe mode" (the AI asks a student to justify an unstated assumption in their working) and the fuller RLHF-style confirm/correct/"I don't know" loop. These are the next phase, layered on top of the MVP's error-classification loop.
- The Writing/English/Humanities NLP diagnostic track for teachers. A later, separate product line built once the maths product is validated.
- Anything consumer-facing: parent accounts, homeschool positioning, ads, gamified leaderboards or badges, or a freemium tier.

## Screens and Flows to Design

**1. Teacher onboarding and class setup.** A teacher (or admin, on their behalf) creates or imports a class roster and selects the curriculum slice being piloted (grade band, topic range). Should feel closer to setting up a professional tool than signing up for an app; minimal friction, no consumer-style upsell moments.

**2. Student practice session.** The core working screen for a student: a problem drawn from their current frontier and a clean workspace to show working. This screen should read as calm and workmanlike, closer to a well-designed exam paper or notebook than a game. Progress should be visible to the student (what they've mastered, what's next) without turning into a score or a comparison to peers.

On a wrong answer, the follow-up flow is specific and worth designing carefully, since it is the main source of diagnostic signal in the whole product. The student's working is shown broken into individual, clickable lines or steps, not as one uneditable block. The student is asked to click on the line where they think they went wrong. A persistent, equally visible alternative should sit alongside the working at all times: an option along the lines of "I got it all wrong" or "I'm not sure where," for a student who cannot or does not want to pinpoint a specific line. Once a line is selected (or the "all wrong" option is chosen), a short menu appears with the same set of reasons: a typing or clicking slip, a silly mistake, the question was genuinely too hard, or the content hasn't been learned yet. The example problems used to explain the correct approach afterward must be pulled from content genuinely relevant to the specific line and reason selected, not a generic worked example for the topic as a whole; a pinpointed, specific error should lead to a short, focused re-teach of just that step, while "I got it all wrong" should lead to a fuller walk back through the underlying content. The design goal is that a student always leaves a wrong answer with a clear, appropriately scoped next step, not just a red mark.

**3. Teacher dashboard (the most important screen in this brief).** The teacher's home view: a per-class map of where every student stands, with students who need attention surfaced first, not buried in a sorted list. At this class-overview level, a simple status heuristic per student (on track, needs attention, or similar) is the right level of detail, a teacher scanning a whole class needs a fast triage signal, not a full profile for every name. For a given student or class, the teacher should also be able to see mastery by topic (rendered so that a student cannot look "done" with a topic by avoiding its hardest items, the mastery indicator needs to reflect difficulty, not just percent correct), the specific error types coming up most often, and a plain-language read on the likely cause of a struggle (missing foundational knowledge, an ineffective practice method, not enough practice volume, or low motivation), so a teacher gets a fast answer to "where do I even start," not just a data dump.

**4. Individual student drill-down.** The class-level status is deliberately coarse; this screen is where that gets replaced with precision. Clicking into a student should open their full knowledge profile, mapped against where the curriculum expects a student at their grade and point in the year to be, not just a list of topics mastered and in progress. The teacher should be able to see, specifically, which topics or nodes on the knowledge graph the student is ahead of that expected pace on and which they are behind on, not only a single aggregate "on track" or "behind" label. Being ahead in some areas and behind in others is the normal case, not the exception (the research behind this product found that the spread of prior knowledge within a single class is enormous), so the view should be able to show a genuinely mixed profile clearly rather than forcing it into one overall verdict. Alongside this, show the student's current frontier (what they're actively working on right now) and a short history of where they've gotten stuck and why. This is the screen a teacher would use to prepare for a parent conversation or plan a specific intervention, and it needs to hold up to a teacher's own judgement, since the whole point of the product is to give them something more reliable to exercise that judgement on.

**5. Oversight view (curated, not raw).** Teachers and school admins need visibility into what the AI is actually doing with their students, but a raw transcript log will not get used and adds to the workload this product exists to reduce. Design this as a short list of flagged moments (a diagnosis that looks uncertain, an interaction worth a teacher's eyes) rather than a searchable archive of everything.

**6. School admin, minimum viable.** Add teachers, add classes, assign rosters. Nothing more elaborate is needed for the pilot stage.

## Interaction and Content Principles

A handful of behavioural rules from the underlying research should shape the interaction design directly, not just the feature list:

- Retrieval and active problem-solving come first; minimise instructional video or reading before a student is asked to actually do something.
- No leaderboards, no social comparison, no points-for-points'-sake. If any progress visualisation is used, it should be purely informational (this student's own progress over time), never competitive.
- On a wrong answer, ask why before offering help. Research behind this product found that students who attempt a problem independently before getting AI assistance retain their gains far better than students given free access to help; the interaction pattern should always require an attempt first.
- Scaffolding and hints should visibly fade as a student's mastery of a topic increases. A student who has already shown strength in a topic should see a leaner, less hand-held interface than one who is just starting it.
- Keep the visual tone calm and low-distraction throughout. Anything that reads as "engagement" theatre (streaks, badges, confetti, urgency prompts) works against the actual goal, which is durable learning a teacher can trust, not time-on-app.

## Reference

The full business plan, including the problem statement, evidence base, business model, and roadmap this brief is drawn from, is in "Anadromos Business Plan.md" in the same folder.

---

# Changelog — Design-phase decisions (18 July 2026)

*Everything above this line is the original brief as written before prototyping. This section records the decisions we made while building the interactive prototypes (Teacher / Student / Parent POVs) so the brief reflects the product as actually designed. Where a decision changes something above, it says so explicitly rather than editing the original text.*

## A. A parent view was added (supersedes the "no parent accounts" line in MVP Scope)

The original scope ruled out anything consumer-facing, including parent accounts. During design we added a **read-only Parent POV**, deliberately built to stay inside the school-mediated, un-gamified frame rather than becoming a consumer tutoring surface. It is not a separate purchase, not a communication channel, and shows no marks, scores, or peer comparison. Three screens:

- **Overview** — mastery bars per topic area, plus a "coming up" list of upcoming lessons and homework.
- **Sessions** — completed work shown as *struggle-points only* (where the child got stuck and what was re-taught), with no marks or grades attached.
- **Map** — the child's knowledge profile, again with no marks.

Rationale: parents kept surfacing as a real audience, but the research-driven "no social comparison / no grading theatre" principle still holds, so the parent view exposes *understanding and next steps*, never a score. This is a genuine strategic reintroduction of a parent surface and should be flagged to the founders (see Business Plan §3.4, which had listed direct-to-parent products as deliberately excluded).

## B. Student practice: wrong-answer flow is now multi-select (extends Screen 2)

The original brief had the student pinpoint *the* single line where they went wrong. In the prototype this became **multi-select**: a student can flag every line where a technique mistake occurred, not just one. The rest of the flow runs per flagged line:

- Final-answer entry uses a **notation palette**, with an **optional handwriting upload** (photo of their working) alongside it.
- After submitting, the student compares their working against the worked solution, then multi-selects the line(s) that went wrong.
- Each flagged line gets its own **"why"**: typing/clicking slip, silly mistake, genuinely too hard, content not yet learned — plus a free-text **"Other"** option.
- Each flagged line gets its own **re-teach**, scoped to that specific step (not one generic worked example for the whole problem).

The "I got it all wrong / I'm not sure where" alternative from the original brief is retained.

## C. New student surfaces beyond the single practice screen

The brief described one core practice screen. The prototype student experience is broader:

- **Home** — mastery-path lessons and reviews on individual subtopics, *plus* teacher-set **problem sets** with due-date stickers and prerequisite gating.
- **Problem Sets** — teacher-assigned, multi-question solving screen; due dates; locked until prerequisites are met.
- **Free Play** — the full maths topic map. Tap a topic → unlock subtopic practice by completing its lessons → infinite AI-generated problems. Free-play work **contributes to mastery data and "last studied" recency**, and is **locked behind lesson completion** so it can't be used to skip the taught path.
- **My Map** — a **Focused** profile (driven by the class basket of topics) and a full **"All of Maths"** profile; clicking a node shows last-worked, next-review, and retention timings.

## D. Teacher dashboard and drill-down (extends Screens 3–5)

- **Class switcher** across the teacher's classes.
- **Dashboard** keeps the attention-first triage, and adds an **"address in person" to-do list** fed from student activity logs and the Oversight flags.
- **Student drill-down** now shows pace vs. expected, mastery, the two knowledge-graph views (Focused + All of Maths) with spaced-repetition timings, and an **activity log** with per-hiccup detail including any **uploaded working images**.
- **Oversight** flag types were made concrete: uncertain diagnosis, possible gaming, and mastery/retention mismatch.

## E. Class Setup (extends Screen 6, school-admin)

Class setup is now roster **plus a "basket of topics" for the year** — the set of topics that drives the Focused knowledge-graph view and problem-set gating — with a year-band filter and search over the topic list.

## F. Knowledge graph split

Throughout the product the knowledge graph is presented in two views: **Focused** (only the basket of topics for the class/year) and **All of Maths** (the complete graph). Node click surfaces last-worked / next-review / retention in both.
