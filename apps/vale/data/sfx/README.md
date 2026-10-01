# Vale sound catalog

`00-listening.json` names the reviewed clips. Four are pinned in
`../../samples.ts`, with the wolf's cry; the village fire uses procedural
crackles. The file creates descriptions without starting new builds.

`01.json` has the shared sound builder. Its query binds one build to each `sfx`
description, and its content template gives Seed Audio that description. Each
later file has up to seven descriptions. Load one file at a time with
`store_load` after the app release is live. Editing one description changes only
its build. An output cites its description and names an existing blob; the page
keeps the pinned clips until a reviewer deliberately replaces them.

The creatures' cries and steps, the wolf's among them, are not here: a
creature's `sounds` names them, so every store needs them, and they live in
`../../seed/sounds.json`.
