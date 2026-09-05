// The swap, as a graph plugin. A writer sends text; the row keeps the text's
// address and the bytes go to the store; a reader gets text back. Neither the
// component that declared the column nor the application writing to it is told
// any of this happened — that is the whole point, and it is why the swap lives
// in `apply()` rather than in a caller.
//
// WHICH PHASE, and why it is the only one that works. The bytes and the row
// must land together — a row pointing at bytes that were never written is a
// broken document, so the write cannot happen before the transaction opens
// (`normalize`, `admit`, `mint` are all outside it). Inside the transaction the
// phases run precondition → mutate → cascade → stamp → journal → commit, and
// within a phase the CORE runs first and hooks after it. So `mutate` is already
// too late: by the time a `mutate` hook is called the core has handed the
// bundles to storage and the text is in the row. The last moment before that is
// a hook on `precondition`, which is also exactly the right side of the `$was`
// guard: the guard hashes the value the caller read, and the value a caller
// reads is the TEXT, so it must run against text and does — the core guard runs
// first, then this swaps.
//
// And the swap is UNDONE at `commit`, the last phase inside the transaction, so
// what `apply()` returns is the batch the caller wrote. A client that applies
// the return to its cache gets its document back, not a hash of it. The text
// rides between the two hooks on the bundle itself, under `$blob` — a key
// beginning with `$` is never written as a column, which is the ordinary way
// one phase tells a later one what it decided.

import type { Bundle, Comp, Plugin } from '@yaks/graph'
import { each, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { bodies, type Body } from './columns.ts'
import { address, type Blobs, encode } from './store.ts'

/** Where the swapped-out text waits between the two hooks: `comp.prop` → the
 * text the caller sent. Never written as a column — the key starts with `$`. */
let STASH = '$blob'

// The bundle's patch for a component, when it carries one at all. A `null`
// component is a drop, not a value, and has no text to move.
let patch = (b: Bundle, comp: string): Comp | undefined => {
  let c = b[comp]
  return c && typeof c == 'object' && !Array.isArray(c) ? c as Comp : undefined
}

// One bundle's content-addressed columns that carry a string in this batch.
let written = (b: Bundle, cols: Body[]): [Body, string][] =>
  cols.flatMap(({ comp, prop }) => {
    let value = patch(b, comp)?.[prop]
    return typeof value == 'string' ? [[{ comp, prop }, value] as const] : []
  })

// Swap one bundle: every body column's text becomes its address, the text is
// stashed for the return trip, and the bytes go to the store — skipped when the
// store already holds them, which is what makes a repeated value one object.
let swap = (
  b: Bundle,
  store: Blobs,
  cols: Body[],
): Bundle | Promise<Bundle> => {
  let mine = written(b, cols)
  if (!mine.length) return b
  let stash: Record<string, string> = {}
  let out: Bundle = { ...b }
  return then(
    each(mine, null, (_, [{ comp, prop }, value]) => {
      let sha = address(value)
      stash[`${comp}.${prop}`] = value
      out[comp] = { ...patch(out, comp)!, [prop]: sha }
      return then(
        store.has(sha),
        (held) =>
          then(held ? undefined : store.put(sha, encode(value)), () => null),
      )
    }),
    () => {
      out[STASH] = stash
      return out
    },
  )
}

// Put the text back where the caller wrote it, and take the stash away.
let restore = (b: Bundle): Bundle => {
  let stash = b[STASH] as Record<string, string> | undefined
  if (!stash) return b
  let out: Bundle = { ...b }
  delete out[STASH]
  for (let [key, value] of Object.entries(stash)) {
    let [comp, prop] = key.split('.')
    let held = patch(out, comp)
    if (held) out[comp] = { ...held, [prop]: value }
  }
  return out
}

/**
 * The blob plugin: content-addressed storage for every column the vocabulary
 * marks `store: "blob"`.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { blobKeywords, blobs, sqliteBlobs } from '@yaks/blob'
 *
 * let vocab = loadVocab([blog], [blobKeywords])
 * // let g = graph({ storage, vocab, plugins: [blobs(vocab, sqliteBlobs(driver))] })
 * // g.apply([{ entity: { eid: 'p1' }, post: { body: 'a long essay…' } }])
 * ```
 *
 * The write side is here. The READ side belongs to the storage adapter, which
 * is the half that knows its own layout: over SQL, register
 * {@link blobRead}'s column overrides and a row resolves in the statement
 * itself; over any other backend, {@link hydrate} resolves a gathered bundle.
 *
 * A vocabulary loaded without {@link blobKeywords} declares no body columns, so
 * this plugin is a no-op on it rather than a surprise.
 */
export let blobs = (vocab: Vocab, store: Blobs): Plugin => {
  let cols = bodies(vocab)
  return {
    name: '@yaks/blob',
    hooks: {
      precondition: (bundles) =>
        each(
          bundles,
          [] as Bundle[],
          (out, b) => then(swap(b, store, cols), (one) => [...out, one]),
        ),
      commit: (bundles) => bundles.map(restore),
    },
  }
}
