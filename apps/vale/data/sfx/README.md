# Vale sound catalog

`00-listening.json` names the reviewed clips. Five are pinned in
`../../samples.ts`; the village fire uses procedural crackles. The file creates
descriptions without starting new builds.

`01.json` has the shared sound builder. Its query binds one build to each `sfx`
description, and its content template gives Seed Audio that description. Each
later file has up to seven descriptions. Load one file at a time with
`store_load` after the app release is live. Editing one description changes only
its build. An output cites its description and names an existing blob; the page
keeps the pinned clips until a reviewer deliberately replaces them.
