// An app's own worker, run in workerd: the shim, the app's worker.js and the
// wasm it imports, linked by the runtime the account would run them in.
// Everything else about dispatch is dispatch_test.ts's, at the seam.

import { assertEquals } from '@std/assert'
import { SHIM } from './dispatch.ts'
import { script } from './probe.ts'

let fixture = (name: string) =>
  Deno.readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

let WASM = fixture('add.wasm')

let APP = fixture('worker.js')

/**
 * And the modules run. A dispatch namespace has no local implementation, so
 * what the account would run cannot be exercised here; this runs the same
 * module set — the shim, the app's worker.js, and the wasm it imports — in
 * the same runtime (probe.ts `script`), which is where a mislabelled or
 * missing module shows itself. The upload's own shape is dispatch_test.ts's,
 * against the API's documented multipart form.
 */
Deno.test('workerd links the shim, the app, and its wasm', async () => {
  let w = await script({
    '__yak_entry.js': SHIM,
    'worker.js': new TextDecoder().decode(APP),
    'add.wasm': WASM,
  }, '__yak_entry.js')
  let r = await w.at('/api/add?a=2&b=3')
  assertEquals(r.status, 200)
  assertEquals(await r.text(), '5')
  // The worker's 404 is the pass verdict the kernel reads (`ran`), so the
  // fixture answers one for everything that is not its route.
  let pass = await w.at('/index.html')
  assertEquals(pass.status, 404)
  await pass.body?.cancel()
})
