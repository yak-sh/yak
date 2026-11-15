import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, graph, Refused } from '@yaks/graph'
import { kernelDoc } from '@yaks/kernel'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { connectionsDoc } from '@yaks/connections'
import { memberDoc } from '@yaks/member/vocab'
import { connectionAccess } from './connection-access.ts'

let vocab = loadVocab([kernelDoc, edgeDoc, connectionsDoc, memberDoc, {
  $defs: { fixture: { component: true, type: 'object', properties: {} } },
}], [
  edgeKeywords,
])
let setup = async (direct = false, owner = 'space') => {
  let g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [
      edges(vocab),
      connectionAccess((a) => a.by == 'agent' ? 'owner' : a.by ?? null),
    ],
  })
  let l = { ...link('app', 'uses', 'key'), uses: { binding: 'KEY', direct } }
  await g.apply([
    ...['space', 'owner', 'editor', 'app', 'other', 'agent'].map((eid) => ({
      entity: { eid },
      fixture: {},
    })),
    {
      entity: { eid: 'key' },
      connection: { owner, integration: 'key', status: 'connected' },
    },
    {
      entity: { eid: 'seat' },
      member: { space: 'space', person: 'owner', role: 'owner' },
    },
    l,
  ], { trusted: true })
  let apply = async (bundles: Bundle[], by = 'editor') =>
    await g.apply(bundles.map((b) => ({ ...b, $actor: { by } })), {
      trusted: true,
    })
  let change = (uses: Bundle['uses']) => [{ entity: l.entity, uses }]
  return { g, l, apply, change }
}

for (
  let [label, direct, patch] of [
    ['enable', false, { direct: true }],
    ['disable', true, { direct: false }],
    ['clear property', true, { direct: null }],
    ['drop component', true, null],
  ] as const
) {
  let s = await setup(direct)
  test(`an editor cannot ${label} a kept link’s direct mode`, async () => {
    await assertRejects(
      () => s.apply(s.change(patch)),
      Refused,
      'connection’s owner',
    )
    assertEquals((await s.g.read('.uses'))[0].uses, s.l.uses)
  })
}

let deletion = await setup(true)
test('an editor cannot clear direct mode by deleting the link', () =>
  assertRejects(
    () => deletion.apply([{ entity: deletion.l.entity, tombstone: {} }]),
    Refused,
  ))

let removed = await setup(true)
test('an editor cannot clear direct mode with the delete request', () =>
  assertRejects(
    () => removed.apply([{ entity: removed.l.entity, $delete: true }]),
    Refused,
  ))

let split = await setup()
test('a new direct link to a kept credential requires its owner even when split over bundles', () => {
  let l = link('other', 'uses', 'key')
  return assertRejects(() =>
    split.apply([
      { entity: l.entity, uses: { direct: true } },
      { entity: l.entity, edge: l.edge, uses: {} },
    ]), Refused)
})

let replacement = await setup()
test('removing and recreating a sentinel link cannot release its key', async () => {
  await replacement.apply([{ entity: replacement.l.entity, uses: null }])
  await assertRejects(
    () => replacement.apply(replacement.change({ direct: true })),
    Refused,
  )
})

let owner = await setup()
test('the vouched owner can enable and disable direct mode through an agent byline', async () => {
  await owner.apply(owner.change({ direct: true }), 'agent')
  assertEquals((await owner.g.read('.uses'))[0].uses, {
    binding: 'KEY',
    direct: true,
  })
  await owner.apply(owner.change({ direct: null }), 'owner')
  assertEquals((await owner.g.read('.uses'))[0].uses, { binding: 'KEY' })
})

let own = await setup(false, 'editor')
test('a person owns their own connection independently of their space role', async () => {
  await own.apply(own.change({ direct: true }))
  assertEquals((await own.g.read('.uses'))[0].uses, {
    binding: 'KEY',
    direct: true,
  })
})

let fresh = await setup()
test('an editor can request a new direct connection and rename a sentinel binding', async () => {
  await fresh.apply([
    {
      entity: { eid: 'new-key' },
      connection: { owner: 'space', integration: 'new', status: 'needed' },
    },
    {
      ...link('app', 'uses', 'new-key'),
      uses: { binding: 'NEW', direct: true },
    },
  ])
  await fresh.apply(fresh.change({ binding: 'RENAMED' }))
  assertEquals((await fresh.g.get([fresh.l.entity.eid]))[0].uses, {
    binding: 'RENAMED',
    direct: false,
  })
})
