// Each renderer's WebAssembly is uploaded as a compiled module and started
// on its first request. Deno has no such import, so this runtime entry is
// excluded from its check; draw.ts and pdf.ts take the renderers in process.
import { initWasm } from '@resvg/resvg-wasm'
import wasm from '@resvg/resvg-wasm/index_bg.wasm'
import { draw } from './draw.ts'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import pdfWasm from '@hyzyla/pdfium/pdfium.wasm'
import { pdf } from './pdf.ts'

let ready: Promise<void> | undefined
let pdfReady: Promise<PDFiumLibrary> | undefined
let library = () => pdfReady ??= PDFiumLibrary.init({
  instantiateWasm: (imports, success) => {
    let instance = new WebAssembly.Instance(pdfWasm, imports)
    success(instance, pdfWasm)
    return instance.exports
  },
})

export default {
  fetch: async (req: Request): Promise<Response> => {
    if (new URL(req.url).pathname == '/pdf') return pdf(req, await library())
    await (ready ??= initWasm(wasm))
    return draw(req)
  },
}
