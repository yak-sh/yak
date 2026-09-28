// An app's own worker, run in workerd: the shim, the app's worker.js and the
// wasm it imports, linked by the runtime the account would run them in.
// Everything else about dispatch is dispatch_test.ts's, at the seam.

import { assertEquals } from '@std/assert'
import { SHIM } from './dispatch.ts'
import { connector, script, seed, workerd } from './probe.ts'

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

Deno.test('workerd serves a file through the cached FILES entrypoint', async () => {
  let k = workerd()
  let space = 'filebindprobe'
  let { cookie } = await seed(k, [{ slug: space, apps: ['assets'] }])
  let agent = connector(k, cookie)
  await agent.tool('app_files', {
    space,
    app: 'assets',
    path: 'index.html',
    content: 'a cached page',
  })
  await agent.tool('app_deploy', { space, app: 'assets' })
  let r = await k.at(`${space}.yaks.app`, '/assets/index.html')
  assertEquals(r.status, 200)
  assertEquals((await r.text()).includes('a cached page'), true)
  let app = await script({
    '__yak_entry.js': SHIM,
    'worker.js': `export default {
      fetch(req, env) {
        return env.FILES.fetch('/index.html')
      }
    }`,
    'probe.js': `import app from './__yak_entry.js'
      export default {
        fetch(req, env, ctx) {
          return app.fetch(new Request(
            'https://${space}.yaks.app/assets/read',
            { headers: { 'x-yak-app': 'assets' } },
          ), env, ctx)
        }
      }`,
  }, 'probe.js')
  let nested = await app.at('/read')
  assertEquals(nested.status, 200)
  assertEquals((await nested.text()).includes('a cached page'), true)
})
