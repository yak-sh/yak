import { equal, test, throws } from '@yaks/testing'
import { parse } from 'es-module-lexer/js'
import { createHash } from 'node:crypto'
import {
  type MemoFiles,
  type MemoRoot,
  remember,
  sourceImports,
} from './memo.ts'

let sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

// A file's time, read off its contents: the same contents, the same time.
let stamps = new Map<string, number>()
let stamped = (text: string) => {
  let at = stamps.get(text)
  if (at === undefined) {
    at = Date.parse('2026-01-01') + parseInt(sha256(text).slice(0, 6), 16)
    stamps.set(text, at)
  }
  return at
}

let start = (
  source = 'import type from "./words.json" with {type:"json"}',
) =>
  new Map<string, string>([
    ['/source/deno.json', '{"exports":{".":"./mod.ts"}}'],
    ['/source/mod.ts', 'export * from "./words.ts"'],
    ['/source/words.ts', source],
    ['/source/words.json', '{"title":"one"}'],
  ])

let fixture = (
  files = start(),
  times = new Map<string, number>(),
  runs = 0,
) => {
  let absent = new Deno.errors.NotFound('absent')
  let reads: string[] = []
  let read = (path: string) => {
    if (!files.has(path)) throw absent
    return files.get(path)!
  }
  // A file's stat moves with its contents, and with a touch alone. A file
  // written here, or given a time, carries that time instead.
  let touched = new Map<string, number>()
  let io: MemoFiles = {
    readTextFileSync: (path) => (reads.push(path), read(path)),
    statSync: (path) => {
      let text = read(path)
      let at = new Date(
        times.get(path) ?? stamped(text) + (touched.get(path) ?? 0),
      )
      return { size: text.length, mtime: at, ctime: at, ino: 1 }
    },
    mkdirSync: () => {},
    writeTextFileSync: (path, text) => {
      files.set(path, text)
      times.set(path, Date.now())
    },
    renameSync: (from, to) => {
      files.set(to, read(from))
      times.set(to, times.get(from) ?? Date.now())
      files.delete(from)
    },
    removeSync: (path) => void files.delete(path),
    readDirSync: (dir) =>
      [...files.keys()].filter((p) => p.startsWith(`${dir}/`))
        .map((p) => ({ name: p.slice(dir.length + 1) })),
    utimeSync: (path, _, mtime) => void times.set(path, mtime.getTime()),
  }
  let resolve = (name: string) => {
    if (name.startsWith('file:')) return name
    let facet = name == 'shop' ? '.' : `./${name.slice('shop/'.length)}`
    let path = JSON.parse(read('/source/deno.json')).exports[facet]
    if (!path) throw new TypeError('missing export')
    return new URL(path, 'file:///source/deno.json').href
  }
  let opts = {
    digest: sha256,
    dir: '/memo',
    files: io,
    resolve,
    imports: (s: string) => Promise.resolve(sourceImports(s, parse(s)[0])),
  }
  let make = () => ({ ...JSON.parse(read('/source/words.json')), run: ++runs })
  let get = (
    roots: MemoRoot[] = ['file:///source/mod.ts'],
    inputs: unknown = {},
  ) => remember(inputs, roots, make, opts)
  let memo = () => [...files.keys()].find((p) => p.startsWith('/memo/'))!
  // The sources a call read: the memo itself is not one.
  let sourcesRead = async (call: () => Promise<unknown>) => {
    reads.length = 0
    await call()
    return reads.filter((p) => p.startsWith('/source/'))
  }
  return {
    files,
    io,
    get,
    memo,
    opts,
    runs: () => runs,
    touched,
    times,
    sourcesRead,
  }
}

type Fixture = ReturnType<typeof fixture>

// The files as a fixture holds them, memos included, carried on by another.
let copy = (f: Fixture) => fixture(new Map(f.files), new Map(f.times), f.runs())

// A memo a case begins from, kept at load: a case takes a copy, and its time
// is the call it is about rather than the miss before it.
let primed = async (files = start(), roots?: MemoRoot[], inputs?: unknown) => {
  let f = fixture(files)
  let first = await f.get(roots, inputs)
  return { f, first }
}

let reusable = fixture()
reusable.files.set(
  '/source/words.ts',
  reusable.files.get('/source/words.ts')! +
    '\nimport {type Shape} from "./erased.ts"; export type {Other} from "./erased.ts"',
)
let initialMemo = await reusable.get()

test('a command reuses a memo when its inputs agree', async () => {
  equal(initialMemo, { title: 'one', run: 1 })
  reusable.files.set('/source/erased.ts', 'export type Shape = string')
  equal(await reusable.get(), { title: 'one', run: 1 })
})

let plain = await primed()

let changed = async (from: Fixture) => {
  let f = copy(from)
  f.files.set('/source/words.json', '{"title":"two"}')
  equal(await f.get(), { title: 'two', run: 2 })
  equal(f.files.size, 5)
}

test('transitive source content invalidates a command memo', () =>
  changed(plain.f))

test('a memo whose sources kept their stats is reused without reading them', async () => {
  let f = copy(plain.f)
  equal(await f.sourcesRead(() => f.get()), [])
  equal(f.runs(), 1)
})

test('a touched source whose contents agree keeps the memo', async () => {
  let f = copy(plain.f)
  f.touched.set('/source/words.json', 1)
  equal(await f.get(), { title: 'one', run: 1 })
  equal(await f.sourcesRead(() => f.get()), [])
})

