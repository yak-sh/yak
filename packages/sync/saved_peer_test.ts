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
      save: '!position | .updated.at<="30s ago"',
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

let initial = fresh()
let replaced = fresh()
await snapshot(replaced, [row(1)])
await replaced.apply([{
  ...row(2),
  position: { x: 2, y: 3 },
  cursor: { x: 4 },
}])
let cleared = fresh()
await snapshot(cleared, [row(1)])
await cleared.apply([{ ...row(2), position: { x: 2, y: 3 }, cursor: { x: 4 } }])
await snapshot(cleared, [row(5)])

test('a saved peer snapshot initializes a fresh graph', async () => {
  await snapshot(initial, [row(1)])
  assertEquals((await initial.get(['a']))[0].position, { x: 1 })
})

test('a saved peer snapshot replaces absent saved fields and keeps unsaved peers', async () => {
  await snapshot(replaced, [row(5)])
  let [held] = await replaced.get(['a'])
  assertEquals(held.position, { x: 5, y: null })
  assertEquals(held.cursor, { x: 4 })
})

test('a saved peer snapshot clears a saved component absent from the snapshot', async () => {
  await snapshot(cleared, [{ entity: { eid: 'a' }, avatar: {} }])
  assertEquals((await cleared.get(['a']))[0].position, undefined)
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
