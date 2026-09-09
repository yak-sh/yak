import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import * as apps from './apps.ts'
import { resourceName, SCOPES } from './bindings.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { platform } from './harness.ts'
import { meta } from './meta.ts'
import { call, type Ctx } from './tools.ts'

let PERSON = 'a0000000-0000-4000-8000-0000000000ad'
let who = { 'x-yak-person': PERSON, 'x-yak-role': 'owner' }
let where = { space: 'ada', app: 'cookbook' }
let configuration = {
  main: 'dist/server.mjs',
  compatibility_date: '2026-01-01',
  vars: { TITLE: 'Cookbook', SETTINGS: { shared: false } },
  d1_databases: [{ binding: 'DB', database_id: 'somebody-elses-database' }],
  r2_buckets: [{ binding: 'MEDIA', bucket_name: 'somebody-elses-bucket' }],
  vectorize: [{
    binding: 'SEARCH',
    index_name: 'somebody-elses-index',
    dimensions: 3,
    metric: 'cosine',
  }],
}

// The tools, directory, and app store run together, as in serving_test.ts.
// Only Cloudflare's account API is replaced: its resources and multipart
// uploads are the effects this lifecycle test needs to inspect.
let fixture = async () => {
  let { env } = platform('bindings-probe', {
    CF_ACCOUNT: 'acct',
    CF_WORKERS_TOKEN: 'test-token',
  })
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  await dir.apply({
    entities: [
      { entity: { eid: PERSON }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'Ada' },
        space: { slug: 'ada' },
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: PERSON, role: 'owner' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'Cookbook' },
        app: {
          slug: 'cookbook',
          space: '$space',
          store: 'ada/cookbook.abc123',
          version: 0,
          access: 'public',
        },
        former: { slug: 'cookbook' },
      },
    ],
  }, who)
  let ctx = { env, dir, person: PERSON } as Ctx
  let space = (await dir.space('ada'))!
  let app = (await dir.app(space, 'cookbook'))!
  let tool = async (name: string, args: Record<string, unknown> = {}) =>
    (await call(ctx, name, { ...where, ...args })).text
  let write = (config: unknown, path = 'wrangler.jsonc') =>
    tool('app_files', {
      files: [
        { path: 'index.html', content: '<h1>The files keep serving</h1>' },
        { path: 'worker.js', content: 'export default { fetch() {} }' },
        { path: 'dist/server.mjs', content: 'export default { fetch() {} }' },
        { path, content: JSON.stringify(config) },
      ],
    })
  let calls: { method: string; path: string; body: Record<string, unknown> }[] =
    []
  let uploads: Record<string, unknown>[] = []
  let uploadedFiles: FormData[] = []
  let state = {
    fail: '',
    objects: new Set<string>(),
    scripts: new Set<string>(),
    beforeCreate: undefined as (() => Promise<unknown>) | undefined,
    beforeUploadReply: undefined as (() => Promise<unknown>) | undefined,
  }
  let resources = new Map<string, Record<string, unknown>>()
  let was = globalThis.fetch
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    let request = new Request(input as string, init)
    let url = new URL(request.url)
    if (url.hostname != 'api.cloudflare.com') return was(request)
    let path = url.pathname.replace('/client/v4/accounts/acct', '')
    let multipart = request.headers.get('content-type')?.startsWith(
      'multipart/',
    )
    let form = multipart ? await request.formData() : undefined
    if (form) uploadedFiles.push(form)
    let body = form
      ? JSON.parse(await (form.get('metadata') as File).text())
      : request.method == 'POST'
      ? await request.json()
      : {}
    calls.push({ method: request.method, path, body })
    if (state.fail && path.includes(state.fail)) {
      return Response.json({
        success: false,
        errors: [{
          code: 10000,
          message: 'Authentication error: test-token\n',
        }],
      }, { status: 403 })
    }
    let result: Record<string, unknown> = {}
    if (multipart) {
      let before = state.beforeUploadReply
      state.beforeUploadReply = undefined
      await before?.()
      uploads.push(body)
      state.scripts.add(path)
      result = { version_id: `worker-${uploads.length}` }
    } else if (request.method == 'POST') {
      let before = state.beforeCreate
      state.beforeCreate = undefined
      await before?.()
      result = path == '/d1/database'
        ? { uuid: 'owned-database-id', name: body.name }
        : { name: body.name, config: body.config }
      resources.set(`${path}/${result.uuid ?? result.name}`, result)
    } else if (path.includes('/objects')) {
      if (request.method == 'GET') {
        return Response.json({
          success: true,
          result: [...state.objects].map((key) => ({ key })),
        })
      }
      state.objects.delete(decodeURIComponent(path.split('/objects/')[1]))
    } else if (request.method == 'GET') {
      if (path == '/d1/database') {
        return Response.json({
          success: true,
          result: [...resources.values()].filter((r) =>
            r.uuid && r.name == url.searchParams.get('name')
          ),
        })
      }
      let found = resources.get(path)
      return found
        ? Response.json({ success: true, result: found })
        : Response.json({ success: false, result: null }, { status: 404 })
    } else if (request.method == 'DELETE') {
      resources.delete(path)
      state.scripts.delete(path)
    }
    return Response.json({ success: true, errors: [], result })
  }) as typeof fetch
  return {
    env,
    dir,
    app,
    tool,
    write,
    calls,
    uploads,
    uploadedFiles,
    resources,
    state,
    rows: (q: string) => meta(env).query(q),
    done: () => void (globalThis.fetch = was),
  }
}

