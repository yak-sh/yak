// Builders in an app's store. @yaks/builders opens a session and turns its
// answer into output rows; the store's existing session runner asks the model
// through the account's metered Workers AI binding (models.ts).
import { watches } from '@yaks/builders/effects'
import type { Plugin } from './plugin.ts'
import { CATALOGUE } from './models.ts'

let model = CATALOGUE.find((r) => r.offered && r.output > 0)
if (!model) throw new Error('no text model is offered for builders')
let desk = { model: model.name }

export let buildersPlugin: Plugin = {
  name: 'builders',
  effects: [(on, at) => {
    if (at.meta || !at.app) return
    on.handle(watches({ desk, vocab: at.graph.vocab }))
  }],
}
