import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
} from 'pdf-lib'
import type { Product } from './layout.ts'
import { count, geometry } from './layout.ts'

export type Image = {
  width: number
  height: number
  dpi: number
  color: string
}
export type Inspected = {
  number: number
  width: number
  height: number
  fonts: string[]
  images: Image[]
}
let name = (s: string) => PDFName.of(s)
let dict = (d: PDFDict | undefined, key: string) =>
  d?.lookupMaybe(name(key), PDFDict)
let num = (d: PDFDict, key: string) => d.lookup(name(key), PDFNumber).asNumber()
let label = (d: PDFDict, key: string) => d.lookup(name(key))?.toString() ?? ''
let embedded = (font: PDFDict): boolean => {
  if (label(font, 'Subtype') == '/Type3') return !!dict(font, 'CharProcs')
  let children = font.lookupMaybe(name('DescendantFonts'), PDFArray)
  if (children) {
    return children.asArray().every((_, i) =>
      embedded(children.lookup(i, PDFDict))
    )
  }
  let descriptor = dict(font, 'FontDescriptor')
  return ['FontFile', 'FontFile2', 'FontFile3'].some((key) =>
    descriptor?.lookup(name(key)) instanceof PDFStream
  )
}

type Matrix = number[]
let identity = () => [1, 0, 0, 1, 0, 0]
let multiply = (a: Matrix, b: Matrix) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

// Content operands are lexed independently of whitespace, compressed streams,
// strings and object-stream serialization. Strings/arrays cannot introduce Do
// or cm operators. pdf-lib resolves the document objects and stream filters.
let tokens = function* (text: string): Generator<string> {
  let i = 0
  let skip = (close: string) => {
    while (i < text.length && text[i] != close) {
      if (text[i] == '\\') i++
      else if (text[i] == '(') {
        i++
        skip(')')
        continue
      }
      i++
    }
    if (i >= text.length) throw new Error('Unterminated PDF content operand')
    i++
  }
  while (i < text.length) {
    let c = text[i++]
    if (/\s/.test(c)) continue
    if (c == '%') {
      while (i < text.length && !/[\r\n]/.test(text[i])) i++
      continue
    }
    if (c == '(') {
      skip(')')
      yield ''
      continue
    }
    if (c == '<' && text[i] != '<') {
      skip('>')
      yield ''
      continue
    }
    if ('[]<>'.includes(c)) {
      yield c
      continue
    }
    let start = i - 1
    while (i < text.length && !/[\s()[\]<>/%]/.test(text[i])) i++
    yield text.slice(start, i)
  }
}

let content = (stream: PDFRawStream) =>
  new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())
let streams = (page: import('pdf-lib').PDFPage) => {
  let value = page.node.Contents()
  return value instanceof PDFArray
    ? value.asArray().map((_, i) => value.lookup(i, PDFRawStream))
    : value instanceof PDFRawStream
    ? [value]
    : []
}

let resources = (
  r: PDFDict | undefined,
  seen = new Set<PDFDict>(),
): string[] => {
  if (!r || seen.has(r)) return []
  seen.add(r)
  let out: string[] = []
  for (let [, value] of dict(r, 'Font')?.entries() ?? []) {
    let font = r.context.lookup(value, PDFDict)
    let title = label(font, 'BaseFont') || label(font, 'Subtype')
    if (!embedded(font)) throw new Error('PDF font is not embedded: ' + title)
    out.push(title)
  }
  for (let [, value] of dict(r, 'XObject')?.entries() ?? []) {
    let object = r.context.lookup(value, PDFStream)
    out.push(...resources(dict(object.dict, 'Resources'), seen))
  }
  for (let [, value] of dict(r, 'ExtGState')?.entries() ?? []) {
    let state = r.context.lookup(value, PDFDict)
    for (let key of ['ca', 'CA']) {
      let opacity = state.lookupMaybe(name(key), PDFNumber)?.asNumber() ?? 1
      if (opacity != 1) throw new Error('PDF transparency must be flattened')
    }
    if (state.has(name('SMask')) && label(state, 'SMask') != '/None') {
      throw new Error('PDF transparency must be flattened')
    }
  }
  return [...new Set(out)]
}