Deno.test('app bindings survive redeploy, removal and trash until permanent deletion', async () => {
  let k = await fixture()
  try {
    await k.write(configuration)
    let deployed = await k.tool('app_deploy')
    let creates = () => k.calls.filter((c) => c.method == 'POST')
    assertEquals(creates().length, 3)
    let names = creates().map((c) => String(c.body.name))
    assertEquals(new Set(names).size, 3)
    for (let name of names) {
      assertStringIncludes(deployed, name)
      assertStringIncludes(await k.tool('app_list'), name)
    }
    for (let name of ['DB', 'MEDIA', 'SEARCH']) {
      assertStringIncludes(deployed, name)
    }
    let metadata = k.uploads[0]
    assertEquals(metadata.main_module, '__yak_entry.js')
    assertEquals(metadata.compatibility_date, '2026-01-01')
    assertEquals(metadata.keep_bindings, ['secret_text'])
    assertEquals(JSON.stringify(metadata).includes('somebody-elses'), false)
    assertStringIncludes(deployed, 'database_id')
    assertStringIncludes(deployed, 'bucket_name')
    assertStringIncludes(deployed, 'index_name')

    await k.tool('app_deploy')
    assertEquals(creates().length, 3, 'redeploy created duplicate resources')
    assertEquals(k.uploads[1], metadata)

    await k.write({ ...configuration, r2_buckets: [] })
    let removed = await k.tool('app_deploy')
    let bindings = k.uploads[2].bindings as { name: string }[]
    assertEquals(bindings.some((b) => b.name == 'MEDIA'), false)
    assertStringIncludes(removed, 'MEDIA')
    assertStringIncludes(removed, 'kept')
    assertEquals(k.calls.filter((c) => c.method == 'DELETE').length, 0)
    assertEquals((await k.rows('.binding!')).length, 3)

    await k.tool('app_delete')
    assertEquals(k.calls.filter((c) => c.method == 'DELETE').length, 0)
    await k.tool('app_restore')
    await k.write(configuration)
    await k.tool('app_deploy')
    assertEquals(creates().length, 3)
    await k.tool('app_delete', { forever: true })
    let deleted = k.calls.filter((c) => c.method == 'DELETE')
    for (
      let path of ['/d1/database/', '/r2/buckets/', '/vectorize/v2/indexes/']
    ) {
      assert(deleted.some((c) => c.path.startsWith(path)), path)
    }
    assertEquals((await k.rows('.binding!')).length, 0)
  } finally {
    k.done()
  }
})

Deno.test('a static app may deploy its browser entry.js', async () => {
  let k = await fixture()
  try {
    await k.tool('app_files', {
      files: [
        { path: 'index.html', content: '<script src="./entry.js"></script>' },
        { path: 'entry.js', content: 'document.title = "Cookbook"' },
      ],
    })
    let result = await k.tool('app_deploy')
    assertEquals(result.includes('refused main'), false)
    assertEquals(k.uploads, [])
    assertEquals(k.resources.size, 0)
    let response = await apps.fetch(
      new Request('https://ada.yaks.app/cookbook/entry.js'),
      k.env,
    )
    assertEquals(response.status, 200)
    assertEquals(await response.text(), 'document.title = "Cookbook"')
  } finally {
    k.done()
  }
})

// Deletion runs before the in-flight API call creates its remote effect.
// The late reply must compensate, since deletion could not see that resource.
for (let phase of ['beforeCreate', 'beforeUploadReply'] as const) {
  Deno.test(`permanent deletion cleans a late ${phase == 'beforeCreate' ? 'resource creation' : 'worker upload'}`, async () => {
    let k = await fixture()
    try {
      await k.write(configuration)
      k.state[phase] = () => k.tool('app_delete', { forever: true })
      await assertRejects(() => k.tool('app_deploy'))
      assertEquals(await k.rows(`.eid=${k.app.eid}&.app!`), [])
      assertEquals(await k.rows('.binding!'), [])
      assertEquals(k.resources.size, 0)
      assertEquals(k.state.scripts.size, 0)
    } finally {
      k.done()
    }
  })
}

