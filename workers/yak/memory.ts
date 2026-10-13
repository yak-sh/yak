// The space memories handed to an agent at connect. The directory composes
// @yaks/memory, and published.ts translates the connector's former tools.
//
// Where. In the directory — the platform's own store (door.ts
// PLATFORM_STORE), which is the one store a SPACE has. A memory is not an
// app's: the person said it about how they want things built, and it holds
// whether they are looking at the recipe app, the chores app or neither, so it
// belongs to the space every one of those apps is in. Every member of that
// space reads them; a writer writes them, the same seat every other write here
// takes.
//
// How they are ranked. By meaning: the directory keeps a vector beside every
// text it holds, a memory's sentence among them, and ranks words against the
// space's memories with an exact scan over its own vectors (embedding.ts,
// graph.ts `/meaning`). A save writes the row and nothing else; the store makes
// the vector once the write has committed. Words no vector answers — a memory
// saved a moment ago, a directory with no model bound (`wrangler dev`, the
// workerd probes) — rank themselves through the store's own full-text index
// over `doc`, which is where a memory's sentence lives. Nothing breaks either
// way.
import {
  heard,
  LAST,
  line,
  type Memory,
  ordered,
  passage,
  type Ranker,
} from '@yaks/memory'
import type { Bundle } from '@yaks/graph'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { caught } from './defects.ts'
import { listedIn } from './package-tools.ts'

/**
 * Ranking by meaning: the directory's vectors of the space's own memories,
 * nearest first. A directory that cannot answer — no model bound, an outage —
 * is a worse order, never a failed recall: it answers nothing, and the caller
 * ranks by the words instead.
 */
export let ranker = (env: Env): Ranker => async (words, scope) => {
  try {
    let hits = await meta(env).meaning(words, {
      within: line({ space: scope.space, limit: scope.limit }),
      limit: scope.limit,
    })
    return hits.map((h) => h.entity)
  } catch (e) {
    caught(e, { request: 'memory recall', space: scope.space })
    return []
  }
}

/** The memories a filter line answered, as memories. */
let read = async (env: Env, q: string): Promise<Memory[]> =>
  (await meta(env).query(q) as Bundle[]).map(heard)

/**
 * A space's memories, closest first where words were asked about and newest
 * first where they were not. The ranker answers ids; the store answers the
 * memories themselves, so a rank never decides what a caller may read — the
 * space on the line does.
 *
 * Words that find nothing answer the newest rather than nothing at all. The
 * fallback is a full-text index, which matches the phrase and not the meaning
 * of it, so "how should the pages look" over a store that holds "keep it soft,
 * not technical" matches no word — and an agent told nothing has been kept
 * goes on to build against preferences that are sitting right there.
 */
export let memories = async (
  env: Env,
  space: Space,
  ask: { said?: string; limit?: number } = {},
): Promise<Memory[]> => {
  let limit = ask.limit ?? LAST
  let said = (ask.said ?? '').trim()
  if (said) {
    let ids = await ranker(env)(said, { space: space.eid, limit })
    let held = ids.length
      ? ordered(
        ids,
        await read(env, line({ space: space.eid, limit, eids: ids })),
      )
      : []
    if (held.length) return held
    let hits = await read(env, line({ space: space.eid, limit, said }))
    if (hits.length) return hits
  }
  return await read(env, line({ space: space.eid, limit }))
}

/**
 * A space's memories as the passage every agent reads at connect (T-34474).
 *
 * The heading is named after whoever spoke most recently, off the byline the
 * store already answered with — a space is almost always one person, and the
 * entries name anybody else who spoke. So no name is looked up for this. The
 * tools it names are named as the connector lists them.
 */
export let told = async (env: Env, space: Space): Promise<string> => {
  // One more than the passage shows, so it knows there are more to say
  // without counting them.
  let held = await memories(env, space, { limit: LAST + 1 })
  return listedIn(
    passage({ name: held[0]?.by ?? '', space: space.slug }, held),
  )
}
