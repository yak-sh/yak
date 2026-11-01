// PDF page geometry and native text come from the same renderer that draws the
// scan for OCR. Rendering the page preserves clipping, rotation and masks.
import type { PDFiumLibrary, PDFiumPage } from '@hyzyla/pdfium'
import { encode } from 'fast-png'
import { base64 } from '../bytes.ts'

let picture = (page: PDFiumPage, text: string) =>
  !text.trim() ||
  [...page.objects()].some((o) => o.type == 'image' || o.type == 'form')

let png = async (page: PDFiumPage) => {
  let { originalWidth, originalHeight } = page.getOriginalSize()
  let scale = Math.min(2, 2400 / Math.max(originalWidth, originalHeight))
  let image = await page.render({
    scale,
    render: ({ data, width, height }) =>
      Promise.resolve(encode({ data, width, height, channels: 4 })),
  })
  return base64(image.data)
}

export let pdf = async (
  req: Request,
  library: PDFiumLibrary,
): Promise<Response> => {
  let asked = new URL(req.url).searchParams.get('page')
  let number = Number(asked)
  if (
    req.method != 'POST' ||
    asked != null && (!Number.isInteger(number) || number < 1)
  ) {
    return new Response(
      'POST a PDF, optionally ?page= with a 1-based page number',
      { status: 400 },
    )
  }
  let doc = await library.loadDocument(new Uint8Array(await req.arrayBuffer()))
  try {
    let pages = doc.getPageCount()
    if (asked == null) return Response.json({ pages })
    if (number > pages) {
      return new Response('page is outside the document', { status: 422 })
    }
    let page = doc.getPage(number - 1)
    let text = page.getText()
    return Response.json({
      pages,
      text,
      ...picture(page, text) ? { image: await png(page) } : {},
    })
  } finally {
    doc.destroy()
  }
}
