import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { memory } from '../printbound/storefront_fixture.ts'
import manifest from './vocab.json' with { type: 'json' }
import { type Book, fingerprint, type Page } from './model.ts'
import { edition, printer, printing } from './printing.ts'

let fixture = async () => {
  let { db } = memory(manifest)
  let book: Book = {
    entity: { eid: crypto.randomUUID() },
    doc: { title: 'The bridge', body: '' },
    coloring_book: {
      owner: crypto.randomUUID(),
      prompt: 'Crossing the bridge',
      age: '4-8',
      style: crypto.randomUUID(),
      character: '',
      mode: 'coloring',
      personalization: '',
      dedication: '',
    },
  }
  let page: Page = {
    entity: { eid: crypto.randomUUID() },
    coloring_page: {
      book: book.entity.eid,
      position: 1,
      prompt: 'A bridge',
      caption: 'Across the river',
      activity: '',
      seed: 0,
    },
  }
  page.artwork = {
    blob: 'a'.repeat(64),
    hash: 'a'.repeat(64),
    mime: 'image/png',
    input: fingerprint(book, page),
  }
  await db.apply([book, page])
  let read = async () =>
    (await db.query(
      `.entity.eid=${book.entity.eid}&?doc&?coloring_book&?print_preparation&?print_review&?print_quote`,
    ))[0] as Book
  return { db, book, page, read }
}

test('the consumer renews original artwork tickets on resume and only reviews a complete composed document', async () => {
  let f = await fixture(),
    job = crypto.randomUUID(),
    requests: [string, Record<string, unknown>][] = [],
    links = 0,
    ready = false,
    failed = false
  let composed = {
    id: job,
    revision: 'b'.repeat(64),
    pages: [{ blob: 'c'.repeat(64), role: 'interior', number: 1 }],
    interior: { blob: 'd'.repeat(64) },
    cover: { blob: 'e'.repeat(64) },
  }
  let press = printing(f.db, {
    fetch: (path) =>
      Promise.resolve(
        Response.json({
          url: 'https://assets.example/' + path.split('/')[3] + '?ticket=' +
            ++links,
        }),
      ),
  }, (name, args) => {
    requests.push([name, args])
    if (name === 'prepare') return Promise.resolve({ id: job, pending: true })
    if (name === 'document_status') {
      return Promise.resolve(
        failed
          ? {
            id: job,
            pending: false,
            error: 'Reconnect PrintBound before resuming.',
          }
          : ready
          ? composed
          : { id: job, pending: true },
      )
    }
    if (name === 'quote') {
      return Promise.resolve({ id: crypto.randomUUID(), document: job })
    }
    throw new Error('Checkout before review')
  }, { preview: true, font: '', printer: '', model: '' })
  await press.prepare(f.book, [f.page])
  let pending = await f.read()
  assertEquals(pending.print_review, undefined)
  await assertRejects(() => press.quote(pending, [f.page], {}))
  await press.prepare(pending, [f.page])
  let first = requests[0][1], resumed = requests[1][1]
  assertEquals(first.document, undefined)
  assertEquals(resumed.document, job)
  assertEquals(resumed.front_bleed, false)
  assertEquals(resumed.product, 'coloring')
  let source = (value: Record<string, unknown>) =>
    new URL((value.pages as { blob: string }[])[0].blob)
  assertEquals(source(first).pathname, source(resumed).pathname)
  assertEquals(source(first).search === source(resumed).search, false)
  failed = true
  await assertRejects(
    () => press.preparation(pending, [f.page]),
    Error,
    'Reconnect PrintBound',
  )
  assertEquals((await f.read()).print_review, undefined)
  failed = false
  ready = true
  await press.preparation(pending, [f.page])
  let reviewed = await f.read()
  assertEquals(
    reviewed.print_review?.document.source,
    edition(f.book, [f.page]),
  )
  await press.quote(reviewed, [f.page], { quantity: 1 })
  assertEquals(requests.at(-1)![1].document, job)
})

test('the service adapter unwraps the shared command answer envelope', async () => {
  let call = printer({
    fetch: () =>
      Promise.resolve(
        Response.json({
          value: { answer: JSON.stringify({ id: 'prepared', pending: true }) },
        }),
      ),
  }, crypto.randomUUID())
  assertEquals(await call('prepare', {}), { id: 'prepared', pending: true })
})
