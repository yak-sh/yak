// Builders in an app's store. @yaks/builders opens a session and turns its
// answer into output rows; the store's existing session runner asks the model
// through the account's metered Workers AI binding (models.ts).
import { watches } from '@yaks/builders/effects'
import { modelTool } from '@yaks/builders/model'
import { toolRow } from '@yaks/tools'
import type { Plugin } from './plugin.ts'

export let builderModelTool = modelTool()

export let buildersPlugin: Plugin = {
  name: 'builders',
  installs: [async (read, at) => {
    if (at.meta || !at.app) return []
    let row = toolRow(builderModelTool)
    let [have] = await read(`.eid=${row.entity.eid}&*`)
    return JSON.stringify(have?.tool ?? null) == JSON.stringify(row.tool)
      ? []
      : [row]
  }],
  effects: [(on, at) => {
    if (at.meta || !at.app) return
    on.handle(watches({ vocab: at.graph.vocab }))
  }],
}
