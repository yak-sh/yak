import { assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { upload } from './dispatch.ts'
import type { Env } from './env.ts'
import { script } from './probe.ts'

// A dispatch namespace is remote-only. The API is stood in for at fetch, as
// in dispatch_test.ts; its uploaded bytes then run in workerd, where missing
// class exports and bindings lost by the shim can no longer hide in metadata.
slow(
  'the uploaded shim keeps local classes and the app bindings in workerd',
  async () => {
    let files: Record<string, string> = {}
    let main = ''
    let was = globalThis.fetch
    globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
      let body = await new Request(input as string, init).formData()
      let meta = JSON.parse(await (body.get('metadata') as File).text())
      main = meta.main_module
      for (let [name, part] of body) {
        if (name != 'metadata') files[name] = await (part as File).text()
      }
      return Response.json({ success: true, result: { version_id: 'v1' } })
    }) as typeof fetch
    try {
      await upload(
        { CF_ACCOUNT: 'acct', CF_WORKERS_TOKEN: 'test-token' } as Env,
        'app.abc123',
        [{
          name: 'worker.js',
          bytes: new TextEncoder().encode(`
          export class Counter { value() { return 7 } }
          export default {
            fetch(req, env) {
              return Response.json({
                label: env.LABEL,
                json: env.SETTINGS,
                resources: [env.DB.id, env.MEDIA.id, env.SEARCH.id, env.AI.id],
                grant: req.headers.get('x-yak-grant'),
                doors: ['STORE', 'APP', 'FILES'].every(name => typeof env[name].fetch == 'function'),
              })
            },
          }
        `),
        }],
      )
    } finally {
      globalThis.fetch = was
    }
    files['probe.js'] = `
    import app, { Counter } from './${main}'
    export default {
      async fetch(req) {
        let result = await app.fetch(req, {
          LABEL: 'hello', SETTINGS: { enabled: true },
          DB: { id: 'd1' }, MEDIA: { id: 'r2' },
          SEARCH: { id: 'vectorize' }, AI: { id: 'ai' },
          KERNEL: { fetch() { throw new Error('no store call expected') } },
        }, {})
        return Response.json({ ...await result.json(), count: new Counter().value() })
      },
    }
  `
    let worker = await script(files, 'probe.js')
    try {
      let response = await worker.at('/', {
        headers: { 'x-yak-grant': 'private' },
      })
      assertEquals(response.status, 200)
      assertEquals(await response.json(), {
        label: 'hello',
        json: { enabled: true },
        resources: ['d1', 'r2', 'vectorize', 'ai'],
        grant: null,
        doors: true,
        count: 7,
      })
    } finally {
      await worker.stop()
    }
  },
)
