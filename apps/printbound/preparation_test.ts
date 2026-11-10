import { equal, ok, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { PDFDocument } from 'pdf-lib'
import { encode } from 'fast-png'
import {
  advance,
  DocumentInputError,
  type DocumentIO,
  hash,
  type Manifest,
  type Preparation,
  start,
} from './document.ts'
import { font } from './font_fixture.ts'
import { products } from './layout.ts'
import { cover } from './composition.ts'
import { inspect } from './inspection.ts'

let png = encode({
  width: 1,
  height: 1,
  channels: 3,
  data: new Uint8Array([255, 255, 255]),
})
let fixture = async () => {
  let pdf = await PDFDocument.create()
  pdf.addPage([100, 100]).drawRectangle({
    x: 10,
    y: 10,
    width: 10,
    height: 10,
  })
  let blobs = new Map([['font', font], ['art', await pdf.save()]])
  let operations = 0, sources = 0, fail = false
  let io: DocumentIO = {
    read: (id) => {
      operations++
      if (id == 'art') sources++
      return Promise.resolve(ok(blobs.get(id)).slice())
    },
    put: async (bytes) => {
      operations++
      let id = await hash(bytes)
      blobs.set(id, bytes.slice())
      return id
    },
    preview: () => {
      operations++
      if (fail) throw new Error('Renderer unavailable')
      return Promise.resolve({ image: png, color: false })
    },
  }
  return {
    io,
    blobs,
    reset: () => operations = sources = 0,
    count: () => ({ operations, sources }),
    fail: (value: boolean) => fail = value,
  }
}
let complete = async (
  state: Preparation,
  f: Awaited<ReturnType<typeof fixture>>,
) => {
  let current: Preparation | Manifest = state,
    maximum = 0,
    reads = 0,
    stages = 0
  while (!('revision' in current)) {
    f.reset()
    current = await advance(JSON.parse(JSON.stringify(current)), f.io)
    let n = f.count()
    maximum = Math.max(maximum, n.operations)
    reads += n.sources
    stages++
    ok(n.operations <= 10)
    ok(n.sources <= 4)
  }
  return { doc: current, maximum, reads, stages }
}

test('minimum print book checkpoints all 33 previews below the worker operation budget', async () => {
  let f = await fixture()
  let state = start(products.text, {
    title: 'ABC',
    font: 'font',
    markdown: 'A complete book.',
  })
  let { doc, maximum, stages } = await complete(state, f)
  equal(doc.interior.pages, 32)
  equal(doc.pages.length, 33)
  equal(doc.pages.filter((p) => p.blank).length, 30)
  equal(maximum, 9)
  ok(stages > 8)
})

test('800 ordered source pages are resolved and merged in bounded resumable stages', async () => {
  let f = await fixture()
  let { doc, reads, maximum } = await complete(
    start(products.text, {
      title: 'ABC',
      font: 'font',
      pages: Array.from({ length: 800 }, () => ({ blob: 'art' })),
    }),
    f,
  )
  equal(reads, 800)
  equal(doc.interior.pages, 800)
  equal(doc.pages.length, 801)
  equal(doc.pages.filter((p) => p.blank).length, 0)
  ok(maximum <= 10)
})

test('a failed preview resumes its saved checkpoint without rereading original artwork', async () => {
  let f = await fixture(),
    state: Preparation | Manifest = start(products.text, {
      title: 'ABC',
      font: 'font',
      pages: [{ blob: 'art' }],
    })
  while (!('revision' in state) && !state.inspected) {
    state = await advance(state, f.io)
  }
  ok(!('revision' in state))
  let saved = JSON.stringify(state)
  f.fail(true)
  await assertRejects(
    () => advance(state as Preparation, f.io),
    Error,
    'Renderer unavailable',
  )
  equal(JSON.stringify(state), saved)
  f.fail(false)
  let { doc, reads } = await complete(JSON.parse(saved), f)
  equal(reads, 0)
  equal(doc.pages.length, 33)
})

test('invalid supplied PDFs are input refusals while source transport failures retain their error', async () => {
  let f = await fixture()
  f.blobs.set('broken', new Uint8Array([1, 2, 3]))
  await assertRejects(() =>
    advance(
      start(products.text, {
        title: 'ABC',
        interior: 'broken',
        cover: 'broken',
      }),
      f.io,
    ), DocumentInputError)
  let failure = new Error('Storage unavailable')
  try {
    await advance(
      start(products.text, {
        title: 'ABC',
        interior: 'source',
        cover: 'cover',
      }),
      {
        ...f.io,
        read: () => Promise.reject(failure),
      },
    )
    throw new Error('Expected source failure')
  } catch (error) {
    equal(error, failure)
  }
})

test('inset cover artwork preserves print resolution beside cover typography', async () => {
  let f = await fixture()
  f.blobs.set(
    'front',
    encode({
      width: 180,
      height: 216,
      channels: 3,
      data: new Uint8Array(180 * 216 * 3),
    }),
  )
  let spec = { ...products.text, width: 216, height: 288, dpi: 72 }
  let draft = {
    title: 'ABC',
    author: 'DEF',
    font: 'font',
    front: 'front',
    frontBleed: false,
  }
  let [page] = await inspect(await cover(spec, draft, 32, f.io.read))
  equal(page.images.length, 1)
  ok(page.images[0].dpi >= spec.dpi)
  await assertRejects(
    () => cover(spec, { ...draft, frontBleed: true }, 32, f.io.read),
    DocumentInputError,
    'below 72 dpi',
  )
})
