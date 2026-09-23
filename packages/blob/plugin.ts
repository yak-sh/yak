// The substitution, as a graph plugin. A writer sends text; the row keeps the
// text's address and the bytes go to the store; a reader gets text back.
// Neither the component that declared the property nor the application writing
// to it has to know any of this happened — that is the whole point, and it is
// why the substitution happens inside `apply()` rather than in a caller.
//
// Which phase, and why it is the only one that works. The bytes and the row
// must land together — a row pointing at bytes that were never written is a
// broken document, so the store write cannot happen before the transaction
// opens (`normalize`, `admit` and `mint` are all outside it). Inside the
// transaction the phases run precondition → mutate → cascade → stamp → journal
// → commit, and within a phase the core runs first and plugin hooks after it.
// So `mutate` is already too late: by the time a `mutate` hook is called, the
// core has handed the bundles to storage and the text is in the row. The last
// moment before that is a hook on `precondition`, which is also the correct
// side of the `$was` precondition guard: the guard hashes the value the caller
// read, and what a caller reads is the text, so it has to run against text —
// and it does, because the core's guard runs first and this hook substitutes
// after it.
//
// The substitution is undone at `commit`, the last phase inside the
// transaction, so what `apply()` returns is what the caller wrote. A client
// that applies the return value to its cache gets its document back, not a hash
// of it. The text is carried between the two hooks on the bundle itself, under
// `$blob` — a key beginning with `$` is never written as a property, which is
// the ordinary way one phase passes a decision to a later one.

import type { Bundle, Comp, Plugin } from '@yaks/graph'
import { each, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { bodies, type Body } from './props.ts'
import { address, type Blobs, encode } from './store.ts'

/** Where the substituted-out text waits between the two hooks: `comp.prop` →
 * the text the caller sent. Never written as a property — the key starts with
 * `$`. */
let STASH = '$blob'

// The bundle's patch for a component, when it carries one at all. A `null`
// component is a deletion, not a value, and has no text to move.
let patch = (b: Bundle, comp: string): Comp | undefined => {
  let c = b[comp]
  return c && typeof c == 'object' && !Array.isArray(c) ? c as Comp : undefined
}

// One bundle's content-addressed properties that carry a string in this write.
let written = (b: Bundle, props: Body[]): [Body, string][] =>
  props.flatMap(({ comp, prop }) => {
    let value = patch(b, comp)?.[prop]
    return typeof value == 'string' ? [[{ comp, prop }, value] as const] : []
  })

// Convert one bundle: every body property's text becomes its address, the text
// is stashed for the return trip, and the bytes go to the store — skipped when
// the store already holds them, which is what makes a repeated value one
// object.
let swap = (
  b: Bundle,
  props: Body[],
  intern: (value: string) => string | number | Promise<string | number>,
): Bundle | Promise<Bundle> => {
  let mine = written(b, props)
  if (!mine.length) return b
  let stash: Record<string, string> = {}
  let out: Bundle = { ...b }
  return then(
    each(mine, null, (_, [{ comp, prop }, value]) => {
      stash[`${comp}.${prop}`] = value
      return then(intern(value), (ref) => {
        out[comp] = { ...patch(out, comp)!, [prop]: ref }
        return null
      })
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

/** How a store addresses an object from a component row. Usually the hash
 * itself; an existing SQL layout may instead keep an integer foreign key.
 * Called after `put`, inside the transaction, so the object it names exists. */
export type Reference = (
  sha: string,
) => string | number | Promise<string | number>

export type BlobOpts = {
  /** Narrow the vocabulary's blob properties for a partially migrated store. */
  props?: Body[]
  /** Translate the content hash into the reference the row should hold. */
  reference?: Reference
}

/**
 * The blob plugin: content-addressed storage for every property the vocabulary
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
 * The write side is here. The read side belongs to the storage adapter, which
 * is the half that knows its own layout: over SQL, register {@link blobRead}'s
 * property overrides and a row resolves in the statement itself; over any other
 * store, {@link hydrate} resolves the bundles a read returned.
 *
 * A vocabulary loaded without {@link blobKeywords} declares no body properties,
 * so this plugin is a no-op on it rather than a surprise.
 */
export let blobs = (
  vocab: Vocab,
  store: Blobs,
  opts: BlobOpts = {},
): Plugin => {
  let props = opts.props ?? bodies(vocab)
  let reference = opts.reference ?? ((sha: string) => sha)
  return {
    name: '@yaks/blob',
    hooks: {
      precondition: (bundles) => {
        // Intern equal text once per transaction, before hashing it. The store
        // deduplicates bytes anyway, but repeatedly hashing one shared large
        // body still costs its size times the number of rows. This map is
        // transaction-local on purpose: a rollback (or an unrelated apply) must
        // never reuse an uncommitted reference. `each` visits values
        // sequentially even for asynchronous stores.
        let refs = new Map<string, string | number>()
        let intern = (value: string) => {
          let held = refs.get(value)
          if (held !== undefined) return held
          let sha = address(value)
          return then(
            store.has(sha),
            (exists) =>
              then(
                exists ? undefined : store.put(sha, encode(value)),
                () =>
                  then(reference(sha), (ref) => {
                    refs.set(value, ref)
                    return ref
                  }),
              ),
          )
        }
        return each(
          bundles,
          [] as Bundle[],
          (out, b) => then(swap(b, props, intern), (one) => [...out, one]),
        )
      },
      commit: (bundles) => bundles.map(restore),
    },
  }
}
