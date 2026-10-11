// Keep builder provenance and its model command ready when a release arrives.
import { preserve } from '@yaks/builders'
import type { Bundle } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import { toolRow } from '@yaks/tools'
import { builderModelTool } from '../builders.ts'
import type { Options } from './store.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  return {
    builder_install: async () => {
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
      if (!at.meta && at.app) {
        let row = toolRow(builderModelTool)
        let [have] = await at.graph.get([row.entity.eid], ['tool'])
        if (JSON.stringify(have?.tool ?? null) != JSON.stringify(row.tool)) {
          writes.push(row)
        }
      }
      if (writes.length) await at.graph.apply(writes, { trusted: true })
    },
  }
}
