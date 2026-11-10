import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { decode, encode } from 'fast-png'
import { equal, match, ok, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { compose } from './composition.ts'
import { hash, prepare } from './document.ts'
import { inspect } from './inspection.ts'
import { count, geometry, products } from './layout.ts'
import { fixture, spec } from './document_fixture.ts'

let draft = {
  title: 'ABC',
  author: 'DEF',
  font: 'font',
  markdown: '# Chapter\n\nA complete book.',
}
let source = fixture()
let made = await prepare(spec, draft, source.io)
let repeat = await prepare(spec, draft, source.io)
let saved = {
  interior: made.interior.blob,
  cover: made.cover.blob,
  title: 'ABC',
}
let pair = await prepare(spec, saved, source.io)

test('preparation stores the entire composed interior, cover, padding and byte hashes', async () => {
  equal(made.interior.pages, 4)
  equal(made.cover.pages, 1)
  equal(made.pages.map((p) => [p.role, p.number, p.blank]), [
    ['interior', 1, false],
    ['interior', 2, false],
    ['interior', 3, true],
    ['interior', 4, true],
    ['cover', 1, false],
  ])
  for (let artifact of [made.interior, made.cover, ...made.pages]) {
    equal(await hash(ok(source.blobs.get(artifact.blob))), artifact.hash)
  }
  equal(made.revision, repeat.revision)
  equal(pair.interior.hash, made.interior.hash)
  equal(pair.pages.map((p) => p.hash), made.pages.map((p) => p.hash))
  ok(made.pages.filter((p) => p.fonts.length).length >= 3)
})

test('preview draws the PDF page including text rather than the source', () => {
  equal(source.calls[0].bytes, source.blobs.get(made.interior.blob))
  let cover = decode(ok(source.blobs.get(made.pages.at(-1)!.blob)))
  ok(cover.data.some((n) => n < 255))
  equal([cover.width, cover.height], [
    2 * geometry(spec, 4).width,
    2 * geometry(spec, 4).height,
  ])
})

test('binding geometry uses padded leaves, zero saddle spine and stepped casewrap boards', () => {
  equal(count(products.booklet, 9), 12)
  equal(count(products.coloring, 33), 34)
  equal(geometry(products.booklet, 12).spine, 0)
  equal(geometry(products.hardcover, 84).spine, 18)
  equal(geometry(products.hardcover, 88).spine, 36)
  let pb = geometry(products.text, 32)
  ok(Math.abs(pb.spine - (32 / 444 + .06) * 72) < 1e-8)
})

test('a missing page fails preparation and leaves the saved source intact', async () => {
  let f = fixture(), original = structuredClone(draft)
  await assertRejects(
    () =>
      prepare(spec, {
        ...draft,
        markdown: undefined,
        pages: [{ blob: 'missing' }],
      }, f.io),
    Error,
    'missing',
  )
  equal(draft, original)
  equal(f.calls.length, 0)
  equal(f.blobs.size, 1)
})

test('parser checks fonts and dimensions on later pages of uploaded PDFs', async () => {
  let f = fixture(), output = await compose(spec, draft, f.io.read)
  let pdf = await PDFDocument.load(output.interior)
  let font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.getPages()[3].drawText('Unembedded', { font })
  f.blobs.set('bad', await pdf.save())
  f.blobs.set('cover', output.cover)
  await assertRejects(
    () =>
      prepare(spec, { title: 'ABC', interior: 'bad', cover: 'cover' }, f.io),
    Error,
    'not embedded',
  )
  let wrong = await PDFDocument.load(output.interior)
  wrong.getPages()[2].setSize(10, 10)
  f.blobs.set('wrong', await wrong.save())
  await assertRejects(
    () =>
      prepare(spec, { title: 'ABC', interior: 'wrong', cover: 'cover' }, f.io),
    Error,
    'incorrect print dimensions',
  )
})

test('uploaded image resolution follows its content transform through embedded forms', async () => {
  let pdf = await PDFDocument.create()
  let png = encode({
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array(12).fill(0),
  })
  let art = await pdf.embedPng(png)
  let page = pdf.addPage([100, 100])
  page.drawImage(art, { x: 0, y: 0, width: 72, height: 36 })
  let inner = await pdf.save()
  let outer = await PDFDocument.create()
  let [embedded] = await outer.embedPdf(inner)
  outer.addPage([100, 100]).drawPage(embedded, { width: 50, height: 50 })
  let [a] = await inspect(await outer.save())
  match(a.images, [{ width: 2, height: 2, dpi: 4, color: '/DeviceRGB' }])
})

test('coloring rules apply to uploaded PDFs while color products preserve color artwork', async () => {
  let f = fixture(), output = await compose(spec, draft, f.io.read)
  let pdf = await PDFDocument.load(output.interior)
  pdf.getPages()[3].drawRectangle({
    x: 20,
    y: 20,
    width: 30,
    height: 30,
    color: rgb(1, 0, 0),
  })
  f.blobs.set('color', await pdf.save())
  f.blobs.set('cover', output.cover)
  let input = { title: 'ABC', interior: 'color', cover: 'cover' }
  let color = await prepare(spec, input, f.io)
  equal(color.interior.pages, 4)
  await assertRejects(
    () => prepare({ ...spec, coloring: true }, input, f.io),
    Error,
    'colored ink',
  )
})

test('coloring PNG cleanup flattens alpha and the complete print pages carry the transformed artwork', async () => {
  let f = fixture()
  let png = encode({
    width: 2,
    height: 2,
    channels: 4,
    data: new Uint8Array([
      255,
      0,
      0,
      255,
      0,
      0,
      0,
      0,
      250,
      250,
      250,
      255,
      0,
      0,
      0,
      255,
    ]),
  })
  f.blobs.set('art', png)
  let doc = await prepare({ ...spec, coloring: true }, {
    title: 'ABC',
    font: 'font',
    pages: [{ blob: 'art', kind: 'puzzle' }],
  }, f.io)
  equal(doc.pages[0].images.length, 1)
  equal(doc.pages[0].images[0].color, '/DeviceRGB')
  equal(doc.pages.filter((p) => p.blank).length, 3)
})

test('render failure never publishes an incomplete document manifest', async () => {
  let f = fixture(), calls = 0
  await assertRejects(
    () =>
      prepare(spec, draft, {
        ...f.io,
        preview: (bytes, page) => {
          if (++calls == 3) throw new Error('renderer failed')
          return f.io.preview(bytes, page)
        },
      }),
    Error,
    'renderer failed',
  )
  equal(calls, 3)
  ok(f.blobs.has('font'))
})

test('print-ready PNG rows are carried into the PDF without converting a pixel', async () => {
  let f = fixture()
  let gray = encode({
    width: 2,
    height: 2,
    channels: 1,
    data: new Uint8Array([0, 250, 128, 255]),
  })
  f.blobs.set('gray', gray)
  let pages = [{ blob: 'gray', kind: 'image' as const }]
  let [coloring, plain] = await Promise.all(
    [true, false].map((coloring) =>
      prepare(
        { ...spec, coloring },
        { title: 'ABC', font: 'font', pages },
        f.io,
      )
    ),
  )
  match(coloring.pages[0].images[0].color, /^\[ \/Indexed \/DeviceGray 255 </)
  equal(plain.pages[0].images[0].color, '/DeviceGray')
  let art = decode(ok(f.blobs.get(plain.pages[0].blob)))
  ok(art.data.some((n) => n == 0))
})
