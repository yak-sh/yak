import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import type { VocabDoc } from '@yaks/vocab'
import { compose, FACETS, type Facets, read, words } from './serve.ts'

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
    // Its other half: an entity that is touched twice is stamped twice, and
    // a call is — written, claimed, answered (@yaks/graph `stamps`).
    updated: {
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
    book_add: {
      tool: true,
      noun: 'book',
      verb: 'add',
      description: 'shelve one',
      input: { title: { type: 'string' } },
    },
  },
}

// A plugin's facets, written here rather than on disk: `compose` takes how a
// plugin's subpath becomes a module, so a test never writes a package to be
// imported. What a plugin does NOT export is what it does not have.
type Plugged = Partial<Facets>

let shop: Plugged = {
  vocab: { docs: [doc] },
  tools: {
    runs: {
      // A tool answers BUNDLES: the entities it found, and nothing else.
      book_list: (_, ctx) => ctx.read('.book'),
      // And a writing one answers the entity it wants made. It never writes
      // itself: what it answers is landed for it, as whoever asked.
      book_add: (_, ctx) => [{
        entity: { eid: '$made' },
        book: { title: String(ctx.args.title) },
        content: { body: `shelved ${ctx.args.title}` },
        output: { source: ctx.call },
      }],
    },
  },
  routes: {
    routes: () => [{
      method: 'GET',
      path: '/shop/*',
      handle: (request) => new Response(new URL(request.url).pathname),
    }],
  },
}

// Every facet of every plugin, by name. A facet nobody wrote is `null` — the
// answer the default loader gives for a subpath a package does not export.
let only =
  (mods: Record<string, Plugged>) =>
  <F extends keyof Facets>(spec: string, facet: F): Promise<Facets[F] | null> =>
    Promise.resolve((mods[spec]?.[facet] ?? null) as Facets[F] | null)

let write = (path: string, body: unknown) =>
  Deno.writeTextFileSync(path, JSON.stringify(body))

Deno.test('a config resolves its database and its relative plugins against itself', () => {
  let dir = Deno.makeTempDirSync()
  try {
    write(`${dir}/yak.json`, {
      db: 'graph.db',
      plugins: ['./plugins/mail', '@yaks/session'],
      port: 9000,
    })
    let config = read(`${dir}/yak.json`)
    assertEquals(config.db, `${dir}/graph.db`)
    assertEquals(config.plugins, [
      `file://${dir}/plugins/mail`,
      '@yaks/session',
    ])
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

Deno.test('compose takes each facet from its own subpath, and mounts the doors', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop'], actor: 'me' },
    only({ shop }),
  )
  try {
    assertEquals(host.vocab.comp('book')?.name, 'book')
    assertEquals(host.tools.map((t) => t.name), ['book_list', 'book_add'])

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
        only({ shop: { vocab: { docs: [doc] } } }),
      ),
    Error,
    'declared and not implemented',
  )
})

Deno.test('two plugins may not both say who is calling', async () => {
  let who: Plugged = { routes: { authenticate: () => ({ eid: 'a' }) } }
  await assertRejects(
    () =>
      compose(
        { db: ':memory:', plugins: ['a', 'b'] },
        only({ a: who, b: { routes: { ...who.routes } } }),
      ),
    Error,
    'a door has one',
  )
})

Deno.test('a plugin that exports no facet is a typo, not a plugin', async () => {
  await assertRejects(
    () => compose({ db: ':memory:', plugins: ['nope'] }, only({})),
    Error,
    'exports no facet',
  )
})

Deno.test('a facet that fails to import is loud; one that is absent is skipped', async () => {
  // The default loader tells the two apart by the error: an unknown subpath is
  // a facet the package does not have, and anything else is that facet failing.
  let load = <F extends keyof Facets>(
    _spec: string,
    facet: F,
  ): Promise<Facets[F] | null> => {
    if (facet == 'vocab') return Promise.resolve({ docs: [doc] } as Facets[F])
    if (facet == 'rules') return Promise.reject(new SyntaxError('broken'))
    return Promise.resolve(null)
  }
  await assertRejects(
    () => compose({ db: ':memory:', plugins: ['half'] }, load),
    SyntaxError,
    'broken',
  )
  assertEquals(FACETS.includes('rules'), true)
})

