// One live document demonstrates the Entity door. Changing the bundle notifies
// its subscribers; the mounted renderer reads the replacement from the store.

import { h, render } from 'preact'
import { entity } from '@yaks/preact'
import { type Bundle, define } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab([{
  $defs: {
    doc: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
  },
}])
let registry = define([{
  view: 'Tile',
  match: parse('.doc'),
  render: (bundle, h) => {
    let doc = bundle.doc as { title: string; body: string }
    return h('article', null, h('h1', null, doc.title), h('p', null, doc.body))
  },
}])
let bundle: Bundle = {
  entity: { eid: 'page' },
  doc: { title: 'yaks.app', body: 'A document, ready to change.' },
}
let listeners = new Set<() => void>()
let Entity = entity({
  registry,
  vocab,
  store: (eid) => eid == bundle.entity.eid ? bundle : undefined,
  subscribe: (_eid, notify) => {
    listeners.add(notify)
    return () => {
      listeners.delete(notify)
    }
  },
})
let updates = 0
let update = () => {
  bundle = {
    ...bundle,
    doc: {
      title: 'yaks.app',
      body: `This document has changed ${++updates} time${
        updates == 1 ? '' : 's'
      }.`,
    },
  }
  for (let notify of listeners) notify()
}

render(
  h(
    'section',
    null,
    h(Entity, { eid: 'page', view: 'Tile' }),
    h('button', { type: 'button', onClick: update }, 'Change the document'),
  ),
  document.querySelector('main')!,
)