Deno.test('resource names fit every product and distinguish normalized binding names', async () => {
  let store = `app.${'a'.repeat(64)}`
  let names = await Promise.all(
    ['DB', 'db', 'D_B', 'D-B', 'B'.repeat(64)].map((name) =>
      resourceName(store, name)
    ),
  )
  assertEquals(new Set(names).size, names.length)
  for (let name of names) assert(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name))
  assertEquals(await resourceName(store, 'DB'), names[0])
  assert(await resourceName('app.bbb', 'DB') != names[0])
})

Deno.test('a refused provisioning scope leaves files serving and uploads no worker', async () => {
  for (
    let [path, scope, config] of [
      ['/d1/', 'D1 Edit', { d1_databases: configuration.d1_databases }],
      ['/r2/', 'R2 Edit', { r2_buckets: configuration.r2_buckets }],
      ['/vectorize/', 'Vectorize Edit', { vectorize: configuration.vectorize }],
    ] as const
  ) {
    let k = await fixture()
    try {
      k.state.fail = path
      await k.write(config)
      let result = await k.tool('app_deploy')
      assertStringIncludes(result, scope)
      assertStringIncludes(result, SCOPES)
      assertStringIncludes(result, 'creation pending')
      assertStringIncludes(await k.tool('app_list'), 'creation pending')
      assertEquals(result.includes('test-token'), false)
      assertEquals(k.uploads.length, 0)
      let response = await apps.fetch(
        new Request('https://ada.yaks.app/cookbook/'),
        k.env,
      )
      assertEquals(response.status, 200)
      assertStringIncludes(await response.text(), 'The files keep serving')
      k.state.fail = ''
      await k.tool('app_deploy')
      assertEquals(k.uploads.length, 1)
    } finally {
      k.done()
    }
  }
})

Deno.test('a missing explicit main refuses before resource creation, upload or deletion', async () => {
  let k = await fixture()
  try {
    await k.write({ ...configuration, main: 'missing/server.js' })
    let result = await k.tool('app_deploy')
    assertStringIncludes(
      result,
      'refused main: missing/server.js is not an app file',
    )
    assertStringIncludes(result, 'upload the server source at that path')
    assertEquals(k.calls, [])
    assertEquals(k.uploads, [])
    assertEquals(await k.rows('.binding!'), [])
  } finally {
    k.done()
  }
})

Deno.test('JSONC takes precedence over JSON and neither config is served publicly', async () => {
  let k = await fixture()
  try {
    await k.write({ compatibility_date: '2025-01-01' }, 'wrangler.json')
    await k.tool('app_deploy')
    assertEquals(k.uploads[0].compatibility_date, '2025-01-01')
    await k.tool('app_files', {
      files: [
        { path: 'wrangler.json', content: '{invalid JSON, deliberately}' },
        {
          path: 'wrangler.jsonc',
          content: '{ // this file wins\n"compatibility_date": "2026-01-01",}',
        },
      ],
    })
    let result = await k.tool('app_deploy')
    assertStringIncludes(
      result,
      'ignored wrangler.json: wrangler.jsonc takes precedence',
    )
    assertEquals(k.uploads[1].compatibility_date, '2026-01-01')
    for (
      let path of [
        'wrangler.json',
        'wrangler.jsonc',
        '%77rangler.json',
        '%77rangler.jsonc',
      ]
    ) {
      let response = await apps.fetch(
        new Request(`https://ada.yaks.app/cookbook/${path}`),
        k.env,
      )
      assertEquals(response.status, 404, path)
      await response.body?.cancel()
    }
  } finally {
    k.done()
  }
})

Deno.test('malformed JSONC keeps the prior worker and never falls back to JSON', async () => {
  let k = await fixture()
  try {
    await k.write(configuration)
    await k.tool('app_deploy')
    let calls = k.calls.length
    await k.tool('app_files', {
      files: [
        { path: 'wrangler.jsonc', content: '{"d1_databases": [' },
        {
          path: 'wrangler.json',
          content: '{"d1_databases": [{"binding": "NEW"}]}',
        },
      ],
    })
    let result = await k.tool('app_deploy')
    assertStringIncludes(
      result,
      'refused wrangler config: expected valid JSON or JSONC',
    )
    assertStringIncludes(result, 'the worker is unchanged')
    assertEquals(k.calls.length, calls)
    assertEquals(k.uploads.length, 1)
    assertEquals((await k.rows('.binding!')).length, 3)
  } finally {
    k.done()
  }
})

