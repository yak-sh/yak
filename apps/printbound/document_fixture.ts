import { PDFiumLibrary } from '@hyzyla/pdfium'
import { createRequire } from 'node:module'
import { pdf } from '../../workers/yak/raster/pdf.ts'
import { type DocumentIO, hash } from './document.ts'
import { font } from './font_fixture.ts'
import { type Product } from './layout.ts'

let wasm = await WebAssembly.compile(
  await Deno.readFile(
    createRequire(import.meta.url).resolve('@hyzyla/pdfium/pdfium.wasm'),
  ),
)
export let library = await PDFiumLibrary.init({
  instantiateWasm: (imports, success) => {
    let instance = new WebAssembly.Instance(wasm, imports)
    success(instance, wasm)
    return instance.exports
  },
})

export let spec: Product = {
  id: 'fixture',
  sku: 'fixture',
  width: 216,
  height: 288,
  bleed: 9,
  binding: 'saddle',
  minimum: 4,
  multiple: 4,
  maximum: 48,
  ppi: 444,
  dpi: 1,
  coloring: false,
}
export let fixture = () => {
  let blobs = new Map<string, Uint8Array>([['font', font]])
  let calls: { bytes: Uint8Array; page: number }[] = []
  let io: DocumentIO = {
    read: (id) => {
      let bytes = blobs.get(id)
      if (!bytes) throw new Error('Fixture source missing: ' + id)
      return Promise.resolve(bytes.slice())
    },
    put: async (bytes) => {
      let id = await hash(bytes)
      blobs.set(id, bytes.slice())
      return id
    },
    preview: async (bytes, page) => {
      calls.push({ bytes: bytes.slice(), page })
      let res = await pdf(
        new Request('https://raster/pdf?page=' + page + '&render=1', {
          method: 'POST',
          body: new Uint8Array(bytes),
        }),
        library,
      )
      if (!res.ok) throw new Error(await res.text())
      let result = await res.json()
      return {
        image: Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0)),
        color: result.color,
      }
    },
  }
  return { blobs, calls, io }
}
