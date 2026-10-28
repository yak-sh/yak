// The wrap pass against a stand-in for Cloudflare's account API: what it reads
// back, what it writes, and what it leaves alone; and the directory bringing
// it forward at each version of the Worker.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { shim, WRAP, wrapping } from './dispatch.ts'
import { DAILY, forward, parts, rewrapped, ROW } from './rewrap.ts'
import type { Env } from './env.ts'

let wait = () => Promise.resolve()

let env = { CF_ACCOUNT: 'acct', CF_WORKERS_TOKEN: 'a-token' } as Env
let AT = '/client/v4/accounts/acct/workers/dispatch/namespaces/yak-apps/scripts'
let ENC = new TextEncoder()

// A multipart body the way the content door answers: parts named, no
// filenames, no types.
let multipart = (boundary: string, of: Record<string, Uint8Array>) => {
  let chunks: Uint8Array[] = []
  for (let [name, bytes] of Object.entries(of)) {
    chunks.push(ENC.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`,
    ))
    chunks.push(bytes, ENC.encode('\r\n'))
  }
  chunks.push(ENC.encode(`--${boundary}--\r\n`))
  let out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  chunks.reduce((at, c) => (out.set(c, at), at + c.length), 0)
  return out
}

// Bytes no text decoding survives.
let WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 0xff, 0xfe, 13, 10, 45])
let OLD = `import app from "./src/app.js"
export * from "./src/app.js"

export default { fetch: (req, env, ctx) => app.fetch(req, env, ctx) }
`

// A script whose modules are null is one the content door fails each time;
// one with `failing` fails that many reads first.
type Script = {
  modules: Record<string, Uint8Array> | null
  tags: string[] | null
  content?: Response
  failing?: number
}

// The account API over `scripts`, recording every write it is sent.
let account = async (
  scripts: Record<string, Script>,
  run: () => Promise<unknown>,
) => {
  let writes: { name: string; form?: FormData; tags?: string[] }[] = []
  let answer = (input: string, init: RequestInit): Response => {
    let url = new URL(input)
    let ok = (result: unknown) =>
      Response.json({ success: true, errors: [], messages: [], result })
    if (url.pathname == AT) {
      let [tag] = (url.searchParams.get('tags') ?? '').split(':')
      return ok(
        Object.entries(scripts)
          .filter(([, s]) => !s.tags?.includes(tag))
          .map(([id, s]) => ({ id, tags: s.tags })),
      )
    }
    let [name, door] = url.pathname.slice(AT.length + 1).split('/')
    let script = scripts[name]
    if (door == 'content' && init.method == 'PUT') {
      writes.push({ name, form: init.body as FormData })
      return ok({})
    }
    if (door == 'content') {
      if (!script.modules || script.failing && script.failing--) {
        return Response.json({
          success: false,
          errors: [{
            message: 'Internal authentication error: internal server error',
          }],
        }, { status: 500 })
      }
      if (script.content) return script.content
      let boundary = 'b0undary'
      return new Response(multipart(boundary, script.modules), {
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      })
    }
    if (door == 'tags' && init.method == 'PUT') {
      script.tags = JSON.parse(init.body as string)
      writes.push({ name, tags: script.tags! })
      return ok(script.tags)
    }
    return ok(script.tags)
  }
  let was = globalThis.fetch
  globalThis.fetch =
    ((input: string, init: RequestInit = {}) =>
      Promise.resolve(answer(input, init))) as typeof fetch
  try {
    return { out: await run(), writes }
  } finally {
    globalThis.fetch = was
  }
}

let bytes = async (form: FormData, name: string) =>
  new Uint8Array(await (form.get(name) as File).arrayBuffer())

test('a wrapper says what it wraps, and an older one had no doors', () => {
  assertEquals(wrapping(shim('src/app.js', ['BOX'], 'AI')), {
    main: 'src/app.js',
    tunneled: ['BOX'],
    ai: 'AI',
  })
  assertEquals(wrapping(OLD), { main: 'src/app.js', tunneled: [], ai: null })
  assertEquals(wrapping('export default {}'), null)
})

test('multipart parts come back byte for byte', () => {
  let body = multipart('xyz', {
    'a.js': ENC.encode('let a = 1'),
    'b.wasm': WASM,
  })
  let got = parts(body, 'xyz')
  assertEquals(got.map((p) => p.name), ['a.js', 'b.wasm'])
  assertEquals(got[1].bytes, WASM)
})

let staleScripts: Record<string, Script> = {
  jeff_recipes: {
    modules: {
      '__yak_entry.js': ENC.encode(OLD),
      'src/app.js': ENC.encode('export default {}'),
      'src/lib.wasm': WASM,
    },
    tags: null,
  },
}
staleScripts.jeff_recipes.content = new Response(
  multipart('b0undary', staleScripts.jeff_recipes.modules!),
  { headers: { 'content-type': 'multipart/form-data; boundary=b0undary' } },
)
let staleWrapper = shim('src/app.js', [], null)

test("a stale script gets this release's wrapper and keeps its own modules", async () => {
  let scripts = staleScripts
  let { out, writes } = await account(
    scripts,
    () => rewrapped(env, undefined, wait),
  )
  assertEquals(out, { rewrapped: 1, failed: 0, left: 0 })
  let form = writes[0].form!
  let meta = JSON.parse(await (form.get('metadata') as File).text())
  assertEquals(meta, { main_module: '__yak_entry.js' })
  assertEquals(
    await (form.get('__yak_entry.js') as File).text(),
    staleWrapper,
  )
  assertEquals(await bytes(form, 'src/lib.wasm'), WASM)
  assertEquals((form.get('src/lib.wasm') as File).type, 'application/wasm')
  assertEquals(scripts.jeff_recipes.tags, [WRAP])
})

test('a pass after it finds nothing left to do', async () => {
  let scripts: Record<string, Script> = {
    jeff_recipes: {
      modules: { '__yak_entry.js': ENC.encode(OLD) },
      tags: [WRAP],
    },
  }
  let again = await account(scripts, () => rewrapped(env, undefined, wait))
  assertEquals(again.out, { rewrapped: 0, failed: 0, left: 0 })
  assertEquals(again.writes, [])
})

test('a script a deploy just uploaded is left alone', async () => {
  let scripts: Record<string, Script> = {
    jeff_recipes: {
      modules: { '__yak_entry.js': ENC.encode(OLD) },
      tags: null,
    },
  }
  // Listed stale, and a deploy lands before its content is read.
  let { out, writes } = await account(
    scripts,
    () =>
      meanwhile(
        1,
        () => scripts.jeff_recipes.tags = [WRAP],
        () => rewrapped(env, undefined, wait),
      ),
  )
  assertEquals(out, { rewrapped: 0, failed: 0, left: 0 })
  assertEquals(writes, [])
})

// `run`, with `then` done just before its `nth` call to the account API.
let meanwhile = async <T>(nth: number, then: () => unknown, run: () => T) => {
  let was = globalThis.fetch
  let calls = 0
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    if (calls++ == nth) then()
    return was(input, init)
  }) as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = was
  }
}

test('one script failing leaves the others rewrapped', async () => {
  let scripts: Record<string, Script> = {
    broken: { modules: null, tags: null },
    jeff_recipes: {
      modules: { '__yak_entry.js': ENC.encode(OLD) },
      tags: null,
    },
  }
  let { out } = await account(scripts, () => rewrapped(env, undefined, wait))
  assertEquals(out, { rewrapped: 1, failed: 1, left: 0 })
})

test('Cloudflare failing a read on its own side is asked again', async () => {
  let scripts: Record<string, Script> = {
    jeff_recipes: {
      modules: { '__yak_entry.js': ENC.encode(OLD) },
      tags: null,
      failing: 2,
    },
  }
  let { out } = await account(scripts, () => rewrapped(env, undefined, wait))
  assertEquals(out, { rewrapped: 1, failed: 0, left: 0 })
})

test('a pass takes at most so many, and says how many are left', async () => {
  let scripts: Record<string, Script> = Object.fromEntries(
    ['a', 'b', 'c'].map((n) => [n, {
      modules: { '__yak_entry.js': ENC.encode(OLD) },
      tags: null,
    }]),
  )
  let { out } = await account(scripts, () => rewrapped(env, 2, wait))
  assertEquals(out, { rewrapped: 2, failed: 0, left: 1 })
})

test('each version of the Worker brings the wrap pass forward, once', () => {
  let now = Date.parse('2026-10-14T12:00:00Z')
  let held = (at: string | null) => ({
    entity: { eid: ROW },
    wake: { every: DAILY, at },
  })
  // Wherever the daily left it, the release has it run now.
  assertEquals(forward(held('2031-01-01T05:10:00.000Z'), now), [{
    entity: { eid: ROW },
    wake: { at: '2026-10-14T12:00:00.000Z' },
  }])
  // A pass someone paused stays paused.
  assertEquals(forward(held(null), now), [])
  assertEquals(forward(undefined, now), [])
})
