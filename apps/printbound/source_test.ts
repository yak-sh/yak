import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import manifest from './storefront-vocab.json' with { type: 'json' }
import { type Document, type Service, studio } from './source.ts'
import { memory } from './storefront_fixture.ts'

let alice = {
  person: '00000000-0000-4000-8000-000000000001',
  via: '00000000-0000-4000-8000-000000000003',
}
let bob = { person: '00000000-0000-4000-8000-000000000002', via: alice.via }
let doc: Document = {
  id: '00000000-0000-4000-8000-000000000004',
  revision: 'a'.repeat(64),
  pages: [{
    number: 1,
    role: 'interior',
    blob: 'b'.repeat(64),
    hash: 'b'.repeat(64),
  }],
  interior: { blob: 'c'.repeat(64) },
  cover: { blob: 'd'.repeat(64) },
}
let text = {
  title: 'A saved conversation',
  markdown: '# Chapter one\n\nWords worth keeping.',
  author: 'A. Writer',
  dedication: 'For family',
}
let fixture = (override?: (...args: Parameters<Service>) => unknown) => {
  let { db, g } = memory(manifest),
    calls: [string, Record<string, unknown>][] = []
  let respond: (...args: Parameters<Service>) => unknown = override ??
    ((name, args) => {
      calls.push([name, args])
      if (name === 'prepare') return doc
      if (name === 'quote') {
        return {
          id: crypto.randomUUID(),
          document: doc.id,
          revision: doc.revision,
          seller: 'PrintBound',
          currency: 'usd',
          total: 2400,
          expires: new Date(Date.now() + 60_000).toISOString(),
          shipping: { id: 'MAIL', name: 'Standard', cents: 600 },
        }
      }
      return {
        id: args.quote,
        document: doc.revision,
        seller: 'PrintBound',
        status: name === 'order_status' ? 'printing' : 'payment_pending',
      }
    })
  return {
    desk: studio(db, (...args) => Promise.resolve(respond(...args))),
    g,
    calls,
  }
}

test('saved guest input continues through sign-in and becomes private to the bound customer', async () => {
  let { desk } = fixture(), guest = { via: alice.via }
  let row = await desk.save(text, guest)
  assertEquals(
    (await desk.owned(row.entity.eid, alice)).book_source.markdown,
    text.markdown,
  )
  await desk.save({ ...text, id: row.entity.eid }, alice)
  await assertRejects(() => desk.owned(row.entity.eid, bob))
  assertEquals((await desk.shelf(bob)).length, 0)
  assertEquals((await desk.shelf(alice)).length, 1)
})

test('failed preparation cannot quote or take payment', async () => {
  let bought = 0,
    { desk } = fixture((name) => {
      if (name === 'prepare') throw new Error('Artwork failed')
      bought++
      return {}
    })
  let row = await desk.save(text, alice)
  await assertRejects(
    () => desk.prepare(row.entity.eid, alice),
    Error,
    'Artwork failed',
  )
  await assertRejects(() => desk.quote(row.entity.eid, {}, alice))
  await assertRejects(() => desk.purchase(row.entity.eid, alice))
  assertEquals(bought, 0)
})

test('quote and checkout carry the reviewed document UUID and progress reads the provider', async () => {
  let { desk, calls } = fixture(), row = await desk.save(text, alice)
  await desk.prepare(row.entity.eid, alice)
  await desk.quote(row.entity.eid, {
    quantity: 2,
    address: { city: 'Chicago' },
    shipping: 'MAIL',
  }, alice)
  await desk.purchase(row.entity.eid, alice)
  assertEquals(calls.find(([name]) => name === 'quote')![1].document, doc.id)
  assertEquals(calls.find(([name]) => name === 'purchase')![1].document, doc.id)
  assertEquals((await desk.progress(row.entity.eid, alice))!.status, 'printing')
  await desk.save(
    { ...text, id: row.entity.eid, markdown: 'Changed words' },
    alice,
  )
  await assertRejects(() => desk.purchase(row.entity.eid, alice))
})

test('an edit racing preparation preserves the edit and does not attach a stale document', async () => {
  let finish!: (document: Document) => void
  let { desk } = fixture(() =>
    new Promise((resolve) => {
      finish = resolve
    })
  )
  let row = await desk.save(text, alice),
    pending = desk.prepare(row.entity.eid, alice)
  while (!finish) await Promise.resolve()
  await desk.save(
    { ...text, id: row.entity.eid, markdown: 'The newer text' },
    alice,
  )
  finish(doc)
  await assertRejects(() => pending)
  let after = await desk.owned(row.entity.eid, alice)
  assertEquals(after.book_source.markdown, 'The newer text')
  assertEquals(after.book_prepared, undefined)
})

test('pending preparation resumes one stored job and never becomes a reviewed document early', async () => {
  let starts = 0,
    polls = 0,
    { desk } = fixture((name, args) => {
      if (name === 'prepare') {
        if (!args.document) starts++
        else assertEquals(args.document, doc.id)
        return { id: doc.id, pending: true }
      }
      if (name === 'document_status') {
        return ++polls < 2 ? { id: doc.id, pending: true } : doc
      }
      throw new Error('Payment was reached before review')
    })
  let row = await desk.save(text, alice)
  await desk.prepare(row.entity.eid, alice)
  await desk.prepare(row.entity.eid, alice)
  assertEquals(starts, 1)
  await assertRejects(() => desk.purchase(row.entity.eid, alice))
  assertEquals((await desk.preparation(row.entity.eid, alice))?.pending, true)
  await desk.preparation(row.entity.eid, alice)
  assertEquals(
    (await desk.owned(row.entity.eid, alice)).book_prepared?.document.id,
    doc.id,
  )
})

test('a preparation input error preserves its job and resumes the same document after correction', async () => {
  let resumed: unknown, failed = true
  let { desk } = fixture((name, args) => {
    if (name === 'prepare') {
      resumed = args.document
      return { id: doc.id, pending: true }
    }
    if (name === 'document_status') {
      return failed
        ? {
          id: doc.id,
          pending: false,
          error: 'Reconnect the source before resuming.',
        }
        : doc
    }
    throw new Error('Checkout reached before review')
  })
  let row = await desk.save(text, alice)
  await desk.prepare(row.entity.eid, alice)
  await assertRejects(
    () => desk.preparation(row.entity.eid, alice),
    Error,
    'Reconnect the source',
  )
  await assertRejects(() => desk.purchase(row.entity.eid, alice))
  failed = false
  await desk.prepare(row.entity.eid, alice)
  assertEquals(resumed, doc.id)
  await desk.preparation(row.entity.eid, alice)
  assertEquals(
    (await desk.owned(row.entity.eid, alice)).book_prepared?.document.id,
    doc.id,
  )
})

test('a signed continuation binds a guest book before its quote or receipt can be shared by the browser', async () => {
  let { desk } = fixture(), row = await desk.save(text, { via: alice.via })
  await desk.prepare(row.entity.eid, { via: alice.via })
  await desk.quote(row.entity.eid, {}, alice)
  await assertRejects(() => desk.owned(row.entity.eid, bob))
  await assertRejects(() => desk.purchase(row.entity.eid, bob))
  assertEquals(
    (await desk.owned(row.entity.eid, alice)).book_source.owner,
    alice.person,
  )
})
