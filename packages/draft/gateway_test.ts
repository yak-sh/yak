import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { provenanceDoc } from '@yaks/provenance'
import { loadVocab } from '@yaks/vocab'
import { docs } from './vocab.ts'
import { drafts } from './plugin.ts'
import { type DraftDoor, draftGateway } from './gateway.ts'
import { draftEid } from './desk.ts'

let alice = mint(), bob = mint(), via = mint()
let fixture = () => {
  let vocab = loadVocab([...docs, provenanceDoc])
  let g = graph({ vocab, storage: ram(vocab), plugins: [drafts()] })
  g.install()
  return {
    query: (q: string) => Promise.resolve(g.read(q)),
    apply: (rows: Parameters<typeof g.apply>[0]) =>
      Promise.resolve(g.apply(rows, { trusted: true, stamp: false })).then((
        bundles,
      ) => ({ bundles })),
  }
}
let write = (
  door: ReturnType<typeof draftGateway>,
  principal: string,
  text: string,
) => door.write({ principal, place: 'book:one:prompt', text, over: '' })
let contents = async (door: ReturnType<typeof draftGateway>) =>
  (await door.snapshot()).drafts.map((row) => row.draft.text)

let db = fixture(),
  guest = draftGateway(db, { via }),
  a = draftGateway(db, { person: alice, via }),
  b = draftGateway(db, { person: bob, via })
await write(guest, via, 'First guest idea')
await write(a, alice, 'Alice idea')

test('guest handoff merges into its person and frees the same browser for a later guest', async () => {
  let taken = await a.snapshot()
  assertEquals(taken.recover, [via])
  assertEquals(taken.drafts[0].entity.eid, draftEid(alice, 'book:one:prompt'))
  assertEquals(taken.drafts[0].draft.text.includes('First guest idea'), true)
  assertEquals(taken.drafts[0].draft.text.includes('Alice idea'), true)
  assertEquals(await contents(guest), [])
  assertEquals(await contents(b), [])
  await write(guest, via, 'Fresh guest after Alice signs out')
  assertEquals(await contents(b), ['Fresh guest after Alice signs out'])
  assertEquals((await contents(a))[0].includes('Fresh guest'), false)
})

test('the current identity refuses pending writes from another signed-in person', async () => {
  await assertRejects(() => write(b, alice, 'Alice old tab'))
  await assertRejects(() => write(a, via, 'Old guest tab'))
})

let emptyDb = fixture(), emptyGuest = draftGateway(emptyDb, { via })
await write(emptyGuest, via, '')
await write(
  draftGateway(emptyDb, { person: alice, via }),
  alice,
  'Removed text',
)
test('an empty guest edit remains a present personal draft after handoff', async () => {
  assertEquals(await contents(draftGateway(emptyDb, { person: alice, via })), [
    '',
  ])
})

let failedDb = fixture(), failedGuest = draftGateway(failedDb, { via })
await write(failedGuest, via, 'Retain through interrupted handoff')
let refusing: DraftDoor = {
  query: failedDb.query,
  apply: () => Promise.reject(new Error('Store unavailable')),
}
test('failed atomic handoff retains all source text for the same person to retry', async () => {
  await assertRejects(() =>
    draftGateway(refusing, { person: alice, via }).snapshot()
  )
  assertEquals(await contents(failedGuest), [
    'Retain through interrupted handoff',
  ])
  assertEquals(await contents(draftGateway(failedDb, { person: alice, via })), [
    'Retain through interrupted handoff',
  ])
  assertEquals(await contents(failedGuest), [])
})

let previousVia = mint(), laterVia = mint(), retryDb = fixture()
await retryDb.apply([{
  entity: { eid: draftEid(previousVia, 'book:one:prompt') },
  draft: {
    via: previousVia,
    place: 'book:one:prompt',
    text: 'Alice original guest text',
  },
  // Filled by the existing directory attribution receipt after the failed
  // app transfer; it preserves the original guest instrument.
  created: { by: alice, via: previousVia },
}])
await write(
  draftGateway(retryDb, { via: laterVia }),
  laterVia,
  'Bob fresh guest text',
)
test('attributed guest text recovers on Alice retry through a later instrument while Bob gets fresh input', async () => {
  let bobDoor = draftGateway(retryDb, { person: bob, via: laterVia })
  assertEquals(await contents(bobDoor), ['Bob fresh guest text'])
  let recovered = await draftGateway(retryDb, { person: alice, via: mint() })
    .snapshot()
  assertEquals(recovered.drafts.map((row) => row.draft.text), [
    'Alice original guest text',
  ])
  assertEquals(recovered.recover.includes(previousVia), true)
})

let claimedDb = fixture(), claimedVia = mint()
await write(
  draftGateway(claimedDb, { via: claimedVia }),
  claimedVia,
  'Alice waiting for attribution',
)
test('a fresh claimed browser list recovers pending guest rows without waiting for attribution', async () => {
  let bob = draftGateway(claimedDb, {
    person: mint(),
    via: claimedVia,
    browsers: [],
  })
  assertEquals((await bob.snapshot()).drafts, [])
  let a = draftGateway(claimedDb, {
    person: alice,
    via: mint(),
    browsers: [claimedVia],
  })
  let snapshot = await a.snapshot()
  assertEquals(snapshot.drafts.map((row) => row.draft.text), [
    'Alice waiting for attribution',
  ])
  assertEquals(snapshot.recover, [claimedVia])
})