Deno.test('a partial resource creation is recorded and reused on retry', async () => {
  let k = await fixture()
  try {
    k.state.fail = '/r2/'
    await k.write(configuration)
    assertStringIncludes(await k.tool('app_deploy'), 'R2 Edit')
    assertEquals(k.uploads.length, 0)
    assertEquals((await k.rows('.binding!')).length, 2)
    k.state.fail = ''
    await k.tool('app_deploy')
    assertEquals(k.uploads.length, 1)
    assertEquals(
      k.calls.filter((c) => c.method == 'POST' && c.path == '/d1/database')
        .length,
      1,
    )
    assertEquals((await k.rows('.binding!')).length, 3)
  } finally {
    k.done()
  }
})

Deno.test('permanent deletion empties R2 and keeps ownership through a failed retry', async () => {
  let k = await fixture()
  try {
    await k.write(configuration)
    await k.tool('app_deploy')
    k.state.objects.add('first.txt').add('folder/second file.txt')
    k.state.fail = '/objects/folder/second%20file.txt'
    await assertRejects(
      () => k.tool('app_delete', { forever: true }),
      Error,
      'R2 Edit',
    )
    assertEquals([...k.state.objects], ['folder/second file.txt'])
    assertEquals((await k.rows('.binding!')).length, 2)
    assertEquals(
      (await k.rows(`.app!&.entity.eid=${k.app.eid}`)).length,
      1,
    )
    k.state.fail = ''
    await k.tool('app_delete', { forever: true })
    assertEquals(k.state.objects.size, 0)
    assertEquals((await k.rows('.binding!')).length, 0)
    assertEquals(
      k.calls.filter((c) =>
        c.method == 'DELETE' && c.path == '/d1/database/owned-database-id'
      ).length,
      1,
    )
  } finally {
    k.done()
  }
})

Deno.test('main deploys the chosen nested source and its imports, never the default worker', async () => {
  let k = await fixture()
  try {
    await k.write({ main: './dist/server.mjs' })
    await k.tool('app_files', {
      files: [
        {
          path: 'dist/server.mjs',
          content: `import { value } from '../entry.js'
export { Room } from './room.js'
export default { fetch() { return new Response(value) } }`,
        },
        { path: 'entry.js', content: `export let value = 'custom server'` },
        { path: 'dist/room.js', content: 'export class Room {}' },
        {
          path: 'worker.js',
          content: 'this default source must not be uploaded',
        },
      ],
    })
    let result = await k.tool('app_deploy')
    assertStringIncludes(result, 'worker: dist/server.mjs answers first')
    assertStringIncludes(result, 'main is the server source; default worker.js')
    assertStringIncludes(result, 'wrapper is platform-owned')
    let form = k.uploadedFiles[0]
    assertEquals([...form.keys()], [
      'metadata',
      '__yak_entry.js',
      'dist/server.mjs',
      'entry.js',
      'dist/room.js',
    ])
    let wrapper = await (form.get('__yak_entry.js') as File).text()
    assertStringIncludes(wrapper, 'import app from "./dist/server.mjs"')
    assertStringIncludes(wrapper, 'export * from "./dist/server.mjs"')
    assertEquals(wrapper.includes('./worker.js'), false)
    for (let path of ['dist/server.mjs', 'dist/%73erver.mjs']) {
      let res = await apps.fetch(
        new Request('https://ada.yaks.app/cookbook/' + path),
        k.env,
      )
      assertEquals(
        res.status,
        404,
        'configured server source must not be public',
      )
    }
    let browser = await apps.fetch(
      new Request('https://ada.yaks.app/cookbook/entry.js'),
      k.env,
    )
    assertEquals(browser.status, 200, 'entry.js is now an ordinary app file')
    await browser.body?.cancel()
  } finally {
    k.done()
  }
})

Deno.test('explicit worker.js and entry.js are valid server sources', async () => {
  let k = await fixture()
  try {
    for (let main of ['worker.js', 'entry.js']) {
      await k.write({ main })
      await k.tool('app_files', {
        files: [{ path: main, content: 'export default { fetch() {} }' }],
      })
      let result = await k.tool('app_deploy')
      assertStringIncludes(result, `worker: ${main} answers first`)
      let form = k.uploadedFiles.at(-1)!
      assertEquals([...form.keys()], ['metadata', '__yak_entry.js', main])
    }
  } finally {
    k.done()
  }
})

Deno.test('invalid main leaves the prior script intact even with no default source', async () => {
  let k = await fixture()
  try {
    await k.tool('app_files', {
      files: [{ path: 'wrangler.jsonc', content: '{"main":"../server.js"}' }],
    })
    assertStringIncludes(await k.tool('app_deploy'), 'refused main:')
    assertEquals(k.calls, [])
  } finally {
    k.done()
  }
})