let artwork = (
  text: string,
  r: PDFDict | undefined,
  matrix = identity(),
  active = new Set<PDFRawStream>(),
): Image[] => {
  let stack: Matrix[] = [], args: string[] = [], out: Image[] = []
  let depth = 0
  for (let op of tokens(text)) {
    if (op == '[' || op == '<') {
      depth++
      continue
    }
    if (op == ']' || op == '>') {
      depth--
      continue
    }
    if (depth) continue
    if (op == 'BI') {
      throw new Error('Inline PDF images must be embedded as XObjects')
    }
    if (op == 'q') stack.push([...matrix])
    else if (op == 'Q') {
      let restored = stack.pop()
      if (!restored) throw new Error('Unbalanced PDF graphics state')
      matrix = restored
    } else if (op == 'cm') {
      let m = args.slice(-6).map(Number)
      if (m.length != 6 || m.some((n) => !Number.isFinite(n))) {
        throw new Error('Invalid PDF transform')
      }
      matrix = multiply(matrix, m)
    } else if (op == 'Do') {
      let object = dict(r, 'XObject')?.lookup(
        name(args.at(-1)?.slice(1) ?? ''),
      )
      if (!(object instanceof PDFRawStream)) {
        throw new Error('PDF artwork is missing')
      }
      if (label(object.dict, 'Subtype') == '/Image') {
        if (object.dict.has(name('SMask'))) {
          throw new Error('PDF artwork transparency must be flattened')
        }
        let width = num(object.dict, 'Width'),
          height = num(object.dict, 'Height')
        let dpi = Math.min(
          width / Math.hypot(matrix[0], matrix[1]),
          height / Math.hypot(matrix[2], matrix[3]),
        ) * 72
        out.push({
          width,
          height,
          dpi,
          color: label(object.dict, 'ColorSpace'),
        })
      } else {
        if (active.has(object)) throw new Error('Recursive PDF artwork')
        let m = object.dict.lookupMaybe(name('Matrix'), PDFArray)
        let transform = m
          ? m.asArray().map((_, i) => m.lookup(i, PDFNumber).asNumber())
          : identity()
        out.push(
          ...artwork(
            content(object),
            dict(object.dict, 'Resources') ?? r,
            multiply(matrix, transform),
            new Set([...active, object]),
          ),
        )
      }
    } else if (op == '' || op.startsWith('/') || Number.isFinite(Number(op))) {
      args.push(op)
      continue
    }
    args = []
  }
  if (stack.length || depth) throw new Error('Unbalanced PDF content')
  return out
}

export let inspect = async (bytes: Uint8Array): Promise<Inspected[]> => {
  let pdf = await PDFDocument.load(bytes, {
    updateMetadata: false,
    throwOnInvalidObject: true,
  })
  if (pdf.isEncrypted) {
    throw new Error('PDF security must be removed before printing')
  }
  return pdf.getPages().map((page, index) => {
    let { width, height } = page.getSize()
    let crop = page.getCropBox()
    if (
      page.getRotation().angle % 360 || crop.width != width ||
      crop.height != height
    ) {
      throw new Error('PDF page rotation and crop must match the print sheet')
    }
    let r = page.node.Resources()
    return {
      number: index + 1,
      width,
      height,
      fonts: resources(r),
      images: artwork(streams(page).map(content).join('\n'), r),
    }
  })
}

export let preflight = (
  spec: Product,
  interior: Inspected[],
  cover: Inspected[],
) => {
  if (count(spec, interior.length) != interior.length) {
    throw new Error('Interior needs binding padding')
  }
  let wrap = geometry(spec, interior.length)
  if (cover.length != 1) {
    throw new Error('Cover must be one complete wraparound page')
  }
  for (
    let [pages, width, height] of [
      [interior, spec.width + 2 * spec.bleed, spec.height + 2 * spec.bleed],
      [cover, wrap.width, wrap.height],
    ] satisfies [Inspected[], number, number][]
  ) {
    for (let page of pages) {
      if (
        Math.abs(page.width - width) > .1 || Math.abs(page.height - height) > .1
      ) {
        throw new Error(
          'PDF page ' + page.number + ' has incorrect print dimensions',
        )
      }
      if (page.images.some((image) => image.dpi + .1 < spec.dpi)) {
        throw new Error(
          'PDF page ' + page.number + ' artwork is below ' + spec.dpi + ' dpi',
        )
      }
    }
  }
}
