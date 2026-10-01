/** Page-private vocabulary, not the host's ./vocab facet. */
import { docs as sharedDraftDocs } from '@yaks/draft'
import type { VocabDoc } from '@yaks/vocab'
import doc from './front.json' with { type: 'json' }

export let frontDoc = doc as unknown as VocabDoc
export let docs: VocabDoc[] = [frontDoc]

/** Reuse the draft contract, changing only this local graph's lifetimes.
 * No duplicate component declaration and no host vocabulary override. */
export let draftDocs: VocabDoc[] = sharedDraftDocs.map((source) => ({
  ...source,
  $defs: Object.fromEntries(Object.entries(source.$defs ?? {}).map(
    ([name, schema]) => [name, {
      ...schema, sync: 'none',
      durable: name == 'typed' ? '0s' : 'connection',
    }],
  )),
}))
