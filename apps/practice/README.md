# Practice planner

A coach's practice plans on yaks.app: each practice minute by minute, with the
clock time every drill starts, and a library of drills to add from. The owner
and editors plan; anyone with the link reads the plan, and a plan prints as one
sheet for the clipboard.

A practice is `practice{date, start, team, focus}`, with its notes after
practice in `doc.body`. A block is one drill in a practice,
`block{practice, ord, minutes, kind}`, with the drill's name and coaching points
copied into its `doc` when it is added, so editing the library never rewrites a
practice already run. A drill is `drill{minutes, kind, equipment}` with its name
and how it runs in `doc`.

`plan.js` holds the logic (times, order, copying a practice), `ui.js` the dialog
and the foot, `app.js` the page. Typed coaching points and notes are kept as
drafts until saved.

The demo at https://yourname.yaks.app/practice/ holds a varsity basketball
season written into its store; an installed copy starts empty. Run
`deno task test apps/practice` for the planner's logic.
