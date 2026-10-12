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

let fixture = (
  source = 'import type from "./words.json" with {type:"json"}',
) => {
  let files = new Map<string, string>([
    ['/source/deno.json', '{"exports":{".":"./mod.ts"}}'],
    ['/source/mod.ts', 'export * from "./words.ts"'],
    ['/source/words.ts', source],
    ['/source/words.json', '{"title":"one"}'],
  ])
  let absent = new Deno.errors.NotFound('absent')
  let reads: string[] = []
  let read = (path: string) => {
    if (!files.has(path)) throw absent
    return files.get(path)!
  }
  // A file's stat moves with its contents, and with a touch alone.
  let touched = new Map<string, number>()
  let io: MemoFiles = {
    readTextFileSync: (path) => (reads.push(path), read(path)),
    statSync: (path) => {
      let text = read(path)
      let at = new Date(
        Date.parse('2026-01-01') + parseInt(sha256(text).slice(0, 6), 16) +
          (touched.get(path) ?? 0),
      )
      return { size: text.length, mtime: at, ctime: at, ino: 1 }
    },
    mkdirSync: () => {},
    writeTextFileSync: (path, text) => void files.set(path, text),
    renameSync: (from, to) => {
      files.set(to, read(from))
      files.delete(from)
    },
    removeSync: (path) => void files.delete(path),
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
  let runs = 0
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
    sourcesRead,
  }
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

let changed = async (source?: string) => {
  let f = fixture(source)
  await f.get()
  f.files.set('/source/words.json', '{"title":"two"}')
  equal(await f.get(), { title: 'two', run: 2 })
  equal(f.files.size, 5)
}

test('transitive source content invalidates a command memo', () => changed())

test('a memo whose sources kept their stats is reused without reading them', async () => {
  let f = fixture()
  await f.get()
  equal(await f.sourcesRead(() => f.get()), [])
  equal(f.runs(), 1)
})

test('a touched source whose contents agree keeps the memo', async () => {
  let f = fixture()
  await f.get()
  f.touched.set('/source/words.json', 1)
  equal(await f.get(), { title: 'one', run: 1 })
  equal(await f.sourcesRead(() => f.get()), [])
})

test('literal dynamic source content invalidates a command memo', () =>
  changed('let words = await import("./words.json")'))

test('locked package aliases and peer identities are reused without scanning package internals', async () => {
  let f = fixture(
    'import "./words.json"; import "npm:display@^1.0.0"; import "path/detail"',
  )
  f.files.set(
    '/source/deno.json',
    '{"exports":{".":"./mod.ts"},"imports":{"path":"jsr:@test/path@^1.0.0"}}',
  )
  f.files.set(
    '/source/deno.lock',
    '{"specifiers":{"npm:display@^1.0.0":"1.2.3_peer@4.5.6","jsr:@test/path@1":"1.1.0"}}',
  )
  equal(await f.get(), { title: 'one', run: 1 })
  equal(await f.get(), { title: 'one', run: 1 })
})

test('a package gaining an optional facet invalidates its command memo', async () => {
  let f = fixture()
  let roots: MemoRoot[] = [['shop', 'cli']]
  equal(await f.get(roots), { title: 'one', run: 1 })
  equal(await f.get(roots), { title: 'one', run: 1 })
  f.files.set(
    '/source/deno.json',
    '{"exports":{".":"./mod.ts","./cli":"./words.ts"}}',
  )
  equal(await f.get(roots), { title: 'one', run: 2 })
  equal(f.files.size, 5)
})

test('a damaged command memo is derived again', async () => {
  let f = fixture()
  await f.get()
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

test('a command memo tracks dependencies resolved through a scoped import map', async () => {
  let f = fixture()
  f.files.set('/source/words.ts', 'import doc from "alias" with {type:"json"}')
  f.files.set(
    '/source/deno.json',
    JSON.stringify({
      exports: { '.': './mod.ts' },
      scopes: { './': { alias: './words.json' } },
    }),
  )
  equal((await f.get()).run, 1)
  equal((await f.get()).run, 1)
  f.files.set('/source/words.json', '{"title":"two"}')
  equal(await f.get(), { title: 'two', run: 2 })
})

test('changing configuration rebuilds without storing its values', async () => {
  let f = fixture()
  equal((await f.get(undefined, { credential: 'first' })).run, 1)
  equal((await f.get(undefined, { credential: 'second' })).run, 2)
  equal(
    [...f.files].filter(([p]) => p.startsWith('/memo/')).some(([p, text]) =>
      /first|second/.test(p + text)
    ),
    false,
  )
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
