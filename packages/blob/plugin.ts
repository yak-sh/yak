// The substitution, as a graph plugin. A writer sends text; the row keeps the
// text's address and the bytes go to the store; a reader gets text back.
// External stores keep content in `prepare`, before the graph takes its write
// lock. Transactional stores keep it after the `$was` guard, so bytes and rows
// roll back together. Both leave text intact until the guard checks it, then
// substitute references in `precondition` and restore text in `commit`. `$blob`
// carries the prepared references and original text through the change.

import type { Bundle, Comp, Plugin } from '@yaks/graph'
import { after, each } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { bodies, type Body } from './props.ts'
import { address, type Blobs, encode } from './store.ts'

let STASH = '$blob'
type Stored = { value: string; ref: string | number }
type Stash = Record<string, Stored>

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

// Keep content while leaving the text available to the graph's guard.
let stage = (
  b: Bundle,
  props: Body[],
  intern: (value: string) => string | number | Promise<string | number>,
): Bundle | Promise<Bundle> => {
  let mine = written(b, props)
  if (!mine.length) return b
  let stash: Stash = {}
  let out: Bundle = { ...b }
  return after(
    each(mine, null, (_, [{ comp, prop }, value]) => {
      return after(intern(value), (ref) => {
        stash[`${comp}.${prop}`] = { value, ref }
        return null
      })
    }),
    () => {
      out[STASH] = stash
      return out
    },
  )
}

let swap = (b: Bundle): Bundle => {
  let stash = b[STASH] as Stash | undefined
  if (!stash) return b
  let out = { ...b }
  for (let [key, { ref }] of Object.entries(stash)) {
    let [comp, prop] = key.split('.')
    out[comp] = { ...patch(out, comp)!, [prop]: ref }
  }
  return out
}

// Put the text back where the caller wrote it, and take the stash away.
let restore = (b: Bundle): Bundle => {
  let stash = b[STASH] as Stash | undefined
  if (!stash) return b
  let out: Bundle = { ...b }
  delete out[STASH]
  for (let [key, { value }] of Object.entries(stash)) {
    let [comp, prop] = key.split('.')
    let held = patch(out, comp)
    if (held) out[comp] = { ...held, [prop]: value }
  }
  return out
}

/** How a store addresses an object from a component row. Usually the hash
 * itself; an existing SQL layout may instead keep an integer foreign key.
 * Called after `put`, in the store's preparation phase. */
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
 * import { ram } from '@yaks/ram'
 * import { blobKeywords, blobs, memoryBlobs } from '@yaks/blob'
 *
 * let body = { type: 'string', store: 'blob' }
 * let post = { component: true, type: 'object', properties: { body } }
 * let vocab = loadVocab([{ $defs: { post } }], [blobKeywords])
 * let store = memoryBlobs()
 * let g = graph({ storage: ram(vocab), vocab, plugins: [blobs(vocab, store)] })
 * g.apply([{ entity: { eid: 'p1' }, post: { body: 'a long essay…' } }])
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
  let prepare = (bundles: Bundle[]) => {
    // Cache only within this change: a rolled-back transactional reference
    // must never be reused. Equal values need one hash and one store call.
    let refs = new Map<string, string | number>()
    let intern = (value: string) => {
      let held = refs.get(value)
      if (held !== undefined) return held
      let sha = address(value)
      return after(
        store.has(sha),
        (exists) =>
          after(
            exists ? undefined : store.put(sha, encode(value)),
            () =>
              after(reference(sha), (ref) => {
                refs.set(value, ref)
                return ref
              }),
          ),
      )
    }
    return each(
      bundles,
      [] as Bundle[],
      (out, b) => after(stage(b, props, intern), (one) => [...out, one]),
    )
  }
  return {
    name: '@yaks/blob',
    hooks: {
      prepare: (bundles) => store.transactional ? bundles : prepare(bundles),
      precondition: (bundles) =>
        after(
          store.transactional ? prepare(bundles) : bundles,
          (ready) => ready.map(swap),
        ),
      commit: (bundles) => bundles.map(restore),
    },
  }
}
