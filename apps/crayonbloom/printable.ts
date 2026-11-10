import { PDFDocument } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { type Binding, guard, Refusal, type Store } from './db.ts'
import { type Runtime } from './generation.ts'
import { type Book, current, type Page } from './model.ts'
import type { Place } from './pages/chrome.ts'
import { preparing } from './pages/free.ts'

/** One letter-size sheet: the artwork fit within print margins, captioned. */
export let sheet = async (
  app: Binding,
  typeface: string,
  artwork: { blob: string; mime: string },
  title: string,
) => {
  let response = await app.fetch('/pay/artifacts/' + artwork.blob)
  if (!response.ok) {
    throw new Error('The saved artwork could not be read: ' + response.status)
  }
  let bytes = new Uint8Array(await response.arrayBuffer())
  if (artwork.mime === 'application/pdf') {
    return new Response(bytes, {
      headers: { 'content-type': 'application/pdf' },
    })
  }
  let fontResponse = await app.fetch('/pay/artifacts/' + typeface)
  if (!fontResponse.ok) {
    throw new Error(
      'The printable typography font could not be read: ' + fontResponse.status,
    )
  }
  let doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  let font = await doc.embedFont(
    new Uint8Array(await fontResponse.arrayBuffer()),
    { subset: true },
  )
  let paper = doc.addPage([612, 792]),
    image = artwork.mime === 'image/jpeg'
      ? await doc.embedJpg(bytes)
      : await doc.embedPng(bytes)
  let scale = Math.min(504 / image.width, 630 / image.height),
    width = image.width * scale,
    height = image.height * scale
  paper.drawImage(image, {
    x: (612 - width) / 2,
    y: 100 + (630 - height) / 2,
    width,
    height,
  })
  paper.drawText(title.slice(0, 75), { x: 54, y: 65, size: 13, font })
  paper.drawText('Made with CrayonBloom', { x: 54, y: 44, size: 9, font })
  let output = await doc.save()
  return new Response(new Uint8Array(output), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="crayonbloom-printable.pdf"',
      'cache-control': 'private, no-store',
    },
  })
}

export let printable = async (
  app: Binding,
  runtime: Runtime,
  book: Book,
  page: Page,
) => {
  if (!current(book, page) || !page.artwork) {
    throw new Refusal('Finish this page before downloading its printable.')
  }
  return await sheet(app, runtime.font, page.artwork, book.doc.title)
}

export let printableRequest = async (
  db: Store,
  app: Binding,
  book: Book,
  page: Page,
  place: Place,
) => {
  if (!current(book, page) || !page.artwork) {
    throw new Refusal('Finish this page before downloading its printable.')
  }
  let ready = page.page_printable as
    | { blob: string; input: string }
    | undefined
  if (ready?.input === page.artwork.hash) {
    return await app.fetch('/pay/artifacts/' + ready.blob)
  }
  let pending = page.page_printable_job as
    | { job: string; input: string }
    | undefined
  if (pending?.input !== page.artwork.hash) {
    let job = crypto.randomUUID(),
      [tool] = await db.query('.tool.name=coloring_printable')
    if (!tool) {
      throw new Error('The printable continuation command is missing.')
    }
    await db.apply([{
      entity: { eid: job },
      printable_job: {
        book: book.entity.eid,
        page: page.entity.eid,
        input: page.artwork.hash,
      },
      call: { to: tool.entity.eid, args: { job } },
      wake: { at: new Date(Date.now() + 1000).toISOString() },
    }, {
      entity: page.entity,
      page_printable_job: { job, input: page.artwork.hash },
      $was: guard(page, ['artwork']),
    }])
  }
  let waiting = preparing(place)
  return new Response(waiting.body, { status: 202, headers: waiting.headers })
}
