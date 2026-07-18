Problems: 
* (1) Teachers don’t know where to start to help their underperforming students 
* (2) Teachers are to under resourced to support their underperforming students.
---
* Math Academy have successfully reinvented the wheel if their results (getting 12 year olds to score 5 in AP calc) are true. 
* Much of  the Edtech community raise a good point with regards to motivation.
* Students won’t necessarily study hard on their own, especially if the work feels extracurricular. 
* I think this means that even though bettering the learning experience remains central to our mission, we should focus on supporting teachers instead of replacing them. 
* I think the problem we could look to solve is just working with teachers to pick up under performing students, or students who want to do complex things (STEM A levels, Ad maths GCSE), but just can’t/aren’t seen as intelligent enough to handle it. 
* Math Academy have been marketing themselves as just the whole package of mastery based learning. \Outside of the Knowledge graph, it still feels like a slight Black Box, where parents simply understand that it’s just a really good application for teaching their children maths. 
* Anyway what I think we could do differently is put a stronger emphasis on the student’s individual knowledge profile. 
* Use the knowledge graph and regular reporting on what the student is getting right and what the student is demonstrably not understanding. 
* And effectively have teachers use this to instruct the student on where they need to focus their study in order to improve.  
* This is the same model used by Alpha School within their schools. 
* What I’m proposing is offering the student analytics aspect of Alpha School as a service to schools instead of a replacement of schools. 
* The platform would combine math academy's pedagogy (mastery based learning, knowledge graphs, lessons, reviews), with Alpha school's analysis of where the student's understanding gaps are (going beyond Math Academy's analysis of knowledge gaps)
* The purpose of math academy styled reviews on our platform could serve more as a RLHF, where the AI looks at the students work, identifies where they got something wrong, and the student either selects, or articulates why they got something wrong, so that the platform can better advise/update the teacher.
* I say "AI", but this doesn't have to be anything more complex than what Math Academy currently have + the ability for the student to answer "i don't know" and the ability to share why they got something wrong.

Our priority will be Mathematics, but we will also have a service for writing (English, Humanities, Social Sciences) that is more for the teachers to identify where the student is going wrong, than it is for students to work on their writing independently.

* I did not enjoy Openread (Math Academy for English) it was just Ai generated ACT reading. 
* On the English,reading,Social Science, writing front, I think AI use would probably be much heavier. 
* Here’s how I think it could be used to support teachers. 
* NLP for times where students write. 
* Anadramos AI would look at what the student is writing in order ot:
	* Evaluate the strength of the student's argument based on the level the student is at in their education journey
	* Identify where they have demonstrated a lack of understanding of any part of the topic
	* Identify where their understanding appears ambiguous and suggest questions that the teacher could ask specific students to test their understanding.
* This would incorporate Knowledge graphs a lot less I think, but we would still be able to create knowledge profiles. 
	* i.e. “I know Sam understands how deductive reasoning works, based on his demonstrated understanding of it when we first learned about it (this would be based on previous evaluations by the AI), but Anadromos has identified that the argument he makes uses this incorrectly.” 
* Especially helpful in instances where the teacher feels that there is something off about what the student has written, but can’t put their finger on it, so just gives a lower mark without the requisite feedback, which would be especially difficult if the teacher has a big class.

* Feels like these approaches would mainly be for Maths, English, Humanities, Social sciences, but a slightly different method would be needed for the three sciences

---

# Changelog — decisions layered on during design (18 July 2026)

*The notes above are the original founder brainstorm and are left untouched. These points were decided later, while prototyping the Teacher / Student / Parent views, and extend (rather than replace) the thinking above.*

* **Multi-select on "why did you get this wrong."** The original idea was the student selects/articulates the one place they went wrong. In the prototype the student can flag *every* line that went wrong, each with its own reason and its own focused re-teach — a richer RLHF signal per piece of working. Keeps the "I don't know / got it all wrong" option you wanted.
* **A read-only parent view exists now.** Not a consumer product and not a comms channel — no marks, no scores, no comparison. Parents see mastery, what's coming up, and where their child got stuck (with the re-teach), all through the school. Flagged for a deliberate decision, since it touches the "service to schools, not parents" line.
* **Free play, but earned.** Students get an open topic map with unlimited AI-generated problems, but a subtopic only unlocks once its lessons are done, and the work still feeds the knowledge profile and recency stats — so it can't be used to skip the taught path.
* **Teacher oversight is a short flag list, not a transcript dump:** uncertain diagnosis, possible gaming, mastery/retention mismatch → an "address in person" to-do list on the dashboard.
* **Knowledge graph shown two ways:** a Focused view (just the class's basket of topics for the year) and All of Maths; clicking a node shows when it was last worked, next review, and retention.
* **A class carries a "basket of topics" for the year** — this drives the focused graph, homework gating, and the expected-pace comparison in a student's drill-down.