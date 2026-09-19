import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { VocabDoc } from '@yaks/vocab'
import { compose, type Module, read } from './serve.ts'

let doc: VocabDoc = {
  title: 'shop',
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // Provenance, so a write shows whose it was: the stamp phase fills what
    // the vocabulary declares.
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', stamped: true },
        by: { type: 'string', stamped: true },
      },
    },
    book: {
      component: true,
      kind: true,
      type: 'object',
      properties: { title: { type: 'string' }, price: { type: 'number' } },
    },
    book_list: {
      tool: true,
      noun: 'book',
      verb: 'list',
      description: 'every book',
      input: {},
      readOnly: true,
    },
  },
}

// One plugin module, written here rather than on disk: `compose` takes how a
// specifier becomes a module, so a test never writes a file to be imported.
let shop: Module = {
  vocab: doc,
  runs: {
    book_list: async (_args, ctx) => ({ result: await ctx.read('.book') }),
  },
  routes: [{
    method: 'GET',
    path: '/shop/*',
    handle: (request) => new Response(new URL(request.url).pathname),
  }],
}

let only = (mods: Record<string, Module>) => (spec: string) =>
  Promise.resolve(mods[spec] ?? {})

let write = (path: string, body: unknown) =>
  Deno.writeTextFileSync(path, JSON.stringify(body))

Deno.test('a config resolves its database and its relative plugins against itself', () => {
  let dir = Deno.makeTempDirSync()
  try {
    write(`${dir}/yak.json`, {
      db: 'graph.db',
      plugins: ['./mail.ts', '@yaks/session'],
      port: 9000,
    })
    let config = read(`${dir}/yak.json`)
    assertEquals(config.db, `${dir}/graph.db`)
    assertEquals(config.plugins, [`file://${dir}/mail.ts`, '@yaks/session'])
    assertEquals(config.port, 9000)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('a config that is not an object, or not JSON, says which file', () => {
  let dir = Deno.makeTempDirSync()
  try {
    write(`${dir}/list.json`, [1, 2])
    Deno.writeTextFileSync(`${dir}/bad.json`, '{')
    assertThrows(
      () => read(`${dir}/list.json`),
      Error,
      'a config is a JSON object',
    )
    assertThrows(() => read(`${dir}/bad.json`), Error, 'bad.json')
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('a host without a database refuses rather than guessing one', async () => {
  let db = Deno.env.get('DB_PATH')
  Deno.env.delete('DB_PATH')
  try {
    await assertRejects(
      () => compose({ plugins: [] }),
      Error,
      'there is no default',
    )
  } finally {
    if (db) Deno.env.set('DB_PATH', db)
  }
})

Deno.test('compose takes each facet: vocab, tools, routes, and the doors', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop'], actor: 'me' },
    only({ shop }),
  )
  try {
    assertEquals(host.vocab.comp('book')?.name, 'book')
    assertEquals(host.tools.map((t) => t.name), ['book_list'])

    let applied = await host.handler(
      new Request('http://h/apply', {
        method: 'POST',
        body: JSON.stringify([{
          entity: { eid: 'b1' },
          book: { title: 'Spring', price: 12 },
        }]),
      }),
    )
    assertEquals(applied.status, 200)
    // The door signs what it applied with the identity it authenticated,
    // whatever the client said about itself.
    assertEquals((await applied.json())[0].created.by, 'me')

    let found = await host.handler(new Request('http://h/query?q=.book'))
    assertEquals((await found.json())[0].book.title, 'Spring')

    let mine = await host.handler(new Request('http://h/shop/anything'))
    assertEquals(await mine.text(), '/shop/anything')

    let missing = await host.handler(new Request('http://h/nowhere'))
    assertEquals(missing.status, 404)
  } finally {
    host.close()
  }
})

Deno.test('a declared tool nobody runs refuses to compose', async () => {
  await assertRejects(
    () =>
      compose(
        { db: ':memory:', plugins: ['shop'] },
        only({ shop: { vocab: doc } }),
      ),
    Error,
    'declared and not implemented',
  )
})

Deno.test('two plugins may not both say who is calling', async () => {
  let who: Module = { authenticate: () => ({ eid: 'a' }) }
  await assertRejects(
    () =>
      compose(
        { db: ':memory:', plugins: ['a', 'b'] },
        only({ a: who, b: { ...who } }),
      ),
    Error,
    'a door has one',
  )
})

Deno.test('a rule sees the graph it is part of, and an effect fires on a commit', async () => {
  let seen: string[] = []
  let mod: Module = {
    vocab: doc,
    runs: { book_list: () => ({ result: [] }) },
    rules: (host) => [{
      name: 'watcher',
      // The graph is live by the time a hook runs, not while it is built.
      hooks: {
        commit: (bundles) => {
          seen.push(typeof host.graph.apply)
          return bundles
        },
      },
    }],
    effects: () => [{ comp: 'book', created: (e) => seen.push(e.entity.eid) }],
  }
  let host = await compose(
    { db: ':memory:', plugins: ['m'] },
    only({ m: mod }),
  )
  try {
    await host.graph.apply([{ entity: { eid: 'b2' }, book: { title: 'Ada' } }])
    assertEquals(seen, ['function', 'b2'])
  } finally {
    host.close()
  }
})
