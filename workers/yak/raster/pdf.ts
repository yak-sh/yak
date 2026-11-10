// PDF page geometry and native text come from the same renderer that draws the
// scan for OCR. Rendering the page preserves clipping, rotation and masks.
import type { PDFiumLibrary, PDFiumPage } from '@hyzyla/pdfium'
import { encode } from 'fast-png'
import { base64 } from '../bytes.ts'

let picture = (page: PDFiumPage, text: string) =>
  !text.trim() ||
  [...page.objects()].some((o) => o.type == 'image' || o.type == 'form')

/** Whether any drawn pixel's channels differ by more than 2: colored ink. */
export let tinted = (rgba: Uint8Array) => {
  for (let i = 0; i < rgba.length; i += 4) {
    let r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]
    if (Math.max(r, g, b) - Math.min(r, g, b) > 2) return true
  }
  return false
}

// The drawn page, and whether it carries colored ink: the pixels are here, so
// a caller never decodes the PNG again to ask.
let png = async (page: PDFiumPage) => {
  let { originalWidth, originalHeight } = page.getOriginalSize()
  let scale = Math.min(2, 2400 / Math.max(originalWidth, originalHeight))
  let color = false
  let image = await page.render({
    scale,
    render: ({ data, width, height }) => {
      color = tinted(data)
      return Promise.resolve(encode({ data, width, height, channels: 4 }))
    },
  })
  return { image: base64(image.data), color }
}

export let pdf = async (
  req: Request,
  library: PDFiumLibrary,
): Promise<Response> => {
  let params = new URL(req.url).searchParams
  let asked = params.get('page')
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
      ...(params.get('render') == '1' || picture(page, text))
        ? await png(page)
        : {},
    })
  } finally {
    doc.destroy()
  }
}
