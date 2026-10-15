// File edits on their storage seams, not a platform boot. The directory below
// commits the same bundles through the real RAM transaction and $was guard;
// the bucket holds actual bytes. Connector wording and access live with the
// app_files tests in mcp_deploy_test.ts and files_read_test.ts.
import { clock, test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Objects } from '@yaks/blob'
import { guard } from '@yaks/graph/guard'
import { Stale } from '@yaks/graph/errors'
import type { Bundle } from '@yaks/graph/bundle'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import type { App, Directory, Space } from './directory.ts'
import { addressed, sha256 } from './versions.ts'
import {
  type Change,
  deleting,
  drafting,
  history,
  modifying,
  replaced,
  restoring,
  type Written,
} from './written.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let APP = 'a0000000-0000-4000-8000-000000000001'
let WHO = { person: ADA, role: 'owner' as const }
let SPACE = { slug: 'ada' } as Space
let encode = (text: string) => new TextEncoder().encode(text)
// Content addressing is an input to modifying, as it is at the tool's door.
let contents = Object.fromEntries(
  await Promise.all(
    ['one', 'two', 'three', 'left', 'right'].map(async (text) => [
      text,
      {
        bytes: encode(text),
        sha: await sha256(encode(text)),
        size: text.length,
      },
    ]),
  ),
)
let sha = (text: string) => contents[text].sha

// Only the two components this seam reads/writes, with the same nullable
// properties as the directory. Real storage owns atomicity and preconditions.
let vocab = loadVocab({
  $defs: Object.fromEntries(
    Object.entries({
      app: {
        draft: 'string',
        source: 'string',
        version: 'number',
        fence: 'string',
      },
      written: {
        app: 'string',
        draft: 'string',
        path: 'string',
        sha: 'string',
        was: 'string',
        size: 'number',
        at: 'string',
        by: 'string',
      },
    }).map(([name, props]) => [name, {
      component: true,
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(props).map(([key, type]) => [key, { type }]),
      ),
    }]),
  ),
})

// Match asynchronous storage answers, including rejected synchronous faults.
let answer = <T>(read: () => T): Promise<T> => Promise.resolve().then(read)

let made = () => {
  let time = clock(Date.parse('2026-10-15T12:00:00Z'))
  let store = ram(vocab)
  store.tx((tx) =>
    tx.patch([{
      entity: { eid: APP },
      app: { version: 0 },
    }])
  )
  let app = (): App =>
    ({
      eid: APP,
      slug: 'notes',
      ...(store.get([APP])[0].app as object),
    }) as App
  let collisions = 0
  let skew = 0
  let dir = {
    app: () => Promise.resolve(app()),
    written: (_app: App, draft?: string): Promise<Written[]> =>
      answer(() =>
        store.read(`.written.app=${APP}`).filter((b) =>
          !draft || (b.written as { draft?: string }).draft == draft
        ).map((b) =>
          ({
            eid: b.entity.eid,
            draft: null,
            sha: null,
            was: null,
            size: null,
            at: null,
            by: null,
            ...(b.written as object),
          }) as Written
        )
      ),
    stamp: ({ entities }: { entities: Bundle[] }) =>
      answer(() => {
        try {
          return store.tx((tx) => {
            guard(entities, tx, vocab)
            tx.patch(entities)
            return entities
          })
        } catch (e) {
          if (e instanceof Stale) collisions++
          throw e
        }
      }),
  } as unknown as Directory
  let bytes = new Map<string, Uint8Array<ArrayBuffer>>()
  let puts: string[] = []
  let raw: Objects = {
    has: (key) => Promise.resolve(bytes.has(key)),
    put: (key, value) =>
      answer(() => {
        puts.push(key)
        bytes.set(key, new Uint8Array(value))
      }),
    read: (key) => Promise.resolve(bytes.get(key) ?? null),
    get: (key) =>
      answer(() => {
        let value = bytes.get(key)
        if (!value) throw new Error(`no blob at ${key}`)
        return value
      }),
    load: (key) =>
      answer(() => {
        let value = bytes.get(key)
        return value ? { bytes: value, version: key } : null
      }),
    open: (key) =>
      answer(() => {
        let value = bytes.get(key)
        return value
          ? {
            size: value.byteLength,
            version: key,
            read: (range) =>
              Promise.resolve(
                new Response(
                  range ? value.slice(range.from, range.to + 1) : value,
                ).body!,
              ),
          }
          : null
      }),
    delete: (keys) =>
      answer(() => {
        for (let key of [keys].flat()) bytes.delete(key)
      }),
    list: (prefix) =>
      Promise.resolve(
        [...bytes.keys()].filter((k) => k.startsWith(prefix)).sort(),
      ),
    uploaded: () =>
      answer(() => {
        throw new Error('edits do not sweep')
      }),
  }
  let edit = <T>(act: Parameters<typeof modifying<T>>[5]) =>
    modifying(
      raw,
      dir,
      SPACE,
      app(),
      WHO,
      act,
      () => new Date(time.now() + skew).toISOString(),
    )
  let write = (sent: Record<string, string>) =>
    edit(() =>
      Promise.resolve({
        changes: Object.entries(sent).map(([path, text]) => ({
          path,
          ...contents[text],
        })),
        value: null,
      })
    )
  let draft = () => drafting(raw, dir, app())
  let read = async (path: string) => {
    let d = await draft()
    return new TextDecoder().decode(await d.view.get(`${d.root}/${path}`))
  }
  let past = (path: string) => history(dir, app(), path)
  let restore = async (
    path: string,
    asked: { sha?: string; at?: number } = {},
  ) => {
    let d = await draft()
    let all = await past(path)
    let { want } = restoring(all, d.files[path] ?? null, asked)
    assert(want)
    assert(await raw.has(addressed(want)))
    let change: Change = {
      path,
      sha: want,
      size: all.find((w) => w.sha == want)?.size,
    }
    return edit(() => Promise.resolve({ changes: [change], value: null }))
  }
  let remove = (path: string) =>
    edit((d, _app, attempt) => answer(() => deleting(d, path, attempt)))
  return {
    write,
    read,
    puts,
    past,
    restore,
    remove,
    draft,
    time,
    collisions: () => collisions,
    skew: (ms: number) => {
      skew = ms
    },
  }
}

