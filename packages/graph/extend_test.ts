import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import type { Plugin } from './plugin.ts'

let doc: VocabDoc = {
  $defs: {
    note: { component: true, properties: { title: { type: 'string' } } },
    observed: { component: true },
    observe: { rule: true, match: '.note, +!observed' },
  },
}
let initial = loadVocab(doc)
let next = loadVocab(JSON.parse(JSON.stringify([doc, {
  $defs: {
    entry: { component: true, properties: { value: { type: 'string' } } },
    keyed: {
      component: true,
      properties: { key: { type: 'string', identity: true } },
    },
    seen: { component: true },
    marked: {
      component: true,
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    notice: { rule: true, match: '.entry, +!seen' },
  },
}])))
let storage = ram(initial)
storage.tx((tx) =>
  tx.patch([{ entity: { eid: 'owner' }, note: { title: 'Owner' } }])
)
let heard = initial
let plugin: Plugin = {
  name: 'reader',
  vocab: [doc],
  answer: (ctx, bs: Bundle[]) => {
    heard = ctx.vocab ?? initial
    return bs
  },
}
let g = graph({
  vocab: initial,
  storage,
  plugins: [plugin],
  actor: { by: 'owner' },
})
g.apply([{ entity: { eid: 'kept' }, note: { title: 'Draft' } }])
let kept = storage.get(['kept'])[0]
let read = g.read
read('.note')
let grew = g.extend(next)
let retained = storage.get(['kept'])[0] === kept
g.apply([{ entity: { eid: 'new' }, entry: { value: 'Added' }, marked: {} }], {
  now: '2026-11-04T12:00:00.000Z',
})
let created = await g.apply([{
  entity: { eid: '$keyed' },
  keyed: { key: 'same' },
}])
let repeated = await g.apply([{
  entity: { eid: '$again' },
  keyed: { key: 'same' },
}])
g.apply([{ entity: { eid: 'after' }, note: { title: 'After' } }])

test('a graph grows in place without replacing its rows or plugins', () => {
  equal(grew, true)
  equal(g.vocab === next, true)
  equal(initial.comp('entry'), undefined)
  equal(g.storage === storage, true)
  equal(g.plugins[0] === plugin, true)
  equal(retained, true)
})

test('saved read methods and read plugins use the new vocabulary', async () => {
  equal((await read('.entry'))[0].entry, { value: 'Added' })
  equal(heard === next, true)
})

test('growth activates newly declared rules and stamps', () => {
  equal(g.get(['new']), [{
    entity: { eid: 'new' },
    entry: { value: 'Added' },
    seen: {},
    marked: { at: '2026-11-04T12:00:00.000Z', by: 'owner' },
  }])
})

test('growth admits and derives identities of new components', () => {
  equal(created[0].entity.eid, repeated[0].entity.eid)
  equal(storage.read('.keyed').length, 1)
})

test('reparsed vocabulary documents keep existing plugin declarations from running twice', () => {
  equal(storage.get(['after'])[0].observed, {})
})

let rejecting = ram(initial)
let failed = graph({ vocab: initial, storage: rejecting })
let missing = graph({
  vocab: initial,
  storage: { ...ram(initial), extend: undefined },
})
let refusing = graph({
  vocab: initial,
  storage: { ...ram(initial), extend: () => false },
})
let incompatible = loadVocab({
  $defs: {
    note: {
      component: true,
      sync: 'none',
      properties: { title: { type: 'string' } },
    },
  },
})

test('incompatible or unsupported growth leaves the graph and its storage unchanged', () => {
  for (let one of [failed, missing, refusing]) {
    equal(one.extend(one === failed ? incompatible : next), false)
    equal(one.vocab === initial, true)
    assertThrows(() =>
      one.apply([{ entity: { eid: 'unknown' }, entry: { value: 'No' } }])
    )
    equal(one.read('.note'), [])
  }
  equal(rejecting.worn('entry', 'value'), false)
})
