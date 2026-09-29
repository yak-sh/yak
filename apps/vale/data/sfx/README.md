# Vale sound catalog

`00-listening.json` names the reviewed clips. Five are pinned in
`../../samples.ts`; the village fire uses procedural crackles. The file creates
descriptions without starting new builds.

`01.json` has one water sound for the hosted proof. Each later file has up to
seven descriptions and one hosted builder per sound. The builder query selects
its own `sfx.name`; the Seed Audio reply becomes a `built` row with a blob
address, exact prompt and citation to that description. Load one file at a time
with `store_load` after the app release is live. Editing one description starts
only its builder. The page reads the built rows and keeps the pinned clips until
a reviewer deliberately replaces them.
