import fontkit from '@pdf-lib/fontkit'
import { marked, type Tokens } from 'marked'
import {
  clip,
  degrees,
  endPath,
  grayscale,
  PDFDocument,
  PDFEmbeddedPage,
  type PDFFont,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
} from 'pdf-lib'
import { raster } from './artwork.ts'
import { count, fit, geometry, type Product } from './layout.ts'

export type PageSource = {
  blob?: string
  caption?: string
  kind?: 'image' | 'puzzle' | 'blank'
  bleed?: boolean
}
export type Draft = {
  title: string
  author?: string
  markdown?: string
  font?: string
  pages?: PageSource[]
  interior?: string
  cover?: string
  front?: string
  back?: string
  backText?: string
  dedication?: string
  typography?: { size?: number; leading?: number }
}
export type Read = (blob: string) => Promise<Uint8Array>
let fresh = async () => {
  let pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setCreationDate(new Date(0))
  pdf.setModificationDate(new Date(0))
  pdf.setProducer('PrintBound')
  pdf.setCreator('PrintBound')
  return pdf
}
let face = async (pdf: PDFDocument, draft: Draft, read: Read) => {
  if (!draft.font) {
    throw new Error('Choose an embedded font before composing text')
  }
  return pdf.embedFont(await read(draft.font), { subset: true })
}
let sheet = (pdf: PDFDocument, spec: Product) => {
  let page = pdf.addPage([
    spec.width + 2 * spec.bleed,
    spec.height + 2 * spec.bleed,
  ])
  page.setTrimBox(spec.bleed, spec.bleed, spec.width, spec.height)
  page.setBleedBox(0, 0, page.getWidth(), page.getHeight())
  return page
}
let text = (
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size: number,
) => page.drawText(value, { font, x, y, size, color: grayscale(0) })

