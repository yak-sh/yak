// Keep builder provenance when a release arrives.
import { preserve } from '@yaks/builders'
import type { Bundle } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { maintenance } from '../used.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  return {
    builder_install: maintenance(async () => {
      let writes: Bundle[] = []
      if (at.graph.vocab.comp('builder')) {
        for (let builder of await at.graph.read('.builder&*')) {
          writes.push(
            ...await at.graph.storage.tx((tx) =>
              preserve(tx, builder, at.graph.vocab)
            ),
          )
        }
      }
      if (writes.length) await at.graph.apply(writes, { trusted: true })
    }),
  }
}