let dynamic = await primed(start('let words = await import("./words.json")'))

test('literal dynamic source content invalidates a command memo', () =>
  changed(dynamic.f))

let locked = start(
  'import "./words.json"; import "npm:display@^1.0.0"; import "path/detail"',
)
locked.set(
  '/source/deno.json',
  '{"exports":{".":"./mod.ts"},"imports":{"path":"jsr:@test/path@^1.0.0"}}',
)
locked.set(
  '/source/deno.lock',
  '{"specifiers":{"npm:display@^1.0.0":"1.2.3_peer@4.5.6","jsr:@test/path@1":"1.1.0"}}',
)
let aliased = await primed(locked)

test('locked package aliases and peer identities are reused without scanning package internals', async () => {
  equal(aliased.first, { title: 'one', run: 1 })
  equal(await copy(aliased.f).get(), { title: 'one', run: 1 })
})

let shop: MemoRoot[] = [['shop', 'cli']]
let faceted = await primed(undefined, shop)

test('a package gaining an optional facet invalidates its command memo', async () => {
  equal(faceted.first, { title: 'one', run: 1 })
  let f = copy(faceted.f)
  equal(await f.get(shop), { title: 'one', run: 1 })
  f.files.set(
    '/source/deno.json',
    '{"exports":{".":"./mod.ts","./cli":"./words.ts"}}',
  )
  equal(await f.get(shop), { title: 'one', run: 2 })
  equal(f.files.size, 5)
})

test('a damaged command memo is derived again', async () => {
  let f = copy(plain.f)
  f.files.set(f.memo(), '{')
  equal(await f.get(), { title: 'one', run: 2 })
})

test('an unwritable command memo leaves derivation in charge', async () => {
  let f = fixture()
  let scanned = 0
  f.opts.imports = () => {
    scanned++
    return Promise.resolve([])
  }
  f.io.writeTextFileSync = () => {
    throw new Deno.errors.PermissionDenied('read only')
  }
  equal(await f.get(), { title: 'one', run: 1 })
  equal(await f.get(), { title: 'one', run: 2 })
  equal(scanned, 0)
})

test('a memo never hides or retries a failed derivation', async () => {
  let f = fixture()
  let calls = 0
  await throws(
    () =>
      remember({}, ['https://mutable.test/words.ts'], () => {
        calls++
        throw new Error('broken facet')
      }, { ...f.opts, resolve: (s) => s }),
    'broken facet',
  )
  equal(calls, 1)
})

let scoped = start('import doc from "alias" with {type:"json"}')
scoped.set(
  '/source/deno.json',
  JSON.stringify({
    exports: { '.': './mod.ts' },
    scopes: { './': { alias: './words.json' } },
  }),
)
let mapped = await primed(scoped)

test('a command memo tracks dependencies resolved through a scoped import map', async () => {
  equal(mapped.first.run, 1)
  let f = copy(mapped.f)
  equal((await f.get()).run, 1)
  f.files.set('/source/words.json', '{"title":"two"}')
  equal(await f.get(), { title: 'two', run: 2 })
})

let configured = await primed(undefined, undefined, { credential: 'first' })

test('changing configuration rebuilds without storing its values', async () => {
  equal(configured.first.run, 1)
  let f = copy(configured.f)
  equal((await f.get(undefined, { credential: 'second' })).run, 2)
  equal(
    [...f.files].filter(([p]) => p.startsWith('/memo/')).some(([p, text]) =>
      /first|second/.test(p + text)
    ),
    false,
  )
})

let DAY = 86_400_000
let memos = (f: Fixture) =>
  [...f.files.keys()].filter((p) => p.startsWith('/memo/')).sort()

test('a miss sweeps memos nothing has read for a day', async () => {
  let f = fixture()
  f.files.set('/memo/gone.json', '{}')
  f.times.set('/memo/gone.json', Date.now() - 2 * DAY)
  f.files.set('/memo/used.json', '{}')
  f.times.set('/memo/used.json', Date.now() - DAY / 2)
  await f.get()
  equal(memos(f).filter((p) => p.endsWith('d.json')), ['/memo/used.json'])
  equal(memos(f).length, 2)
})

let configuredOne = await primed(undefined, undefined, { config: 'one' })

test('a memo still being read survives the sweep', async () => {
  let f = copy(configuredOne.f)
  let [kept] = memos(f)
  f.times.set(kept, Date.now() - 2 * DAY)
  equal((await f.get(undefined, { config: 'one' })).run, 1)
  equal((await f.get(undefined, { config: 'two' })).run, 2)
  equal(memos(f).includes(kept), true)
})

// `type` can also name a runtime value; only the TS type modifiers erase it.
test('runtime dependencies survive TypeScript type syntax', () => {
  for (
    let [statement, runtime] of [
      ['import type from "./value.ts"', true],
      ['import {type as value} from "./value.ts"', true],
      ['import {type Shape, value} from "./value.ts"', true],
      ['import {} from "./value.ts"', true],
      ['let words = await import("./value.ts")', true],
      ['function run() { return import("./value.ts") }', true],
      ['import type Shape from "./value.ts"', false],
      ['export {type Shape} from "./value.ts"', false],
    ] as const
  ) {
    equal(
      sourceImports(statement, parse(statement)[0]),
      runtime ? ['./value.ts'] : [],
    )
  }
})
