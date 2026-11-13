// The vocabulary facets a config's plugins name, out of a generated loader's
// `vocabFacets` (load.ts, operator-load.ts): what a store's words are composed
// from before any of its graph facets loads.
import { chosen, type Config, facetsOf, given, used } from '@yaks/host/config'
import type { VocabFacet } from '@yaks/host'
import type { Taken } from '@yaks/host/words'

export let vocabsOf = (
  config: Config,
  vocabFacets: Record<string, VocabFacet>,
): Taken<'vocab'> =>
  (config.plugins ?? []).flatMap((plug): Taken<'vocab'> => {
    // A plugin that declares no words (yak/pages, which only purges).
    if (facetsOf(plug)?.includes('vocab') === false) return []
    let plugin = used(plug), facet = vocabFacets[plugin]
    if (!facet) throw new Error(`no vocabulary facet for ${plugin}`)
    return [[facet, given(plug), plugin, chosen(plug), facetsOf(plug)]]
  })
