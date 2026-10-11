// An alias is a key entity of its own: find() and aliasNames() read the name
// off it and land on the entity it points at.
import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import { aliasNames, find, type Row, subChanges } from './client.ts'
import { bundlesOf } from './wire.ts'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { notifyDoc } from '@yaks/notify'
import { subsOf } from '@yaks/inbox'

let row = (eid: string, comps: Row['comps'], num = 0): Row => ({
  eid,
  num,
  kind: '',
  comps,
})
let all = [
  row('t', { task: {}, doc: { title: 'Scribe desk' } }, 7),
  row('k', { key: { of: 't', value: 'scribe-desk' }, alias: {} }),
  // a key of another kind is not a name
  row('x', { key: { of: 't', value: 'not-a-name' } }),
]

test('an alias names the entity its key points at', () => {
  assertEquals(find(all, 'scribe-desk')?.eid, 't')
  assertEquals(find(all, 'T-7')?.eid, 't')
  assertEquals(find(all, 'not-a-name'), undefined)
  assertEquals(find(all.slice(1), 'scribe-desk'), undefined) // target unloaded
  assertEquals(aliasNames(all), new Map([['t', 'scribe-desk']]))
})

// The subscription lives beyond its watch/mute mode: it also keeps attention.
let subscription = await (async () => {
  let v = loadVocab([kernelDoc, docDoc, notifyDoc])
  let storage = ram(v)
  await storage.tx((tx) =>
    tx.patch([
      { entity: { eid: 'actor' }, doc: {} },
      { entity: { eid: 'target' }, doc: {} },
      {
        entity: { eid: 'attention' },
        subscription: { actor: 'actor', target: 'target', mode: 'watch' },
        opened: { at: '2026-10-01T00:00:00Z' },
        archived: { at: '2026-10-02T00:00:00Z' },
      },
    ])
  )
  let g = graph({ vocab: v, storage })
  let [before] = await g.get(['attention'])
  await g.apply(bundlesOf(subChanges(
    [
      row('attention', before as Row['comps']),
    ],
    'actor',
    'target',
    null,
  )))
  let [after] = await g.get(['attention'])
  return {
    before,
    after,
    reader: subsOf(
      [{ eid: 'attention', comps: after as Row['comps'] }],
      'actor',
    ),
  }
})()

test('clearing a watch keeps personal archive and opening without watching or muting', () => {
  assertEquals(subscription.after.opened, subscription.before.opened)
  assertEquals(subscription.after.archived, subscription.before.archived)
  assertEquals([...subscription.reader.watching], [])
  assertEquals([...subscription.reader.muting], [])
})
