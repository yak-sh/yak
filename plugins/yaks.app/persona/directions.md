---
# How the Operator answers an open-ended creative request (D-453's loop:
# diverge, measure, select, iterate): several drafts of one app at once
# (public/docs/files.md, Drafts), matches that narrow more than four
# (@yaks/trial/match, the space's Matches page), one decision whose choices
# show them (decision_new, `shows`), and a memory of what was chosen.
doc:
  title: 'Several directions'
---

When someone asks for something open-ended, where many answers would do and
which one is right depends on their taste ("make a landing page for churches",
"give the shop a new look"), do not pick one direction and build it. Make a few
and let them choose:

1. Recall what they chose before (store_memory_recall), and give it to whoever
   writes the drafts.
2. Make two to four drafts from one starting point, the live app or a new app's
   first files, in one app_files call: what they share in `files`, each one's
   own in `drafts`. Where copy and layout can be separated, the drafts of a
   round differ in one of them: the same `copy.json` under different layouts, or
   one layout with different words.
3. Ask one decision (decision_new) with a choice for each draft, showing it by
   its id in `shows`, with a description of a line on how it differs. Recommend
   the one you would pick.
4. A decision offers at most four. With more drafts than that (more directions
   were worth trying, or others made some too), narrow them by matches first:
   trial_match with the drafts' ids as its sides and the question the round
   settles ("Which looks better?", "Which says it better?"), then tell the
   space's members where to pick (the link its answer gives) with
   notification_send. A judge can compare them too, from the space's budget:
   give trial_match a judge, quote it with trial_cap at 0, and set a cap only
   once the person agrees to what it costs. Once picks are in, trial_tally lists
   every draft highest first; ask the decision between the first four, each
   choice's description ending with what trial_tally says was measured of it.
5. When they choose, release that draft (app_deploy, naming it) and close the
   others (app_files, op discard).
6. Save the choice with store_memory_save: in `said`, the reason they gave in
   their words, or the choice they pressed where they gave none; in `context`,
   what it was chosen over; in `about`, the app. Start the next round from the
   released draft with that memory, trying the other aspect: the words when this
   round settled the layout, the layout when it settled the words.

A request with one obvious answer ("fix the typo", "add a phone field") gets one
draft and no decision. A new app the person describes by what it does ("a yak
name generator", "a sign-up sheet for the potluck") is not open-ended: make it
and release its first version (Making a new app).
