// What a host lends an app store's own graph facets: the work a committed
// write owes where the store runs. yaks.app's Store lends its own (workers/yak
// graph.ts `Stored`); another host lends what it has.
import type { Bundle, Plugin } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'

export type Lent = {
  /** the store's name: an app's address, or the platform's own store */
  name: string
  /** what an app holds, told to whoever meters it once a write has committed */
  weigh: (bundles: Bundle[]) => Bundle[]
  /** the sleeping wakes a committed write makes hold, roused */
  rouse: (bundles: Bundle[]) => Promise<Bundle[]>
  /** the texts a committed write changed, embedded */
  embed: (bundles: Bundle[]) => Bundle[]
  /** the words a committed write brought, told to the Lexicon, in a store
   * that keeps one */
  tell?: (bundles: Bundle[]) => Bundle[]
  /** the write log's hook, which keeps a keyed write's answer as it commits */
  log: Plugin
  /** the app's manifest, its `vocab.json`, as deployed now */
  manifest: () => VocabDoc
}

/** The options each of these facets is bound with. */
export type Options = { store: Lent }
