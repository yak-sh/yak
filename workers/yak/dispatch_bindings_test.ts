import { assertEquals, assertRejects } from '@std/assert'
import { drop, dropSecret, secrets, setSecret, upload } from './dispatch.ts'
import type { Env } from './env.ts'

let env = { CF_ACCOUNT: 'acct', CF_WORKERS_TOKEN: 'test-token' } as Env
let modules = [{
  name: 'worker.js',
  bytes: new TextEncoder().encode('export default { fetch() {} }'),
}]
let history = [
  { tag: 'v1', new_sqlite_classes: ['Room'] },
  { tag: 'v2', renamed_classes: [{ from: 'Room', to: 'Hall' }] },
]

Deno.test('staging app workers and their secrets stay in their own namespace', async () => {
  let was = globalThis.fetch
  let methods: string[] = []
  let staged = {
    ...env,
    DISPATCH_NAMESPACE: 'yak-apps-staging',
    WORKER_NAME: 'yak-staging',
  }
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    let req = new Request(input as string, init)
    let path = new URL(req.url).pathname
    assertEquals(
      path.split('/scripts/')[0],
      '/client/v4/accounts/acct/workers/dispatch/namespaces/yak-apps-staging',
    )
    methods.push(req.method)
    if (req.method == 'PUT' && !path.endsWith('/secrets')) {
      let body = await req.formData()
      let sent = JSON.parse(await (body.get('metadata') as File).text())
      assertEquals(sent.bindings, [{
        type: 'service',
        name: 'KERNEL',
        service: 'yak-staging',
      }])
    }
    return Response.json({ success: true, result: [] })
  }) as typeof fetch
  try {
    await upload(staged, 'app.abc123', modules)
    await setSecret(staged, 'app.abc123', 'TOKEN', 'value')
    await secrets(staged, 'app.abc123')
    await dropSecret(staged, 'app.abc123', 'TOKEN')
    await drop(staged, 'app.abc123')
    assertEquals(methods, ['PUT', 'PUT', 'GET', 'DELETE', 'DELETE'])
  } finally {
    globalThis.fetch = was
  }
})

// The current tag comes from the dispatch script, not from a locally assumed
// deploy. That matters after retries and after restoring an older file set.
Deno.test('upload sends only migrations after the dispatch script tag', async () => {
  for (let current of ['', 'v1', 'v2', 'unknown']) {
    let was = globalThis.fetch
    let methods: string[] = []
    let sent: Record<string, unknown> = {}
    globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
      let req = new Request(input as string, init)
      methods.push(req.method)
      assertEquals(
        new URL(req.url).pathname,
        '/client/v4/accounts/acct/workers/dispatch/namespaces/yak-apps/scripts/app_abc123',
      )
      if (req.method == 'GET') {
        return current
          ? Response.json({
            success: true,
            result: { script: { migration_tag: current } },
          })
          : new Response(null, { status: 404 })
      }
      let body = await req.formData()
      sent = JSON.parse(await (body.get('metadata') as File).text())
      assertEquals((body.get('custom.js') as File).name, 'custom.js')
      return Response.json({ success: true, result: { version_id: 'release' } })
    }) as typeof fetch
    try {
      let run = () =>
        upload(env, 'app.abc123', modules, {
          main: 'custom.js',
          migrations: history,
        })
      if (current == 'unknown') {
        await assertRejects(run, Error, 'keep previously applied tags')
        assertEquals(methods, ['GET'])
      } else {
        assertEquals(await run(), 'release')
        assertEquals(methods, ['GET', 'PUT'])
        assertEquals(
          sent.migrations,
          current == 'v2' ? undefined : {
            ...(current ? { old_tag: current } : {}),
            new_tag: 'v2',
            steps: history.slice(current ? 1 : 0).map((
              { tag: _tag, ...step },
            ) => step),
          },
        )
        assertEquals(sent.keep_bindings, ['secret_text'])
      }
    } finally {
      globalThis.fetch = was
    }
  }
})

Deno.test('upload refuses a module that would replace the wrapper', async () => {
  await assertRejects(
    () =>
      upload(env, 'app.abc123', [
        ...modules,
        { ...modules[0], name: 'entry.js' },
      ]),
    Error,
    'distinct module names',
  )
})

Deno.test('only permanent deletion removes a script owning Durable Objects', async () => {
  let was = globalThis.fetch
  let forced: (string | null)[] = []
  globalThis.fetch = ((input: string | Request, init?: RequestInit) => {
    let req = new Request(input as string, init)
    assertEquals(req.method, 'DELETE')
    forced.push(new URL(req.url).searchParams.get('force'))
    return Promise.resolve(Response.json({ success: true, result: {} }))
  }) as typeof fetch
  try {
    await drop(env, 'app.abc123')
    await drop(env, 'app.abc123', true)
    assertEquals(forced, [null, 'true'])
  } finally {
    globalThis.fetch = was
  }
})
