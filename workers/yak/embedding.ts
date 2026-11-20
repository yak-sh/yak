// Which model a store's vectors are made by (@yaks/embedding, T-59101). Every
// store on the platform keeps a vector beside each text its vocabulary marks
// `search: true`, in its own SQLite, and answers `.near=<entity>` from a copy
// of them held in the object's memory, loaded the first time a search asks,
// so a search reads only the rows of the few it ranks last (@yaks/embedding
// held.ts; the measurements are on T-59374 and T-61474). A Durable Object
// cannot load sqlite-vector, and a space's stores are small enough to hold.
// The directory is a store like any other, so the memories a space keeps are
// ranked the same way (memory.ts).
//
// The provider embedding.json names makes the vectors, an embedder a plugin
// config.ts `embedding` names lends the store (@yaks/host `Host.embedders`):
// Workers AI over the store's `AI` binding, Qwen3-Embedding at its full 1024
// dimensions (T-61474). The store keeps them as float32 in its SQLite and
// holds them as int8 in memory, 1 KB each; a search scans the int8 copy and
// ranks its best hundred by their float rows, which keeps ~99.8% of the full
// vectors' quality where a cut to 256 kept ~95%. Where nothing is lent (no
// binding, in a test or a probe), nothing is embedded and `.near` ranks over
// whatever is already stored. What the store lends is metered (meter.ts): a
// space whose budget is spent is refused, and its texts are `Withheld` until
// the month turns, which is no failure.

import configured from './embedding.json' with { type: 'json' }

import { configured as plugged, holding } from '@yaks/host/config'
import { lending } from '@yaks/host/lending'
import { type Embedder, space, Withheld } from '@yaks/embedding'
import { ModelError } from '@yaks/model'
import type { Taken } from '@yaks/host/words'
import { embedding } from './config.ts'
import { lenderFacets } from './load.ts'
import { LIMIT } from '@yaks/session/status'

/** The model every store's vectors are made by. Changing it, or cutting its
 * width, is a new vector space, and each store's sweep re-embeds its text
 * once, in slices behind its own traffic (graph.ts `#embedding`). */
export let MODEL = configured.model

/** The width Workers AI answers it at, every coordinate kept. */
export let DIM = configured.dimensions

/** How near in that space a recall keeps what it brings (@yaks/memory
 * `Floors`). Qwen3 puts texts lower than granite-embedding-30m-english, the
 * box's model, where @yaks/memory's own floors were measured: over 18 of
 * Jeff's messages against 300 of the box's memories, the pairs granite put at
 * .65 or nearer were as many as Qwen3 put at .50 or nearer, and granite's .72
 * matched Qwen3's .59. A paraphrase granite put at .73 Qwen3 put at .55 to .58,
 * and unrelated pairs at .35 to .41 (T-1674). */
export let FLOORS = configured.floors

/** That space, as the name each stored vector carries. */
export let SPACE = space({ model: MODEL })

/** The embedder a store runs, made by the provider embedding.json names
 * from what config.ts `embedding` lends over `bind`, its options read from it,
 * or none where nothing is lent. */
export let embedder = (bind: object): Embedder | null => {
  let taken: Taken<'graph'> = plugged(embedding, holding(bind)).map((
    [plugin, options],
  ) => [lenderFacets[plugin], options, plugin])
  let made = lending(taken, {}, 'embedders')?.[configured.provider]
  return made?.({ model: MODEL }) ?? null
}

/** A door the store lends an embedder, its spent budget said as the
 * embedder's `Withheld`. */
export let withheld = <A extends Runs>(door: A): A => ({
  ...door,
  run: (model: string, input: unknown, options?: unknown) =>
    door.run(model, input, options).catch((e) => {
      if (e instanceof ModelError && e.code == LIMIT) {
        throw new Withheld(e.message)
      }
      throw e
    }),
})
type Runs = {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>
}

export { ranking, texts } from './embedding-read.ts'
