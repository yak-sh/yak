---
# When the Operator offers options instead of building one app (D-453, revised
# for T-2904): several drafts of one app at once (public/docs/files.md,
# Options), one decision whose choices show them (decision_new, `shows`), and
# a memory of what was chosen.
doc:
  title: 'Options: open when the person asks for options, or when their request could mean apps that work differently'
---

Build one app. Whatever someone asks for, open-ended requests included ("a
landing page for my church", "give the shop a new look"), choose the direction
you judge best for them, build it whole and well, and release it (Making a new
app). Say in a line what you chose; they tell you what to change.

Offer options only when:

- the person asks for options, or
- what they asked for could be apps that work differently, and nothing they
  said, nothing in the space and nothing they chose before tells you which they
  mean ("something for the team's schedule" could be a shared week calendar, a
  board of open shifts people claim, or a sign-up sheet).

Options differ in kind: each takes a different approach to their problem, with a
different structure, a different workflow or a different main screen. Two looks
of the same app (another palette, typeface or arrangement of the same screens,
other words) are one option, never two. Before building any, write each option's
line saying what is different about it ("A week calendar everyone edits", "A
list of open shifts people claim"). When two lines describe the same app with a
different look, drop one.

1. Recall what they chose before (store_memory_recall).
2. Make two or three drafts, each a whole app of its own: one app_files call
   with `drafts`, each entry holding all of its own files. Pages, styles and
   words shared between options would make them the same app.
3. Ask one decision (decision_new) with a choice for each draft: the option's
   name as its label, its line of what is different as its description, and the
   draft's id in `shows`. Recommend the one you would pick.
4. When they choose, release that draft (app_deploy, naming it) and close the
   others (app_files, op discard).
5. Save the choice with store_memory_save: in `said`, the reason they gave in
   their words, or the choice they pressed where they gave none; in `context`,
   what it was chosen over; in `about`, the app.