export let wrap = (
  value: string,
  font: Pick<PDFFont, 'widthOfTextAtSize'>,
  size: number,
  width: number,
) => {
  let lines: string[] = [], line = ''
  for (let word of value.split(/\s+/).filter(Boolean)) {
    if (line && font.widthOfTextAtSize(line + ' ' + word, size) > width) {
      lines.push(line)
      line = ''
    }
    for (let char of word) {
      if (line && font.widthOfTextAtSize(line + char, size) > width) {
        lines.push(line)
        line = ''
      }
      line += char
    }
    line += ' '
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines.map((line) => line.trimEnd())
}

let plain = (value: string): string =>
  marked.lexer(value).map((token) => {
    if (token.type == 'html') return ''
    if (token.type == 'space') return '\n'
    if (token.type == 'list') {
      return token.items.map((item: Tokens.ListItem) => plain(item.text)).join(
        '\n',
      )
    }
    if (token.type == 'table') {
      return [token.header, ...token.rows].map((row) =>
        row.map((cell: Tokens.TableCell) => plain(cell.text)).join('   ')
      ).join('\n')
    }
    if ('text' in token && typeof token.text == 'string') {
      return marked.Lexer.lexInline(token.text).map((part) =>
        part.type == 'html' || part.type == 'image'
          ? ''
          : 'text' in part
          ? part.text
          : ''
      ).join('')
    }
    return ''
  }).join('\n')

let paragraph = (
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size: number,
  width: number,
  leading = size * 1.4,
) => {
  for (let line of wrap(value, font, size, width)) {
    text(page, font, line, x, y, size)
    y -= leading
  }
  return y
}

let textPages = (
  pdf: PDFDocument,
  spec: Product,
  draft: Draft,
  font: PDFFont,
) => {
  let title = sheet(pdf, spec), edge = spec.bleed + 36
  let y = paragraph(
    title,
    font,
    draft.title,
    edge,
    spec.height * .68,
    24,
    spec.width - 72,
  )
  if (draft.author) {
    paragraph(title, font, draft.author, edge, y - 24, 14, spec.width - 72)
  }
  if (draft.dedication) {
    let page = sheet(pdf, spec)
    paragraph(
      page,
      font,
      draft.dedication,
      edge,
      spec.height * .65,
      12,
      spec.width - 72,
    )
  }
  let size = draft.typography?.size ?? 11
  let leading = draft.typography?.leading ?? size * 1.4
  if (size < 8 || size > 24 || leading < size || leading > 48) {
    throw new Error('Invalid book typography')
  }
  let width = spec.width - 86.4, page: PDFPage | undefined
  let top = spec.height + spec.bleed - 54
  y = 0
  for (let block of marked.lexer(draft.markdown ?? '')) {
    let depth = block.type == 'heading' && 'depth' in block ? block.depth : 0
    let heading = !!depth
    let scale = heading ? (depth == 1 ? 1.6 : 1.25) : 1
    let value = plain(block.raw)
    let lines = value.split('\n').flatMap((line) =>
      wrap(line, font, size * scale, width)
    )
    if (heading && depth == 1) y = 0
    for (let line of lines) {
      if (!page || y < spec.bleed + 54 + leading * scale) {
        page = sheet(pdf, spec)
        y = top
        let n = pdf.getPageCount(), left = spec.bleed + (n % 2 ? 50.4 : 36)
        text(page, font, String(n), page.getWidth() / 2, spec.bleed + 20, 9)
        text(page, font, draft.title.slice(0, 60), left, top + 20, 8)
      }
      let left = spec.bleed + (pdf.getPageCount() % 2 ? 50.4 : 36)
      text(page, font, line, left, y, size * scale)
      y -= leading * scale
    }
    y -= leading * .65
  }
}

let image = (
  pdf: PDFDocument,
  spec: Product,
  bytes: Uint8Array,
  coloring = spec.coloring,
  box?: { width: number; height: number; dpi: number; bleed: boolean },
) =>
  bytes[0] == 0x89
    ? pdf.embedPng(raster(bytes, coloring, box))
    : pdf.embedJpg(bytes)

let picture = async (
  page: PDFPage,
  spec: Product,
  bytes: Uint8Array,
  box: { x: number; y: number; width: number; height: number },
  bleed = false,
  coloring = spec.coloring,
) => {
  let isPdf = new TextDecoder().decode(bytes.subarray(0, 5)) == '%PDF-'
  let input = isPdf
    ? await PDFDocument.load(bytes, { updateMetadata: false })
    : undefined
  if (input && input.getPageCount() != 1) {
    throw new Error('A page asset PDF must contain one page')
  }
  let art = input
    ? (await page.doc.embedPdf(input))[0]
    : await image(page.doc, spec, bytes, coloring, {
      ...box,
      dpi: spec.dpi,
      bleed,
    })
  page.pushOperators(
    pushGraphicsState(),
    rectangle(box.x, box.y, box.width, box.height),
    clip(),
    endPath(),
  )
  let size = fit(art.width, art.height, box, bleed)
  if (art instanceof PDFEmbeddedPage) page.drawPage(art, size)
  else page.drawImage(art, size)
  page.pushOperators(popGraphicsState())
  await art.embed()
}

let imagePages = async (
  pdf: PDFDocument,
  spec: Product,
  draft: Draft,
  read: Read,
  font?: PDFFont,
) => {
  for (let source of draft.pages ?? []) {
    let page = sheet(pdf, spec)
    if (source.kind == 'blank') continue
    if (!source.blob) throw new Error('Page artwork is missing')
    let margin = source.bleed ? 0 : spec.bleed + 36
    let band = source.caption ? 54 : 0
    let box = {
      x: margin,
      y: margin + band,
      width: page.getWidth() - 2 * margin,
      height: page.getHeight() - 2 * margin - band,
    }
    await picture(page, spec, await read(source.blob), box, !!source.bleed)
    if (source.caption) {
      if (!font) throw new Error('Captions need an embedded font')
      let lines = wrap(source.caption, font, 11, spec.width - 72)
      if (lines.length > 3) {
        throw new Error('Page caption does not fit its print band')
      }
      paragraph(
        page,
        font,
        source.caption,
        spec.bleed + 36,
        spec.bleed + 45,
        11,
        spec.width - 72,
      )
    }
  }
}

let cover = async (spec: Product, draft: Draft, pages: number, read: Read) => {
  let pdf = await fresh(), box = geometry(spec, pages)
  let page = pdf.addPage([box.width, box.height])
  let font = await face(pdf, draft, read)
  let panel = (x: number) => ({
    x,
    y: 0,
    width: spec.width + box.edge,
    height: box.height,
  })
  if (draft.back) {
    await picture(page, spec, await read(draft.back), panel(0), true, false)
  }
  if (draft.front) {
    await picture(
      page,
      spec,
      await read(draft.front),
      {
        ...panel(box.front - box.spine - 18),
        width: spec.width + box.edge + box.spine + 18,
      },
      true,
      false,
    )
  }
  let safe = box.safe, titleY = box.height - box.edge - safe - 24
  paragraph(
    page,
    font,
    draft.title,
    box.front + safe,
    titleY,
    24,
    spec.width - 2 * safe,
  )
  if (draft.author) {
    paragraph(
      page,
      font,
      draft.author,
      box.front + safe,
      box.edge + safe,
      13,
      spec.width - 2 * safe,
    )
  }
  if (draft.backText) {
    let lines = wrap(draft.backText, font, 11, spec.width - 2 * safe)
    if (lines.length * 16 > spec.height - 2 * safe) {
      throw new Error('Back cover text does not fit')
    }
    paragraph(
      page,
      font,
      draft.backText,
      box.edge + safe,
      titleY,
      11,
      spec.width - 2 * safe,
      16,
    )
  }
  let run = draft.title + (draft.author ? ' · ' + draft.author : '')
  let requested = 10, length = font.widthOfTextAtSize(run, requested)
  let size = Math.min(
    requested,
    Math.floor(requested * (spec.height - 72) / length * 10) / 10,
  )
  if (box.text && size >= 9) {
    page.drawText(run, {
      font,
      size,
      color: grayscale(0),
      x: box.edge + spec.width + box.spine / 2 - size / 3,
      y: box.height / 2 - font.widthOfTextAtSize(run, size) / 2,
      rotate: degrees(90),
    })
  }
  return pdf.save()
}

export let compose = async (spec: Product, draft: Draft, read: Read) => {
  if (!!draft.interior != !!draft.cover) {
    throw new Error('Upload both interior and cover PDFs')
  }
  if (draft.interior && draft.cover) {
    return {
      interior: await read(draft.interior),
      cover: await read(draft.cover),
    }
  }
  if (!!draft.markdown == !!draft.pages?.length) {
    throw new Error('Choose Markdown or ordered page artwork')
  }
  let pdf = await fresh()
  let font = draft.markdown || draft.pages?.some((p) => p.caption)
    ? await face(pdf, draft, read)
    : undefined
  if (draft.markdown && font) textPages(pdf, spec, draft, font)
  else await imagePages(pdf, spec, draft, read, font)
  let content = pdf.getPageCount(), pages = count(spec, content)
  while (pdf.getPageCount() < pages) sheet(pdf, spec)
  return {
    interior: await pdf.save(),
    cover: await cover(spec, draft, pages, read),
    content,
  }
}
