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
let fixture = (override?: Service) => {
  let { db, g } = memory(manifest),
    calls: [string, Record<string, unknown>][] = []
  let service: Service = override ?? (async (name, args) => {
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
  return { desk: studio(db, service), g, calls }
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
    { desk } = fixture(async (name) => {
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
    { desk } = fixture(async (name) => {
      if (name === 'prepare') {
        starts++
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
