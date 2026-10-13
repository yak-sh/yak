// yak-raster's runtime entry: resvg's WebAssembly, imported the way wrangler
// uploads it (a compiled module) and started on the first drawing, then
// draw.ts. Deno has no such import, so the repo's type check leaves this one
// file out (deno.json `exclude`); everything a test reaches is in draw.ts.
import { initWasm } from '@resvg/resvg-wasm'
import wasm from '@resvg/resvg-wasm/index_bg.wasm'
import { draw } from './draw.ts'

let ready: Promise<void> | undefined

export default {
  fetch: async (req: Request): Promise<Response> => {
    await (ready ??= initWasm(wasm))
    return draw(req)
  },
}
