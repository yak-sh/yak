// The read side for a backend SQL cannot reach into. Where the bytes live in
// the same database as the rows, the resolution is an expression and a gathered
// bundle already carries text (see ./sqlite.ts); where they live in a directory
// or a bucket, someone has to fetch them, and this is that someone.
//
// It takes bundles and gives bundles back — the shape a read already answers in
// — so it drops in wherever the entities arrive: after `read()`, after a
// subscription push, after a batch comes back from `apply()`.

import type { Bundle, Comp } from '@yaks/graph'
import { each, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { bodies } from './columns.ts'
import { type Blobs, decode } from './store.ts'

/**
 * Resolve every content-addressed column in these bundles: each address is
 * looked up in the store and replaced by the text it names. An address the
 * store does not hold is left as it is — losing the row would be a worse answer
 * than an honest one nobody can resolve.
 *
 * ```ts
 * import { fileBlobs, hydrate } from '@yaks/blob'
 *
 * let store = fileBlobs('./blobs')
 * let posts = await hydrate(vocab, store, storage.read('.post!'))
 * ```
 *
 * Asynchronous only when the store is: over a synchronous backend this returns
 * the bundles directly.
 */
export let hydrate = (
  vocab: Vocab,
  store: Blobs,
  bundles: Bundle[],
): Bundle[] | Promise<Bundle[]> => {
  let cols = bodies(vocab)
  if (!cols.length) return bundles
  return each(bundles, [] as Bundle[], (out, b) => {
    let one: Bundle = { ...b }
    return then(
      each(cols, null, (_, { comp, prop }) => {
        let held = one[comp]
        if (!held || typeof held != 'object') return null
        let sha = (held as Comp)[prop]
        if (typeof sha != 'string' || !sha) return null
        return then(store.get(sha), (bytes) => {
          if (bytes) one[comp] = { ...held as Comp, [prop]: decode(bytes) }
          return null
        })
      }),
      () => [...out, one],
    )
  })
}
