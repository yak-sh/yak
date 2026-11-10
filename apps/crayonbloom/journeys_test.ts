import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { encode } from 'fast-png'
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { memory } from '../printbound/storefront_fixture.ts'
import { font } from '../printbound/font_fixture.ts'
import { inspect } from '../printbound/inspection.ts'
import manifest from './vocab.json' with { type: 'json' }
import { type Book, fingerprint, type Page } from './model.ts'
import { story } from './story.ts'
import { printable, printableRequest } from './printable.ts'
import { placed } from './pages/chrome.ts'

let place = placed(
  'https://crayonbloom.test/studio/printable',
  '/studio/printable',
)
let runtime = { preview: true, font: 'f'.repeat(64), printer: '', model: '' }
let fixture = async () => {
  let { db } = memory({
    $defs: {
      ...manifest.$defs,
      tool: {
        component: true,
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      call: {
        component: true,
        type: 'object',
        properties: { to: { type: 'string' }, args: { type: 'object' } },
      },
      wake: {
        component: true,
        type: 'object',
        properties: { at: { type: 'string' } },
      },
    },
  })
  let book: Book = {
    entity: { eid: crypto.randomUUID() },
    doc: { title: 'Across the bridge', body: '' },
    coloring_book: {
      owner: crypto.randomUUID(),
      prompt: 'A child follows the river to a treehouse.',
      age: '4-8',
      style: crypto.randomUUID(),
      character: 'A striped hat',
      mode: 'free',
      personalization: '',
      dedication: '',
    },
  }
  await db.apply([book])
  let read = async () =>
    (await db.query(
      `.entity.eid=${book.entity.eid}&?doc&?coloring_book&?book_story`,
    ))[0] as Book
  return { db, book, read }
}

test('fixture story suggestions retain the parents idea and leave editable saved paragraphs', async () => {
  let f = await fixture(), suggest = story(f.db, runtime)
  assertEquals((await suggest(f.book)).pending, true)
  await suggest(await f.read())
  let saved = await f.read(),
    pages = await f.db.query(
      `.coloring_page.book=${saved.entity.eid}&?coloring_page`,
    )
  assertEquals(saved.coloring_book.prompt, f.book.coloring_book.prompt)
  assertEquals(saved.doc.body.split('\n\n').length, 4)
  assertEquals(pages.length, 4)
  assertEquals(saved.book_story, undefined)
  await f.db.apply([{
    entity: saved.entity,
    doc: { body: 'The parent edited this sentence.' },
  }])
  assertEquals((await f.read()).doc.body, 'The parent edited this sentence.')
})

test('an edit made while a story is pending is never replaced by that suggestion', async () => {
  let f = await fixture(), suggest = story(f.db, runtime)
  await suggest(f.book)
  await f.db.apply([{
    entity: f.book.entity,
    doc: { body: 'Keep my new ending.' },
  }])
  await assertRejects(async () => suggest(await f.read()))
  assertEquals((await f.read()).doc.body, 'Keep my new ending.')
})

test('a free printable retains the selected artwork pixels in a one-page Letter PDF', async () => {
  let f = await fixture(),
    page: Page = {
      entity: { eid: crypto.randomUUID() },
      coloring_page: {
        book: f.book.entity.eid,
        position: 1,
        prompt: f.book.coloring_book.prompt,
        caption: '',
        activity: '',
        seed: 0,
      },
    }
  page.artwork = {
    blob: 'a'.repeat(64),
    hash: 'a'.repeat(64),
    mime: 'image/png',
    input: fingerprint(f.book, page),
  }
  let pixels = Uint8Array.from(
    { length: 16 * 20 * 3 },
    (_, i) => Math.floor(i / 3) % 7 === 0 ? 0 : 255,
  )
  let image = encode({ width: 16, height: 20, channels: 3, data: pixels })
  let output = await printable(
    {
      fetch: (path) =>
        Promise.resolve(
          new Response(
            new Uint8Array(path.endsWith(runtime.font) ? font : image),
          ),
        ),
    },
    runtime,
    f.book,
    page,
  )
  assertEquals(output.headers.get('content-type'), 'application/pdf')
  let bytes = new Uint8Array(await output.arrayBuffer()),
    sheets = await inspect(bytes)
  let pdf = await PDFDocument.load(bytes)
  let embedded = pdf.context.enumerateIndirectObjects().map(([, object]) =>
    object
  ).find((object) =>
    object instanceof PDFRawStream &&
    object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image'
  ) as PDFRawStream
  assertEquals(decodePDFRawStream(embedded).decode(), pixels)
  assertEquals(
    sheets.map((
      p,
    ) => [p.width, p.height, p.images.map((i) => [i.width, i.height])]),
    [[612, 792, [[16, 20]]]],
  )
})

test('free printable requests enqueue one retained job and perform no layout in the ordinary request', async () => {
  let f = await fixture(),
    page: Page = {
      entity: { eid: crypto.randomUUID() },
      coloring_page: {
        book: f.book.entity.eid,
        position: 1,
        prompt: '',
        caption: '',
        activity: '',
        seed: 0,
      },
    }
  page.artwork = {
    blob: 'a'.repeat(64),
    hash: 'a'.repeat(64),
    mime: 'image/png',
    input: fingerprint(f.book, page),
  }
  await f.db.apply([page, {
    entity: { eid: crypto.randomUUID() },
    tool: { name: 'coloring_printable' },
  }])
  let app = {
    fetch: () => {
      throw new Error('Layout or bytes were fetched in the ordinary request')
    },
  }
  assertEquals(
    (await printableRequest(f.db, app, f.book, page, place)).status,
    202,
  )
  let [saved] = await f.db.query(
    `.entity.eid=${page.entity.eid}&?coloring_page&?artwork&?page_printable_job`,
  ) as Page[]
  assertEquals(
    (await printableRequest(f.db, app, f.book, saved, place)).status,
    202,
  )
  let jobs = await f.db.query('.printable_job&?call&?wake')
  assertEquals(jobs.length, 1)
  assertEquals((jobs[0].call as { args: unknown }).args, {
    job: jobs[0].entity.eid,
  })
})
