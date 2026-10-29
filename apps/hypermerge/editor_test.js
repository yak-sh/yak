// Two actors edit one doc through a store that is only a list of rows: each
// signs its blocks into its own feed, each trusts only what verifies, and
// their concurrent edits merge.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import Automerge from 'automerge'
import { checked } from './check.js'
import { editor } from './editor.js'
import { lanes } from './feed.js'
import { mint, sign } from './keys.js'
import { at } from './time.js'
import { bytes, sha256 } from './pack.js'
import { indexed, leaf, nodes, treeHash } from './tree.js'

let rows = []
let publish = (out) => (rows.push(...out), Promise.resolve())
let [root, other] = await Promise.all([mint(), mint()])
let doc = root.id
let trust = () => Promise.all(lanes(doc, rows).map((l) => checked(doc, l)))
let trusted = async () => (await trust()).flatMap((c) => c.trusted)

let a = editor(doc, root, publish), b = editor(doc, other, publish)
a.change('new doc', (d) => {
  d.title = 'Untitled'
  d.body = new Automerge.Text()
  d.body.insertAt(0, ...'hello')
})
await a.sent()
b.receive(await trusted())
a.change('a', (d) => d.body.insertAt(0, ...'> '))
b.change('b', (d) => d.body.insertAt(5, ...' world'))
await Promise.all([a.sent(), b.sent()])
let all = await trusted()
a.receive(all)
b.receive(all)

test('concurrent edits from two feeds merge alike', () => {
  assertEquals(a.state.body.join(''), '> hello world')
  assertEquals(b.state.body.join(''), '> hello world')
})

test('each feed is a signed run of its actor’s changes', async () => {
  let [r, o] = await trust()
  assertEquals(r.trusted.map((x) => x.change.seq), [1, 2])
  assertEquals(o.trusted.map((x) => x.change.deps), [{ [doc]: 1 }])
  assertEquals([...r.status.values(), ...o.status.values()], [
    'ok',
    'ok',
    'ok',
  ])
})

test('a block signed by another key is not trusted', async () => {
  // Another actor appends to the root's feed: the block's place, content and
  // eid are right, and only the key that signed the tree is wrong.
  let change = { actor: doc, seq: 3, deps: {}, message: 'x', ops: [] }
  let data = bytes(change)
  let before = rows.filter((r) => r.block.actor == doc)
    .map((r) => leaf(bytes(r.block.change)))
  let tree = treeHash(indexed(nodes([...before, leaf(data)])), 3)
  let forged = {
    entity: { eid: await sha256(data) },
    block: { doc, actor: doc, index: 2, change, sig: await sign(other, tree) },
  }
  let c = await checked(doc, lanes(doc, [...rows, forged])[0])
  assertEquals(c.trusted.length, 2)
  assertEquals(c.status.get(forged.entity.eid), 'unsigned')
})

test('an edit made rewound forks onto a writer that saw only that much', async () => {
  // Rewound to the root's first block, a new writer edits; its change depends
  // on that block alone, and at the present it merges with all that followed.
  let out = [], keep = (r) => (out.push(...r), Promise.resolve())
  let f = editor(doc, await mint(), keep)
  f.receive(at(await trusted(), 1).applied)
  f.change('fork', (d) => d.body.insertAt(5, ...'?'))
  await f.sent()
  assertEquals(out[0].block.change.deps, { [doc]: 1 })
  f.receive(await trusted())
  a.receive(out.map((r) => ({ ...r.block, eid: r.entity.eid })))
  assertEquals(f.state.body.join(''), a.state.body.join(''))
  assertEquals(a.state.body.join('').replace('?', ''), '> hello world')
})
