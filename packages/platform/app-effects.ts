// The `yak/app` effects facet: what it runs on any host, a store's builders
// kept with their provenance once a release brings them. The rest of what
// yak/app declares (a document's text, a hearing, an upload's bytes, a death
// told to the space, a sale refunded, a notice posted) is Cloudflare work, so
// yaks.app's own facet runs those beside these (workers/yak
// facets/app-effects.ts) and a host without it owes them no run.
import type { Bundle } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import type { Host } from '@yaks/host'
import { preserve } from '@yaks/builders'
import { maintenance, type Options } from './lent.ts'

export let effects = (host: Host, { store }: Options): Handlers => ({
  builder_install: maintenance(async () => {
    let graph = store.graph ?? host.graph
    if (!graph.vocab.comp('builder')) return
    let writes: Bundle[] = []
    for (let builder of await graph.read('.builder&*')) {
      writes.push(
        ...await graph.storage.tx((tx) => preserve(tx, builder, graph.vocab)),
      )
    }
    if (writes.length) await graph.apply(writes, { trusted: true })
  }),
})
