// Whose each entity of the Operator's store is, kept by its rule
// (@yaks/platform/operator-owner): through creation and every change along the paths an
// owner is named on, the kept owner admits for each person what the paths
// themselves admit, and a person's whole `.session` read answers under
// workerd's SQLite.
import { line, sub } from '@yaks/query'
import { equal, test } from '@yaks/testing'
import { type Bundle, signed } from '@yaks/graph'
import { operatorMemory } from './operator-testing.ts'
import { operatorStore } from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { seenBy } from './operator-access.ts'
import { OWNERS } from '@yaks/platform/operator-owner'
import {
  MEMORY_OWNERS,
  memoryOwnerBackfill,
} from '@yaks/platform/operator-memory'
import { ownerBackfill } from './owner-move.ts'
import { inputOf } from '@yaks/session/intake'

let [space, ada, bea] = Array.from({ length: 3 }, () => crypto.randomUUID())
let id = () => crypto.randomUUID()
let store = operatorMemory()
let write = (bundles: Bundle[]) => store.g.apply(bundles, { trusted: true })
// Whose each entity is kept as: a person, `nobody` for an owner with none,
// or nothing.
let owners = async (...eids: string[]) =>
  (await store.g.get(eids, ['owner'])).map((b) =>
    b.owner ? (b.owner as { person?: string }).person ?? 'nobody' : undefined
  )
let legacyOwners = {
  get: (mark: string) => mark == MEMORY_OWNERS ? 'done' : undefined,
}
// What each person reads by the kept owners, beside what the paths admit.
let agree = async (g = store.g) => {
  for (let person of [ada, bea, id()]) {
    for (let member of [true, false]) {
      let read = async (paths: boolean) =>
        (await seenBy(
          paths ? { g, marks: legacyOwners } : { g },
          { person, member },
        ).read('.entity&.fields=entity.eid')).map((b) => b.entity.eid).sort()
      equal(await read(false), await read(true))
    }
  }
}
let session = (person: string, eid = id()): Bundle => ({
  entity: { eid },
  session: {},
  operator_session: { space, person },
})

let root = id(), helper = id(), said = id(), aside = id()
await write([
  session(ada, root),
  { entity: { eid: helper }, session: {}, spawned: { parent: root } },
  { entity: { eid: said }, entry: { session: root }, content: { body: 'hi' } },
  {
    entity: { eid: aside },
    entry: { session: helper },
    content: { body: 'so' },
  },
])

test('what hangs on a conversation is its person’s from the commit that makes it', async () => {
  let request = id(), files = id(), shared = id()
  await write([
    { entity: { eid: request }, operator_request: { person: ada, space } },
    {
      entity: { eid: files },
      entry: { session: helper },
      operator_files: { request, files: [] },
    },
    { entity: { eid: shared }, memory: {}, doc: { title: 'nobody’s' } },
  ])
  equal(await owners(root, helper, said, aside, request, files, shared), [
    ada,
    ada,
    ada,
    ada,
    ada,
    ada,
    undefined,
  ])
  await agree()
})

test('what nobody owns is a member’s to read, and nobody else’s', async () => {
  let shared = id()
  await write([{ entity: { eid: shared }, memory: {}, doc: { title: 'n' } }])
  let reads = async (member: boolean, paths: boolean) =>
    (await seenBy(
      paths ? { g: store.g, marks: legacyOwners } : store,
      { person: ada, member },
    ).get([root, said, shared])).length
  equal(
    await Promise.all(
      [true, false].flatMap((m) => [reads(m, false), reads(m, true)]),
    ),
    [3, 3, 2, 2],
  )
})

test('an item a person’s words came in is theirs once their session takes it', async () => {
  let letter = id(), text = id()
  let item = (eid: string) => ({
    entity: { eid },
    mail: { from: 'ada@example.com' },
    doc: { title: 'Hi', body: 'hi' },
  })
  let taking = (eid: string) => ({
    entity: { eid: inputOf(eid) },
    entry: { session: root },
    intake: { item: eid },
    content: { body: 'hi' },
  })
  await write([item(letter)])
  equal(await owners(letter), [undefined])
  await write([taking(letter)])
  await write([item(text), taking(text)])
  equal(await owners(letter, text), [ada, ada])
  // An id that derives no input naming it is nobody’s.
  let named = id()
  await write([item(named), {
    ...taking(named),
    intake: { item: letter },
  }])
  equal(await owners(named), [undefined])
})

test('a call is also the person’s whose conversation made it', async () => {
  let call = id()
  await store.g.apply(
    signed([{ entity: { eid: call }, call: { name: 'graph_query' } }], {
      by: ada,
      via: root,
    }),
    { trusted: true },
  )
  equal(await owners(call), [ada])
  await agree()
})

