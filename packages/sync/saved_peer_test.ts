/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { land, marks, snapshot } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    avatar: { component: true },
    position: {
      component: true,
      sync: 'peers',
      durable: 'forever',
      save: '30s',
      pace: '100ms',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    cursor: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      properties: { x: { type: 'number' } },
    },
  },
})
let fresh = () =>
  graph({ vocab, storage: ram(vocab, { adopt: true }), plugins: [marks] })
let row = (x: number): Bundle => ({
  entity: { eid: 'a' },
  avatar: {},
  position: { x },
})

test('a saved peer snapshot initializes a fresh graph and replaces absent saved fields', async () => {
  let g = fresh()
  await snapshot(g, [row(1)])
  assertEquals((await g.get(['a']))[0].position, { x: 1 })
  await g.apply([{ ...row(2), position: { x: 2, y: 3 }, cursor: { x: 4 } }])
  await snapshot(g, [row(5)])
  let [held] = await g.get(['a'])
  assertEquals(held.position, { x: 5, y: null })
  assertEquals(held.cursor, { x: 4 })
  await snapshot(g, [{ entity: { eid: 'a' }, avatar: {} }])
  assertEquals((await g.get(['a']))[0].position, undefined)
})

test('a reset keeps its saved peer position, clears absent unsaved peers, and takes a newer relay', async () => {
  let g = fresh()
  await g.apply([{ ...row(1), cursor: { x: 4 } }])
  await land(g, { id: 'watch', reset: true, bundles: [row(2)] })
  let [held] = await g.get(['a'])
  assertEquals(held.position, { x: 2 })
  assertEquals(held.cursor, undefined)
  await land(g, {
    id: 'watch',
    reset: true,
    bundles: [row(2)],
    relay: [{ entity: { eid: 'a' }, position: { x: 3 } }],
  })
  assertEquals((await g.get(['a']))[0].position, { x: 3 })
})

test('a writer keeps its latest movement against older saved snapshots and raw feeds', async () => {
  let g = fresh()
  await g.apply([row(9)])
  let mine = (eid: string, comp: string) => eid == 'a' && comp == 'position'
  for (let bundles of [[row(1)], [{ entity: { eid: 'a' }, avatar: {} }]]) {
    await snapshot(g, bundles, { mine })
    assertEquals((await g.get(['a']))[0].position, { x: 9 })
    await land(g, { id: 'raw', reset: true, bundles }, mine)
    assertEquals((await g.get(['a']))[0].position, { x: 9 })
  }
})