Deno.test('a rule sees the graph it is part of, and an effect fires on a commit', async () => {
  let seen: string[] = []
  let mod: Plugged = {
    vocab: { docs: [doc] },
    tools: { runs: { book_list: () => [], book_add: () => [] } },
    rules: {
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
    },
    effects: {
      effects: () => [{
        comp: 'book',
        created: (e) => seen.push(e.entity.eid),
      }],
    },
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

// The whole host path, in one place: a word calls the tool HERE, the ask and
// the answer are written down as they go, and a call somebody else wrote is
// run by the effect the server registers.

Deno.test('a word calls the tool, and the call is the transcript', async () => {
  let said: string[] = []
  let host = await compose(
    { db: ':memory:', plugins: ['shop'], actor: 'me' },
    only({ shop }),
  )
  try {
    let add = words(host).find((w) => w.name == 'book_add')!
    let code = await add.run({ title: 'Spring' }, {
      out: (line: string) => said.push(line),
      err: () => {},
    } as never)
    assertEquals(code, 0)
    assertEquals(said, ['shelved Spring'])

    // What was asked, and what came back, both written down — and the book
    // the tool answered is signed as the person who asked, not the server.
    let [call] = await host.graph.read('.call')
    assertEquals((call.call as Comp).to, toolEid('book_add'))
    assertEquals((call.created as Comp).by, 'me')
    assertEquals((call.execution as Comp).state, 'done')
    let [result] = await host.graph.read('.result')
    assertEquals((result.result as Comp).call, call.entity.eid)
    let [book] = await host.graph.read('.book')
    assertEquals((book.created as Comp).by, 'me')
  } finally {
    host.close()
  }
})

Deno.test('a call written through the door is run by the effect', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop'], actor: 'me' },
    only({ shop }),
  )
  try {
    await host.runner.ensure()
    // Nobody is waiting on this one: it is a write like any other, through
    // the door a client uses. The rules are registered as effects, so the
    // call is run because it MATCHED, not because somebody awaited it.
    let wrote = await host.handler(
      new Request('http://h/apply', {
        method: 'POST',
        body: JSON.stringify([{
          entity: { eid: 'c1' },
          call: {
            to: toolEid('book_add'),
            args: JSON.stringify({ title: 'Later' }),
          },
        }]),
      }),
    )
    assertEquals(wrote.status, 200)
    let [result] = await host.graph.read('.result')
    assertEquals((result.result as Comp).call, 'c1')
    assert(
      (await host.graph.read('.book')).some((b) =>
        (b.book as Comp).title == 'Later'
      ),
    )
  } finally {
    host.close()
  }
})

Deno.test('a plugin named with options gets them, beside the host', async () => {
  let said: unknown[] = []
  let host = await compose(
    {
      db: ':memory:',
      plugins: [{ use: 'shop', with: { open: 'tuesdays' } }, 'quiet'],
      actor: 'me',
    },
    only({
      shop: {
        ...shop,
        routes: {
          routes: (_host, options) => {
            said.push(options)
            return [{
              method: 'GET',
              path: '/open',
              handle: () => new Response(String(options.open)),
            }]
          },
        },
      },
      // A plugin nobody configured is handed an empty object, never
      // undefined: a factory reads its options without guarding first.
      quiet: {
        effects: {
          effects: (_h, options) => {
            said.push(options)
            return []
          },
        },
      },
    }),
  )
  try {
    assertEquals(said, [{}, { open: 'tuesdays' }])
    let res = await host.handler(new Request('http://x/open'))
    assertEquals(await res.text(), 'tuesdays')
  } finally {
    host.close()
  }
})

Deno.test('an option written {env} is read from the environment', () => {
  let dir = Deno.makeTempDirSync()
  Deno.env.set('YAK_TEST_TOKEN', 'hunter2')
  try {
    write(`${dir}/yak.json`, {
      db: ':memory:',
      plugins: [{
        use: './plugins/mail',
        with: { sender: { token: { env: 'YAK_TEST_TOKEN' } }, keep: [1, 2] },
      }],
    })
    assertEquals(read(`${dir}/yak.json`).plugins, [{
      use: `file://${dir}/plugins/mail`,
      with: { sender: { token: 'hunter2' }, keep: [1, 2] },
    }])
  } finally {
    Deno.env.delete('YAK_TEST_TOKEN')
    Deno.removeSync(dir, { recursive: true })
  }
})
