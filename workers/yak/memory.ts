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
// How they are ranked. By meaning, in @yaks/memory's own recall: the directory
// keeps a vector beside every text it holds, a memory's sentence among them,
// and lends its host the ranking over them (graph.ts `meaning`, embedding.ts).
// A save writes the row and nothing else; the store makes the vector once the
// write has committed. Words no vector answers — a memory saved a moment ago, a
// directory with no model bound (`wrangler dev`, the workerd probes) — select
// through the store's own full-text index over `doc`, which is where a
// memory's sentence lives. Nothing breaks either way.
import { heard, LAST, line, passage } from '@yaks/memory'
import type { Bundle } from '@yaks/graph'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { listedIn } from './package-tools.ts'

/**
 * A space's memories as the passage every agent reads at connect (T-34474):
 * the newest, whole.
 *
 * The heading is named after whoever spoke most recently, off the byline the
 * store already answered with — a space is almost always one person, and the
 * entries name anybody else who spoke. So no name is looked up for this. The
 * tools it names are named as the connector lists them.
 */
export let told = async (env: Env, space: Space): Promise<string> => {
  // One more than the passage shows, so it knows there are more to say
  // without counting them.
  let held = (await meta(env).query(
    line({ space: space.eid, limit: LAST + 1 }),
  ) as Bundle[]).map(heard)
  return listedIn(
    passage({ name: held[0]?.by ?? '', space: space.slug }, held),
  )
}
