// Claim reconciliation accepts missing holders without weakening transcript
// reads, and keeps claims whose holder is live, hidden, or changed meanwhile.
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { kernelDoc } from '@yaks/kernel/vocab'
import { modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import { test } from '@yaks/testing'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { entryStatus } from './reach.ts'
import { running } from './run.ts'
import { statusComputed } from './state.ts'
import { UnknownSession } from './unknown.ts'

let vocab = loadVocab([kernelDoc, modelDoc, toolsDoc, sessionDoc])
let fixture = (rows: Bundle[], mask?: 'entity' | 'session') => {
  let storage = ram(vocab, { computed: statusComputed })
  storage.tx((tx) =>
    tx.patch([
      { entity: { eid: 'work' }, claim: { session: 'holder' } },
      ...rows,
    ])
  )
  let g = graph({
    vocab,
    storage,
    plugins: [
      sessions(),
      ...mask
        ? [{
          name: 'mask',
          scope: () =>
            mask == 'entity'
              ? { entity: '.entity.eid!=holder' }
              : { components: { session: '.entity.eid!=holder' } },
        }]
        : [],
    ],
  })
  return g
}
let release = (g: Graph) =>
  running(g, {
    holder: 'worker',
    model: () => Promise.reject(Error('release must not ask a model')),
    tools: [],
  }).session_release(
    { kind: 'created', name: 'claim', entity: { eid: 'work' } },
    g.outside,
    (b) => g.apply(b, { trusted: true }),
  )
let holder = async (g: Graph) =>
  (await g.outside.get(['work'], ['claim']))[0]?.claim
let stopped: Bundle[] = [
  { entity: { eid: 'holder' }, session: {} },
  { entity: { eid: 'end' }, entry: { session: 'holder', seq: 1 }, stop: {} },
]
let missing = fixture([])
let other = fixture([{ entity: { eid: 'holder' } }])
let active = fixture([
  { entity: { eid: 'holder' }, session: {} },
  {
    entity: { eid: 'input' },
    entry: { session: 'holder', seq: 1 },
    using: {},
    content: { body: 'work' },
  },
])
for (let [name, g] of [['missing', missing], ['non-session', other]] as const) {
  test(`claim release frees a ${name} holder`, async () => {
    await release(g)
    assertEquals(await holder(g), undefined)
  })
}
test('claim release leaves an active holder working', async () => {
  await release(active)
  assertEquals(await holder(active), { session: 'holder' })
})
for (let mask of ['entity', 'session'] as const) {
  let g = fixture(stopped, mask)
  test(`claim release does not mistake a hidden ${mask} for a missing holder`, async () => {
    await release(g)
    assertEquals(await holder(g), { session: 'holder' })
  })
}
let changed = fixture([{ entity: { eid: 'next' }, session: {} }])
let write = changed.apply.bind(changed)
changed.apply = async (bundles, opts) => {
  changed.storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'work' },
      claim: { session: 'next' },
    }])
  )
  return await write(bundles, opts)
}
test('claim release preserves a replacement holder after its read', async () => {
  await release(changed)
  assertEquals(
    (await changed.outside.read(
      '.entity.eid=work .claim.session=next .fields=entity.eid',
    )).length,
    1,
  )
})
let vanished = fixture(stopped)
let read = vanished.read.bind(vanished)
vanished.read = async (query, opts) => {
  // The status reader has accepted the root, then loses it before its chain.
  if (typeof query == 'string' && query.includes('&.session&.fields=')) {
    vanished.storage.tx((tx) =>
      tx.patch([
        { entity: { eid: 'holder' }, session: null },
      ])
    )
  }
  return await read(query, opts)
}
test('claim release reconciles a root removed during its status read', async () => {
  await release(vanished)
  assertEquals(await holder(vanished), undefined)
})
let ancestor = fixture([
  { entity: { eid: 'holder' }, session: {}, fork: { from: 'anchor' } },
  { entity: { eid: 'anchor' }, entry: { session: 'absent', seq: 1 } },
])
test('claim release still reports a missing transcript ancestor', async () => {
  await assertRejects(() => Promise.resolve(release(ancestor)), UnknownSession)
  assertEquals(await holder(ancestor), { session: 'holder' })
})
test('the transcript status API still refuses an unknown root', async () => {
  await assertRejects(() => entryStatus(missing, 'absent'), UnknownSession)
})
