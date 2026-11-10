import { createRequire } from 'node:module'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { decode } from 'fast-png'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { pdf } from './pdf.ts'

let wasm = await WebAssembly.compile(
  await Deno.readFile(
    createRequire(import.meta.url).resolve('@hyzyla/pdfium/pdfium.wasm'),
  ),
)
let library = await PDFiumLibrary.init({
  instantiateWasm: (imports, success) => {
    let instance = new WebAssembly.Instance(wasm, imports)
    success(instance, wasm)
    return instance.exports
  },
})

let stream = (body: string) =>
  `<< /Length ${body.length} >>\nstream\n${body}\nendstream`

let document = (objects: string[]) => {
  let body = '%PDF-1.4\n'
  let offsets = [0]
  for (let [i, object] of objects.entries()) {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  }
  let xref = body.length
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  body += offsets.slice(1).map((n) =>
    `${String(n).padStart(10, '0')} 00000 n \n`
  ).join('')
  return new TextEncoder().encode(
    body +
      `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  )
}

let bytes = document([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 36] /Resources << /Font << /F 5 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 36] /Rotate 90 /Resources << /Font << /F 5 0 R >> /XObject << /I 8 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  stream('BT /F 10 Tf 5 15 Td (First page) Tj ET'),
  stream('q 72 0 0 36 0 0 cm /I Do Q BT /F 5 Tf 2 2 Td (Label) Tj ET'),
  '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nff0000>\nendstream',
])

let posted = (query = '') =>
  pdf(
    new Request(`https://raster/pdf${query}`, {
      method: 'POST',
      body: bytes,
    }),
    library,
  )
let count = await (await posted()).json()
let first = await (await posted('?page=1')).json()
let second = await (await posted('?page=2')).json()
let image = decode(Uint8Array.from(atob(second.image), (c) => c.charCodeAt(0)))

test('PDF pages expose their native text independently', () => {
  assertEquals(count, { pages: 2 })
  assertEquals(first.pages, 2)
  assertStringIncludes(first.text, 'First page')
  assertEquals(first.image, undefined)
  assertStringIncludes(second.text, 'Label')
})

test('a page containing an image renders the whole rotated page for OCR', () => {
  assertEquals([image.width, image.height], [72, 144])
  let center =
    (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) *
    image.channels
  assertEquals([...image.data.slice(center, center + 3)], [255, 0, 0])
})

test('a requested PDF page must exist', async () => {
  assertEquals((await posted('?page=0')).status, 400)
  assertEquals((await posted('?page=3')).status, 422)
})

test('an explicit page preview renders native text without changing OCR extraction', async () => {
  let shown = await (await posted('?page=1&render=1')).json()
  let image = decode(
    Uint8Array.from(atob(shown.image), (c) => c.charCodeAt(0)),
  )
  assertEquals([image.width, image.height], [144, 72])
  assertStringIncludes(shown.text, 'First page')
  assertEquals(first.image, undefined)
})
