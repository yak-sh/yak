// The read side for a store SQL cannot read into. Where the bytes live in the
// same database as the rows, the resolution is a SQL expression and a bundle
// already comes back carrying text (see ./sqlite.ts); where they live in a
// directory or a bucket, something has to fetch them, and this is that
// something.
//
// It takes bundles and returns bundles — the shape a read already produces — so
// it fits wherever the entities arrive: after `read()`, after a subscription
// push, after `apply()` returns.

import type { Bundle, Comp } from '@yaks/graph'
import { each, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { bodies } from './props.ts'
import { type Blobs, decode } from './store.ts'

/**
 * Resolve every content-addressed property in these bundles: each address is
 * looked up in the store and replaced by the text it names. An address the
 * store does not hold is left in place — dropping the value would be a worse
 * result than an address nobody can resolve.
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
  let props = bodies(vocab)
  if (!props.length) return bundles
  return each(bundles, [] as Bundle[], (out, b) => {
    let one: Bundle = { ...b }
    return then(
      each(props, null, (_, { comp, prop }) => {
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
