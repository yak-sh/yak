// A server's vocabulary drawn with this machine's copies of its packages'
// views: the one place a remote answer meets the plugin loader.
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab/runtime'
import { understood } from '@yaks/host/keywords'
import type { Registry } from '@yaks/render'
import { type Held, registry, type ViewFacet, type Views } from './answer.ts'
import { subpath, subpaths } from './config.ts'

// A package a server named that this machine has no copy of: its plugins are
// its own, so an answer is drawn with the views that are here.
let elsewhere = (error: unknown): boolean =>
  error instanceof TypeError && error.message.includes('not a dependency')

/** A vocabulary a server reported (`graph_schema`), read the way a host reads
 * its own — with the keywords every host understands — and the views of the
 * packages it says declared its components, where this machine has them. */
export let reported = async (
  doc: VocabDoc,
): Promise<
  { views: Registry; vocab: Vocab; components: () => Promise<Held> }
> => {
  let vocab = loadVocab([doc], understood())
  let plugins = vocab.all.flatMap((n) => vocab.comp(n)?.package ?? [])
  let named = [...new Set(plugins)]
  await subpaths(named.map((p) => [p, 'views'] as const)).catch((error) =>
    elsewhere(error) ? null : Promise.reject(error)
  )
  let load: Views = (plugin) =>
    subpath<ViewFacet>(plugin, 'views').catch((error) =>
      elsewhere(error) ? null : Promise.reject(error)
    )
  let views = await registry(named, load)
  return {
    views,
    vocab,
    components: () => registry(named, load, undefined, true),
  }
}