test('a conversation carried on by another person takes what hangs on it along', async () => {
  let s = id(), h = id(), e = id(), he = id()
  await write([
    session(ada, s),
    { entity: { eid: h }, session: {}, spawned: { parent: s } },
    { entity: { eid: e }, entry: { session: s } },
    { entity: { eid: he }, entry: { session: h } },
  ])
  await write([{ entity: { eid: s }, operator_session: { person: bea } }])
  equal(await owners(s, h, e, he), [bea, bea, bea, bea])
  await agree()
})

test('a helper given another parent, and one named by two people, follow', async () => {
  let h = id(), e = id(), other = id()
  await write([
    session(bea, other),
    { entity: { eid: h }, session: {}, spawned: { parent: root } },
    { entity: { eid: e }, entry: { session: h } },
  ])
  await write([{ entity: { eid: h }, spawned: { parent: other } }])
  equal(await owners(h, e), [bea, bea])
  await write([{
    entity: { eid: h },
    operator_session: { space, person: ada },
  }])
  equal(await owners(h, e), ['nobody', 'nobody'])
  await agree()
})

test('what hung on a deleted conversation is nobody’s, as its paths say', async () => {
  let s = id(), e = id()
  await write([session(ada, s), { entity: { eid: e }, entry: { session: s } }])
  await write([{ entity: { eid: s }, $delete: true }])
  equal(await owners(e), [undefined])
  await agree()
})

test('a snapshot kept for a public reader is nobody’s to read', async () => {
  let e = id()
  await write([{
    entity: { eid: e },
    context_output: { source: said, reader: 'public:' + id(), body: '1' },
  }])
  equal(await owners(e), ['nobody'])
  await agree()
})

test('an owner written by anyone but the rule is put back', async () => {
  await store.g.apply([{ entity: { eid: said }, owner: { person: bea } }], {
    trusted: true,
  })
  equal(await owners(said), [ada])
})

test('a store kept before its owners is read by the paths until its pass is done', async () => {
  let kept = new Map<string, string>()
  let marks = {
    get: (k: string) => kept.get(k),
    set: (k: string, v: string) => void kept.set(k, v),
  }
  let old = operatorMemory()
  // Rows as a store held them before the rule: no owner written.
  let e = id()
  await old.g.apply([
    session(ada, root),
    { entity: { eid: e }, entry: { session: root } },
  ], { trusted: true })
  await old.g.apply([{ entity: { eid: e }, owner: null }, {
    entity: { eid: root },
    owner: null,
  }], { trusted: true, stamp: false })
  let hidden = async () =>
    (await seenBy({ g: old.g, marks }, { person: bea, member: true }).read(
      '.entry',
    )).length
  // Unwritten owners are no reason to show bea ada's words.
  equal(await hidden(), 0)
  while (await ownerBackfill({ g: old.g, marks })) { /* the next batch */ }
  equal(kept.get(OWNERS), 'done')
  equal(await hidden(), 0)
  await agree(old.g)
})

test('a person reads every session of the Operator’s store under workerd’s SQLite', async () => {
  let at = await operatorStore(durable())
  await at.g.apply([
    session(ada, root),
    session(bea, helper),
    { entity: { eid: said }, entry: { session: root }, content: { body: 'a' } },
    {
      entity: { eid: aside },
      entry: { session: helper },
      content: { body: 'b' },
    },
  ], { trusted: true })
  for (let q of [line`.session`, line`.entity`]) {
    let read = await seenBy(at, { person: ada, member: true }).read(
      line`${sub(q)}&.fields=entity.eid`,
    )
    equal(read.some((b) => b.entity.eid == root), true)
    equal(read.some((b) => b.entity.eid == helper), false)
  }
  equal(
    (await seenBy(at, { person: ada, member: true }).read('.session')).length,
    1,
  )
})

test('legacy memories with a saving conversation become private and untraceable ones stay shared', async () => {
  let at = await operatorStore(durable())
  let root = id(), fork = id(), kept = id(), shared = id(), unsupported = id()
  await at.g.apply([
    session(ada, root),
    { entity: { eid: fork }, session: {}, spawned: { parent: root } },
    {
      entity: { eid: kept },
      doc: { body: 'private words' },
      memory: { via: fork },
    },
    {
      entity: { eid: shared },
      doc: { body: 'shared words' },
      memory: { via: root },
      operator_memory: {},
    },
    {
      entity: { eid: unsupported },
      doc: { body: 'unknown source' },
      memory: {},
    },
  ], { trusted: true })
  at.marks!.del(MEMORY_OWNERS)
  let reads = async (person: string) =>
    (await seenBy(at, { person, member: true }).read(
      '.memory&.fields=entity.eid',
    ))
      .map((b) => b.entity.eid).sort()
  equal(await reads(bea), [shared])
  equal(await memoryOwnerBackfill(at), false)
  equal(await reads(bea), [shared, unsupported].sort())
  equal(await reads(ada), [kept, shared, unsupported].sort())
  let [row] = await at.g.get([kept])
  equal(row.doc, { body: 'private words' })
  equal(row.owner, { person: ada })
  at.marks!.del(MEMORY_OWNERS)
  equal(await memoryOwnerBackfill(at), false)
  equal(await at.g.get([kept]), [row])
})
