import { space } from '@yaks/embedding'
import configured from './embedding.json' with { type: 'json' }

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