test('a write sent again sends only what did not land, and says so', async () => {
  let { write, puts } = made()
  let first = await write({ 'a.txt': 'one', 'b.txt': 'two' })
  assertEquals(first.wrote, ['a.txt', 'b.txt'])
  assertEquals(
    puts.sort(),
    [addressed(sha('one')), addressed(sha('two'))].sort(),
  )
  puts.length = 0
  let again = await write({ 'a.txt': 'one', 'b.txt': 'two', 'c.txt': 'three' })
  assertEquals(puts, [addressed(sha('three'))])
  assertEquals({ wrote: again.wrote, already: again.already }, {
    wrote: ['c.txt'],
    already: ['a.txt', 'b.txt'],
  })
})

test('a path answers its own past, and is put back without moving bytes', async () => {
  let { write, read, puts, past, restore, time } = made()
  await write({ 'page.html': 'one' })
  await time.advance(5)
  let between = time.now()
  await time.advance(5)
  await write({ 'page.html': 'two' })
  let all = await past('page.html')
  assertEquals([all[0].sha, all[0].size], [sha('two'), 3])
  assertEquals(replaced(all), [{ sha: sha('one'), at: all[0].at, by: ADA }])
  puts.length = 0
  await time.advance(1)
  await restore('page.html')
  assertEquals(await read('page.html'), 'one')
  await time.advance(1)
  await restore('page.html', { sha: sha('two') })
  assertEquals(await read('page.html'), 'two')
  await time.advance(1)
  await restore('page.html', { at: between })
  assertEquals(await read('page.html'), 'one')
  assertEquals((await past('page.html')).length, 5)
  assertEquals(replaced(await past('page.html')).length, 4)
  assertEquals(puts, [])
})

test('a file deleted comes back, and a delete sent again says so', async () => {
  let { write, remove, restore, read, draft } = made()
  await write({ 'a.txt': 'one', 'b.txt': 'two' })
  assertEquals((await remove('a.txt')).value, true)
  assertEquals(Object.keys((await draft()).files), ['b.txt'])
  assertEquals((await remove('a.txt')).value, false)
  await restore('a.txt')
  assertEquals(await read('a.txt'), 'one')
  assertThrows(
    () =>
      deleting(
        { files: {}, rows: [] } as unknown as Awaited<ReturnType<typeof draft>>,
        'missing.txt',
      ),
    Error,
    'no file missing.txt',
  )
})

test('two writers at once lose neither write', async () => {
  let { write, read, past, collisions } = made()
  await Promise.all([write({ 'a.txt': 'one' }), write({ 'b.txt': 'two' })])
  assertEquals(await read('a.txt'), 'one')
  assertEquals(await read('b.txt'), 'two')
  let before = collisions()
  await Promise.all([write({ 'a.txt': 'left' }), write({ 'a.txt': 'right' })])
  let now = await read('a.txt')
  assert(['left', 'right'].includes(now), now)
  assert(collisions() > before, 'same-head writes must exercise the retry')
  let all = await past('a.txt')
  for (let text of ['left', 'right']) {
    assert(all.some((w) => w.sha == sha(text)))
  }
  assertEquals(
    replaced(all).map((w) => w.sha).sort(),
    [sha('one'), sha(now == 'left' ? 'right' : 'left')].sort(),
  )
})

test('edits sort after their persisted head when the clock stops or moves back', async () => {
  let { write, read, past, time, skew } = made()
  await write({ 'a.txt': 'one' })
  let first = (await past('a.txt'))[0].at!
  skew(-60_000)
  await write({ 'a.txt': 'left' })
  await write({ 'a.txt': 'right' })
  assertEquals(await read('a.txt'), 'right')
  let all = await past('a.txt')
  assertEquals(
    all.map((w) => w.at),
    [2, 1, 0].map((ms) => new Date(Date.parse(first) + ms).toISOString()),
  )
  assertEquals(
    restoring(all, sha('right'), { at: Date.parse(first) }).want,
    sha('one'),
  )
  assertEquals(
    restoring(all, sha('right'), { at: Date.parse(first) + 1 }).want,
    sha('left'),
  )
  skew(0)
  await time.advance(60_000)
  await write({ 'a.txt': 'two' })
  assertEquals((await past('a.txt'))[0].at, new Date(time.now()).toISOString())
  assertEquals(await read('a.txt'), 'two')
  // A separate app starts at its own clock, not another draft's future stamp.
  let other = made()
  await other.write({ 'b.txt': 'three' })
  assertEquals((await other.past('b.txt'))[0].at, first)
})
