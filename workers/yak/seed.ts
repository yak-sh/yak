// The data an app comes with (T-34327). A `seed.json` beside index.html, or a
// `seed/` folder of `*.json` files, each holding a list of bundles in the wire
// shape `graph_apply` takes. A release applies them to the app's store ONCE —
// on the first deploy that finds them, and again in the space an `app_install`
// copies the app into — so a person opening a new app finds it furnished
// instead of blank, and a redeploy never writes over what they changed since.
//
// A FOLDER as well as a file, because the data is the large thing here. Owner,
// 2026-09-05: "i noticed the agent was struggling with the very large seed data
// json it was making for its custom loader. so if the seed data could be a
// seed.json file or a seed/*.json folder, that might help." An agent writes it
// a call at a time and the pieces are one batch: filename order, applied
// atomically, aliases resolving ACROSS files, so a bundle in
// `seed/02-menu.json` may point at an entity `seed/01-places.json` minted.
//
// The files are the app's INSIDE, like vocab.json and tools.json: deployed,
// never served to the web (apps.ts MANIFEST).
//
// The reading is the seed's only where `seedy` and the once-only mark are. The
// rest — the order, the aliases across files, the file a refusal is blamed on —
// is what `store_load` applies on demand out of any path in the app (tools.ts,
// T-34392), so a dataset already written there goes into the store without
// being a seed at all.
import type { Bundle } from '@yaks/graph'

/** A file the app is seeded from: `seed.json` beside index.html, or any
 * `*.json` in a `seed/` folder beside it. */
export let seedy = (path: string) =>
  path == 'seed.json' ||
  (path.startsWith('seed/') && path.endsWith('.json'))

/** Whether `file` is one a load `path` names: the file itself, or any `*.json`
 * under it when the path is a folder. A path naming something that is not JSON
 * still matches, and the parser refuses it in its own name. */
export let asked = (path: string, file: string) => {
  let p = path.replace(/^\/+|\/+$/g, '')
  return p != '' &&
    (file == p || (file.startsWith(`${p}/`) && file.endsWith('.json')))
}

/** One file of an app's, as this reads it. */
export type Text = { path: string; text: string }

/** One bundle of a seed, remembering where it was written — a refusal names
 * the word that was wrong and never the entry that carried it, so the entry is
 * this side's to remember. */
export type Sown = { file: string; index: number; bundle: Bundle }

/** A bundle's place, as a refusal names it. */
export let at = (one: Sown) => `${one.file}[${one.index}]`

let SHAPE = 'a seed file is a JSON list of bundles — ' +
  '[{"entity": {"eid": "$a"}, "doc": {"title": "…"}}]'

// One file's bundles, refused in the FILE's own name: an agent that wrote ten
// of them needs to know which one it mistyped, and the parser is the only place
// that still knows.
let read = (file: string, text: string): Bundle[] => {
  let held: unknown
  try {
    held = JSON.parse(text)
  } catch (e) {
    throw new Error(
      `${file} is not JSON: ${(e as Error).message} — ${SHAPE}`,
    )
  }
  if (!Array.isArray(held)) throw new Error(`${file} is not a list — ${SHAPE}`)
  held.forEach((one, i) => {
    if (!one || typeof one != 'object' || Array.isArray(one)) {
      throw new Error(`${file}[${i}] is not a bundle — ${SHAPE}`)
    }
  })
  return held as Bundle[]
}

/**
 * Every bundle these files hold, in the order it is applied: the files sorted
 * by name, each file's bundles in the order it wrote them. `seed.json` sorts
 * before `seed/…` on its own — `.` is below `/` — so one file and a folder
 * together still have one order.
 */
export let loaded = (files: Text[]): Sown[] =>
  [...files]
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    .flatMap((f) =>
      read(f.path, f.text).map((bundle, index) => ({
        file: f.path,
        index,
        bundle,
      }))
    )

/** Every bundle an app's SEED holds — the seed files among its own, read as
 * one. */
export let sown = (files: Text[]): Sown[] =>
  loaded(files.filter((f) => seedy(f.path)))

/** The door a seed is written through: a batch in, the refusal's own sentence
 * out, or null when the store took it. `check` asks only whether it WOULD —
 * every phase runs and the transaction rolls back. */
export type Applying = (
  batch: Bundle[],
  check: boolean,
) => Promise<string | null>

// WHICH bundle the store refused. The refusal names the word that was wrong,
// never the entry that carried it, so the batch is asked again as PREFIXES —
// `?check=1`, which writes nothing — and the shortest prefix refused in the
// same words ends at the bundle that caused it. Binary search, because a seed
// is exactly the large thing this feature exists for and a bundle-at-a-time
// walk of ten thousand of them is ten thousand round trips.
//
// A bundle that names an alias a LATER one mints reads as a refusal of its own
// until that one is in the prefix, so blame lands on the later of the two.
// Rare, and the sentence is right either way; the whole batch refusing is what
// is being explained.
let blamed = async (
  all: Sown[],
  apply: Applying,
  said: string,
): Promise<Sown> => {
  let lo = 1
  let hi = all.length
  while (lo < hi) {
    let mid = (lo + hi) >> 1
    let no = await apply(all.slice(0, mid).map((s) => s.bundle), true)
    if (no == said) hi = mid
    else lo = mid + 1
  }
  return all[lo - 1]
}

/**
 * The bundles applied, as one atomic batch. Answers the ones it wrote, empty
 * where there were none. A refusal throws with the refusal's own sentence and
 * the file and index of the bundle it was about, which is what an agent needs
 * to fix the file it wrote.
 */
export let load = async (all: Sown[], apply: Applying): Promise<Sown[]> => {
  if (!all.length) return all
  let no = await apply(all.map((s) => s.bundle), false)
  if (no == null) return all
  throw new Error(`${at(await blamed(all, apply, no))} was refused: ${no}`)
}

/** The app's seed applied, once — the whole of it as one batch. */
export let sow = (files: Text[], apply: Applying): Promise<Sown[]> =>
  load(sown(files), apply)
