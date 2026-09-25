import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Handler } from '@yaks/api'
import { argsOf, type Bundle, type Comp, detached } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import type { VocabDoc } from '@yaks/vocab'
import { prefixes } from '@yaks/id'
import { blobKeywords, blobRead } from '@yaks/blob'
import { rules as blobRules } from '@yaks/blob/rules'
import { processDoc, selfEid } from '@yaks/process'
import { effectDoc } from '@yaks/effects'
import { runs as effectRuns } from '@yaks/effects/tools'
import {
  compose as composing,
  type Config,
  dbOf,
  every,
  facet,
  type Facets,
  type Load,
  type Options,
  read,
  type Role,
  writer,
} from './host.ts'
import { sealed } from '@yaks/secrets'
import { signer } from './local.ts'

// The host of these tests, as its own writes are signed: this process, whose
// row every composition here writes on the way in.
let me = selfEid()

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
      // The letter its human ids wear — @yaks/id's keyword, which no plugin
      // registers and every host needs.
      prefix: 'K',
      type: 'object',
      properties: {
        // A property that says its words are worth looking for: the host cuts
        // the index from this alone (@yaks/fts).
        title: { type: 'string', search: true },
        price: { type: 'number' },
      },
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

// What a commit to the shop owes: a note for every book, and a price for one
// that has none — which a process coming up finds again by its sweep.
let owes: VocabDoc = {
  $defs: {
    book_seen: { effect: true, created: ['book'] },
    book_priced: {
      effect: true,
      created: ['book'],
      sweep: '.book !book.price',
    },
  },
}

// A plugin's facets, written here rather than on disk: `compose` takes how a
// plugin's subpath becomes a module, so a test never writes a package to be
// imported. What a plugin does not export is what it does not have.
type Plugged = Partial<Facets>

let shop: Plugged = {
  // …and the process words, because a host signs with the row it writes for
  // itself: a graph that cannot say what a process is has nobody to sign as.
  vocab: { docs: [doc, processDoc] },
  tools: {
    // A factory, like every facet: what a run needs from the host, it takes
    // here.
    runs: () => ({
      // A tool answers bundles: the entities it found, and nothing else.
      book_list: (_, graph) => graph.read('.book'),
      // And a writing one answers the entity it wants made. It never writes
      // itself: what it answers is landed for it, as whoever asked.
      book_add: (call) => [{
        entity: { eid: '$made' },
        book: { title: String(argsOf(call).title) },
        content: { body: `shelved ${argsOf(call).title}` },
        output: { source: call.entity.eid },
      }],
    }),
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
// answer the default loader gives for a subpath a package does not export. A
// package named by its own specifier is loaded off disk instead, so a test
// composes @yaks/api beside the plugins written here and gets the doors,
// the handler and the `serve` verb a config would.
let only =
  (mods: Record<string, Plugged>) =>
  <F extends keyof Facets>(spec: string, name: F): Promise<Facets[F] | null> =>
    spec.startsWith('@yaks/')
      ? facet(spec, name)
      : Promise.resolve((mods[spec]?.[name] ?? null) as Facets[F] | null)

// The two packages a host lists when it wants HTTP: one hosts the routes, the
// other is a route on it.
let HTTP = ['@yaks/api', '@yaks/mcp']

// What a host that listed them answers with. A test asking for a handler has
// composed @yaks/api, so an absent one is that test's own bug.
let serving = (host: { handler?: Handler }): Handler => {
  if (!host.handler) throw new Error('this host composed no handler')
  return host.handler
}

// Every role the config's graph has: what a test here assembles, unless it is
// about which roles a process serves.
let compose = (config: Config, load?: Load) =>
  composing(config, every(config), load)

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

Deno.test('a host without a database refuses rather than guessing one', () => {
  // An environment with no DB_PATH in it: the process's own is shared by every
  // test running beside this one, and the gate sets it.
  assertThrows(
    () => dbOf({ plugins: [] }, () => undefined),
    Error,
    'there is no default',
  )
})

Deno.test('compose takes each facet from its own subpath, and mounts the doors', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop', ...HTTP] },
    only({ shop }),
  )
  try {
    assertEquals(host.vocab.comp('book')?.name, 'book')
    // Each component is known by the plugin that declared it.
    assertEquals(host.vocab.comp('book')?.package, 'shop')
    // The generic tier is this graph's own, ahead of the plugins': one list,
    // which the command line runs and `/mcp` restates for itself.
    assertEquals(host.tools.map((t) => t.name), [
      'graph_apply',
      'graph_query',
      'graph_show',
      'graph_schema',
      // `search` is there because a property of this vocabulary said
      // `search: true`; a vocabulary that indexes nothing lists no search.
      'search',
      'book_list',
      'book_add',
      // And the verb the package in the config brought with it.
      'serve',
    ])

    let applied = await serving(host)(
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
    assertEquals((await applied.json())[0].created.by, me)

    let found = await serving(host)(new Request('http://h/query?q=.book'))
    assertEquals((await found.json())[0].book.title, 'Spring')

    let mine = await serving(host)(new Request('http://h/shop/anything'))
    assertEquals(await mine.text(), '/shop/anything')

    let missing = await serving(host)(new Request('http://h/nowhere'))
    assertEquals(missing.status, 404)
  } finally {
    host.close()
  }
})

Deno.test('a config may keep a component off the human number line', async () => {
  // What `numbers` says is what the store's own `number` says, so a host
  // composing a component whose entities nobody ever types the number of —
  // a classifier's descriptors, a log's rows — can say so in its config.
  let host = await compose(
    { db: ':memory:', plugins: ['shop'], numbers: { except: ['note'] } },
    only({
      shop: {
        vocab: {
          docs: [{
            ...doc,
            $defs: {
              ...doc.$defs,
              note: { component: true, type: 'object', kind: true },
            },
          }],
        },
        tools: shop.tools,
      },
    }),
  )
  let [book] = await host.graph.apply([
    { entity: { eid: 'b1' }, book: { title: 'Dune' } },
  ])
  let [note] = await host.graph.apply([{ entity: { eid: 'n1' }, note: {} }])
  assertEquals(book.entity.num, 1)
  assertEquals(note.entity.num, null)
  host.close()
})

Deno.test('a declared tool nobody runs refuses its first call', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop'] },
    only({ shop: { vocab: { docs: [doc] } } }),
  )
  let list = host.tools.find((t) => t.name == 'book_list')!
  await assertRejects(
    async () => await list.run({ entity: { eid: 'c' } }, host.graph),
    Error,
    'declared and not implemented',
  )
  host.close()
})

Deno.test('a plugin’s tools are imported by the first call of one of them', async () => {
  let asked: string[] = []
  let load = <F extends keyof Facets>(spec: string, name: F) => {
    asked.push(name)
    return only({
      shop: {
        vocab: { docs: [doc] },
        tools: { runs: () => ({ book_list: () => [], book_add: () => [] }) },
      },
    })(spec, name)
  }
  let host = await compose({ db: ':memory:', plugins: ['shop'] }, load)
  assertEquals(asked.includes('tools'), false)
  let list = host.tools.find((t) => t.name == 'book_list')!
  assertEquals(await list.run({ entity: { eid: 'c' } }, host.graph), [])
  assertEquals(asked.filter((f) => f == 'tools').length, 1)
  host.close()
})

Deno.test('a host that names itself writes as itself, and a plugin may say who else', async () => {
  // The plugin names a caller for the requests that carry a token, and says
  // nothing about the rest — which is the host's own writing.
  let ana = { by: 'ana', via: 'her-run' }
  let told: Plugged = {
    rules: {
      authenticate: () => (r) => r.headers.get('authorization') ? ana : null,
    },
  }
  let host = await compose(
    { db: ':memory:', plugins: ['shop', 'told', ...HTTP] },
    only({ shop, told }),
  )
  try {
    let wrote = async (headers: Record<string, string> = {}) => {
      let said = await serving(host)(
        new Request('http://h/apply', {
          method: 'POST',
          headers,
          body: JSON.stringify([{ entity: { eid: '$b' }, book: {} }]),
        }),
      )
      return await said.json() as Bundle[]
    }

    let stamp = (b: Bundle) => b.created as Comp
    assertEquals(stamp((await wrote())[0]).by, me)
    assertEquals(
      stamp((await wrote({ authorization: 'Bearer t' }))[0]).by,
      'ana',
    )
    // And what the host writes with nobody at any door at all — an effect, a
    // boot pass — is signed the same way.
    let [own] = await host.graph.apply([{ entity: { eid: 'b9' }, book: {} }])
    assertEquals((own.created as Comp).by, me)
  } finally {
    host.close()
  }
})

Deno.test('a command line writes as the session it names, through the same door as HTTP, or as the person typing it', async () => {
  // The door knows one run by its `x-via`, as @yaks/session's does.
  let ana = { by: 'ana', via: 'her-run' }
  let told: Plugged = {
    rules: {
      authenticate: () => (r) =>
        r.headers.get('x-via') == 'her-run' ? ana : null,
    },
  }
  let host = await compose(
    { db: ':memory:', plugins: ['shop', 'told'], person: 'jo' },
    only({ shop, told }),
  )
  try {
    await host.runner.ensure()
    let add = async (via?: string, typed = false) =>
      (await host.runner.call([{
        entity: { eid: '$call' },
        call: { to: toolEid('book_add'), args: { title: 'Dune' } },
        ...await signer(host, via, typed),
      }])).find((b) => b.book)?.created as Comp
    assertEquals((await add('her-run')).by, 'ana')
    // A run the door does not know, or none at all, is this process's writing.
    assertEquals((await add('nobody')).by, me)
    assertEquals((await add()).by, me)
    // A line typed at a terminal, naming no session, is the config's person's;
    // a session typed into a terminal is still that session's.
    assertEquals((await add(undefined, true)).by, 'jo')
    assertEquals((await add('her-run', true)).by, 'ana')
  } finally {
    host.close()
  }
})

Deno.test('a process writes itself in, signs with that row, and stamps its exit', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop'] },
    only({ shop }),
  )
  try {
    assertEquals(host.me, me)
    assertEquals(writer(host.vocab)?.via, me)
    let [row] = await host.graph.read(`.process&?created&?exit`)
    assertEquals(row.entity.eid, me)
    assertEquals((row.process as Comp).pid, Deno.pid)
    // …and the row is its own author: a process signs everything it writes,
    // itself first, so `created.by` is never an id nothing minted.
    assertEquals((row.created as Comp).by, me)
    assertEquals(row.exit, undefined)
  } finally {
    host.close(7)
  }
  // Closed: the ending is stamped before the file is let go. A fresh host over
  // the same file would read it — this one is :memory:, so the assertion that
  // matters is that `close` took the code without throwing.
})

Deno.test('a graph with no `process` word signs nothing', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['bare'] },
    only({ bare: { ...shop, vocab: { docs: [doc] } } }),
  )
  try {
    assertEquals(host.vocab.comp('process'), undefined)
    assertEquals(writer(host.vocab), null)
    let [made] = await host.graph.apply([{ entity: { eid: 'b1' }, book: {} }])
    assertEquals((made.created as Comp | undefined)?.by, undefined)
  } finally {
    host.close()
  }
})

Deno.test('two plugins may not both say who is calling', async () => {
  let who: Plugged = { rules: { authenticate: () => () => ({ by: 'a' }) } }
  await assertRejects(
    () =>
      compose(
        { db: ':memory:', plugins: ['a', 'b'] },
        only({ a: who, b: { rules: { ...who.rules } } }),
      ),
    Error,
    'a door has one',
  )
})

// T-37821, Jeff's words: "compose should be the other way around: if a plugin
// lists routes but @yaks/api is not included, then those facets are ignored."
Deno.test('a host with nobody to host routes has no handler, and never asks for them', async () => {
  let asked = 0
  let counted: Plugged = {
    ...shop,
    routes: {
      routes: () => {
        asked++
        return [{
          method: 'GET',
          path: '/shop/*',
          handle: () => new Response(''),
        }]
      },
    },
  }
  let host = await compose(
    { db: ':memory:', plugins: ['shop'] },
    only({ shop: counted }),
  )
  try {
    assertEquals(host.handler, undefined)
    assertEquals(host.routes, [])
    assertEquals(asked, 0, 'a route was built for a listener nobody composed')
    // And the verb that binds a port is not a tool of a host that cannot
    // answer a request: it comes with the package that can.
    assert(!host.tools.some((t) => t.name == 'serve'), 'serve with no server')
  } finally {
    host.close()
  }
})

Deno.test('two plugins may not both host the routes', async () => {
  let hosts: Plugged = { routes: { handler: () => () => new Response('one') } }
  await assertRejects(
    () =>
      compose(
        { db: ':memory:', plugins: ['a', 'b'] },
        only({ a: hosts, b: { routes: { ...hosts.routes } } }),
      ),
    Error,
    'a host has one',
  )
})

Deno.test('a process imports the facets of the roles it serves, and no others', async () => {
  let ran: string[] = []
  let busy: Plugged = {
    effects: { effects: () => ({}) },
    service: { service: () => void ran.push('busy') },
  }
  let asked = (roles: Role[]) => {
    let seen: string[] = []
    let load: Load = (spec, name) => {
      seen.push(`${spec}/${name}`)
      return only({ shop, busy })(spec, name)
    }
    return composing(
      { db: ':memory:', plugins: ['shop', 'busy'] },
      roles,
      load,
    ).then(async (host) => {
      await host.duties(AbortSignal.abort())
      await host.close()
      return seen.sort()
    })
  }
  // A plugin's `./tools` comes with the first call of one of its tools, and
  // nothing here calls one.
  let graph = ['rules', 'vocab']
  let of = (spec: string, names: string[]) => names.map((n) => `${spec}/${n}`)
  assertEquals(
    await asked(['graph']),
    [...of('busy', graph), ...of('shop', graph)],
  )
  assertEquals(ran, [], 'a process that does not serve a service ran it')
  // A plugin's service is a role of its own, so serving it imports that one
  // facet of that one plugin.
  assertEquals(
    await asked(['graph', 'effects', 'busy']),
    [
      ...of('busy', [...graph, 'effects', 'service']),
      ...of('shop', ['effects', ...graph]),
    ].sort(),
  )
  assertEquals(ran, ['busy'])
})

Deno.test('a service role names a plugin the config lists', async () => {
  await assertRejects(
    () =>
      composing(
        { db: ':memory:', plugins: ['shop'] },
        ['graph', '@yaks/mial'],
        only({ shop }),
      ),
    Error,
    'no plugin @yaks/mial',
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
})

Deno.test('a rule sees the graph it is part of, and an effect fires on a commit', async () => {
  let seen: string[] = []
  let mod: Plugged = {
    vocab: { docs: [doc, owes] },
    tools: { runs: () => ({ book_list: () => [], book_add: () => [] }) },
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
      effects: () => ({ book_seen: (e) => void seen.push(e.entity.eid) }),
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

Deno.test('a start-up pass is an effect on this process being born', async () => {
  let booted: string[] = []
  let mod: Plugged = {
    ...shop,
    vocab: {
      docs: [
        doc,
        processDoc,
        { $defs: { boot: { effect: true, created: ['process'] } } },
      ],
    },
    effects: {
      effects: (host) => ({
        // A `process` born here is either this run writing itself in or a
        // child it launched, and only the first is a start-up.
        boot: (e) => {
          if (e.entity.eid == host.me) booted.push(host.me)
        },
      }),
    },
  }
  let host = await compose({ db: ':memory:', plugins: ['m'] }, only({ m: mod }))
  try {
    // It has already run: composing the host is the start, and the pass ran
    // inside the batch that wrote the row.
    assertEquals(booted, [me])
    // A child's row wakes the same effect and is left alone.
    await host.graph.apply([{ entity: { eid: 'kid' }, process: { pid: 1 } }])
    assertEquals(booted, [me])
  } finally {
    host.close()
  }
})

// The whole host path, in one place: a word calls the tool here, the ask and
// the answer are written down as they go, and a call somebody else wrote is
// run by the effect the server registers.

Deno.test('the door calls the tool, and the call is the transcript', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop', ...HTTP] },
    only({ shop }),
  )
  try {
    // What `yak book add --title Spring` is once it reaches the server: one
    // POST to /mcp, which is the only way a line runs a tool here.
    let said = await serving(host)(
      new Request('http://h/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'book_add', arguments: { title: 'Spring' } },
        }),
      }),
    )
    assertEquals(said.status, 200)
    let reply = await said.json() as {
      result: { content: { text: string }[] }
    }
    assertEquals(reply.result.content[0].text, 'shelved Spring')

    // What was asked, and what came back, both written down — and the book
    // the tool answered is signed as the person who asked, not the server.
    let [call] = await host.graph.read('.call&?created&?execution')
    assertEquals((call.call as Comp).to, toolEid('book_add'))
    assertEquals((call.created as Comp).by, me)
    assertEquals((call.execution as Comp).state, 'done')
    let [result] = await host.graph.read('.result')
    assertEquals((result.result as Comp).call, call.entity.eid)
    let [book] = await host.graph.read('.book&?created')
    assertEquals((book.created as Comp).by, me)
  } finally {
    host.close()
  }
})

Deno.test('a call written through the door is run by the effect', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop', ...HTTP] },
    only({ shop }),
  )
  try {
    await host.runner.ensure()
    // Nobody is waiting on this one: it is a write like any other, through
    // the door a client uses. The rules are registered as effects, so the
    // call is run because it matched, not because somebody awaited it.
    let wrote = await serving(host)(
      new Request('http://h/apply', {
        method: 'POST',
        body: JSON.stringify([{
          entity: { eid: 'c1' },
          call: {
            to: toolEid('book_add'),
            args: { title: 'Later' },
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
      plugins: [
        { use: 'shop', with: { open: 'tuesdays' } },
        'quiet',
        ...HTTP,
      ],
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
            return {}
          },
        },
      },
    }),
  )
  try {
    assertEquals(said, [{}, { open: 'tuesdays' }])
    let res = await serving(host)(new Request('http://x/open'))
    assertEquals(await res.text(), 'tuesdays')
  } finally {
    host.close()
  }
})

// The `effect` word, which is what makes a host keep a pool at all, and its
// check, which comes with the word: a host that declares `effect_check` and
// implements nothing is a host that refuses to start.
let pooled = (effects: Plugged['effects']): Plugged => ({
  vocab: { docs: [doc, processDoc, effectDoc, owes] },
  tools: {
    runs: (host, options) => ({
      ...shop.tools?.runs?.(host, options),
      ...effectRuns(host, options),
    }),
  },
  effects,
})

Deno.test('a process coming up owes again what a declared sweep selects', async () => {
  let ran: string[] = []
  let host = await compose(
    { db: ':memory:', plugins: ['shop'] },
    only({
      shop: pooled({
        effects: () => ({
          // It reads the row it is handed, as a run always does.
          book_priced: async (event, tx) => {
            let [book] = await tx.get([event.entity.eid])
            ran.push(String((book.book as Comp).title))
          },
        }),
      }),
    }),
  )
  try {
    // Two books, one of them unpriced — the shape the sweep's query names.
    await host.graph.apply([
      { entity: { eid: 'b1' }, book: { title: 'Spring', price: 12 } },
      { entity: { eid: 'b2' }, book: { title: 'Winter' } },
    ])
    await host.duties(AbortSignal.abort())
    assertEquals(ran.sort(), ['Spring', 'Winter'])
    ran.length = 0
    // The next pass on the way in: only the book still unpriced comes back.
    await host.duties(AbortSignal.abort())
    assertEquals(ran, ['Winter'])
  } finally {
    await host.close()
  }
})

Deno.test('the pass a one-shot line makes runs the retries that are due', async () => {
  let ran: string[] = []
  let host = await compose(
    { db: ':memory:', plugins: ['shop'] },
    only({
      shop: pooled({
        effects: () => ({
          book_seen: (event) => void ran.push(String(event.entity.eid)),
        }),
      }),
    }),
  )
  try {
    // A line joins the pool on its way in, so what it writes it runs.
    await host.duties(AbortSignal.abort())
    await host.graph.apply([{ entity: { eid: 'b1' }, book: { title: 'One' } }])
    await host.fx.idle()
    assertEquals(ran, ['b1'])
    // The runs, written down and settled — no handler asked for any of this.
    let rows = await host.graph.read('.effect')
    assertEquals(rows.map((b) => (b.effect as Comp).state), ['done', 'done'])
    // A failure that reported, whose backoff has come up. Written as the
    // pool would have written it, so the pass below is the only thing under
    // test.
    await detached(host.storage).patch([{
      entity: { eid: 'r1' },
      effect: {
        handler: 'book_seen',
        target: 'b1',
        comp: 'book',
        kind: 'created',
        state: 'pending',
        attempts: 1,
        error: 'boom',
        next: new Date(Date.now() - 1).toISOString(),
      },
    }])
    ran.length = 0
    // One pass and out: a line passing through does what nobody is doing,
    // and what is owed is part of it.
    await host.duties(AbortSignal.abort())
    assertEquals(ran, ['b1'])
    assertEquals(
      ((await detached(host.storage).get(['r1']))[0].effect as Comp).state,
      'done',
    )
  } finally {
    await host.close()
  }
})

Deno.test('a host reads the letter an id wears, which no plugin registers', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop'] },
    only({ shop }),
  )
  try {
    // Without @yaks/id's keyword the declaration is dropped on load and a
    // component falls back to its own initial — `B-1` for a book that said K.
    assertEquals(prefixes(host.vocab).book, 'K')
  } finally {
    host.close()
  }
})

Deno.test('a duty runs while the host is up and stops when it closes', async () => {
  let beats = 0
  let stopped = false
  let host = await compose(
    { db: ':memory:', plugins: [{ use: 'clock', with: { every: 1 } }] },
    only({
      clock: {
        service: {
          service: (_h, options, signal) =>
            new Promise<void>((done) => {
              let timer = setInterval(() => beats++, Number(options.every))
              signal.addEventListener('abort', () => {
                clearInterval(timer)
                stopped = true
                done()
              })
            }),
        },
      },
    }),
  )
  // Composing is not holding: nothing is doing a duty until somebody asks to.
  assertEquals(beats, 0)
  void host.duties()
  let deadline = Date.now() + 5000
  while (!beats && Date.now() < deadline) {
    await new Promise((go) => setTimeout(go, 5))
  }
  assert(beats > 0, 'the duty never ran')
  await host.close()
  assert(stopped, 'closing the host did not let its duty go')
})

Deno.test('a signal that has already aborted is one pass and out', async () => {
  let passes = 0
  let host = await compose(
    { db: ':memory:', plugins: ['once'] },
    only({
      once: {
        // The shape every service promises: a pass first, then keep going
        // until the signal says stop.
        service: {
          service: async (_h, _o, signal) => {
            passes++
            while (!signal.aborted) {
              await new Promise((go) => setTimeout(go, 5))
            }
          },
        },
      },
    }),
  )
  try {
    // A one-shot line on its way in: it drains what is overdue and returns,
    // rather than holding a clock nobody asked it to hold.
    await host.duties(AbortSignal.abort())
    assertEquals(passes, 1)
  } finally {
    await host.close()
  }
})

Deno.test('a duty that throws is reported, and the host still serves', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop', 'broken', ...HTTP] },
    only({
      shop,
      broken: {
        service: {
          service: () => {
            throw new Error('no clock here')
          },
        },
      },
    }),
  )
  try {
    await host.duties(AbortSignal.abort())
    assertEquals(
      await (await serving(host)(new Request('http://x/shop/a'))).text(),
      '/shop/a',
    )
  } finally {
    await host.close()
  }
})

Deno.test('a one-shot pass lets every lease go, and a host with no duties takes none', async () => {
  let passes = 0
  let leases = async (duties: boolean) => {
    let host = await compose(
      {
        db: ':memory:',
        plugins: [
          '@yaks/effects',
          '@yaks/process',
          '@yaks/session',
          '@yaks/spawn',
          'once',
        ],
        duties,
      },
      only({
        once: { service: { service: () => Promise.resolve(void passes++) } },
      }),
    )
    try {
      await host.duties(AbortSignal.abort())
      // With nothing to hold, the long-running form has nothing to wait for.
      if (!duties) await host.duties()
      return (await host.graph.read('.lease')).map((b) => b.lease as Comp)
    } finally {
      await host.close()
    }
  }
  let taken = await leases(true)
  assert(taken.length > 0, 'the pass took no lease')
  assertEquals(taken.filter((l) => l.holder), [])
  assertEquals(passes, 1)
  assertEquals(await leases(false), [])
  assertEquals(passes, 1)
})

Deno.test('a property that declares its words searched is indexed, and ranked', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['shop', ...HTTP] },
    only({ shop }),
  )
  try {
    await host.graph.apply([
      { entity: { eid: 'b1' }, book: { title: 'the hobbit' } },
      { entity: { eid: 'b2' }, book: { title: 'a history of bread' } },
    ])
    // A bare word on any query line is a match — the store was given the
    // extension, so nothing had to ask for search by name.
    assertEquals(
      (await host.graph.read('hobbit')).map((b) => b.entity.eid),
      ['b1'],
    )
    // And the door lists the ranked tool, which the generic tier only has
    // when the host composed one.
    let said = await serving(host)(
      new Request('http://h/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { words: 'bread' } },
        }),
      }),
    )
    let reply = await said.json() as {
      result: { structuredContent: { result: { entity: { eid: string } }[] } }
    }
    assertEquals(
      reply.result.structuredContent.result.map((b) => b.entity.eid),
      ['b2'],
    )
  } finally {
    host.close()
  }
})

// T-37726: a settle timer that outlived its host fired into a closed store
// and printed a stack about nothing. The host's ending is one fact, and a
// facet that arms a timer hangs it off that fact.
Deno.test('a facet hangs its timer off the host ending, and closing cancels it', async () => {
  let late = 0
  let host = await compose(
    { db: ':memory:', plugins: ['settle'] },
    only({
      settle: {
        effects: {
          effects: (h) => {
            let timer = setTimeout(() => late++, 5)
            h.stopping.addEventListener('abort', () => clearTimeout(timer))
            return {}
          },
        },
      },
    }),
  )
  assert(!host.stopping.aborted, 'a host that is up is not stopping')
  await host.close()
  assert(host.stopping.aborted, 'closing the host did not say so')
  await new Promise((go) => setTimeout(go, 25))
  assertEquals(late, 0, 'a timer fired after the database was let go')
})

Deno.test('an option written {secret} is that secret, read each time it is asked for', async () => {
  let seen: Options | undefined
  let host = await compose(
    {
      db: ':memory:',
      plugins: [{
        use: 'mail',
        with: { sender: { token: { secret: 'YAK_TEST_TOKEN' } }, keep: [1, 2] },
      }, '@yaks/secrets'],
    },
    only({ mail: { rules: { rules: (_, options) => (seen = options, []) } } }),
  )
  try {
    let token = () => (seen!.sender as { token?: string }).token
    assertEquals(seen!.keep, [1, 2])
    // Nothing written: the environment variable of that name, as it is now.
    assertEquals(token(), undefined)
    Deno.env.set('YAK_TEST_TOKEN', 'from-env')
    assertEquals(token(), 'from-env')
    // Written through the graph, it wins — without a restart (T-37699).
    await host.graph.apply([sealed('YAK_TEST_TOKEN', 'hunter2')])
    assertEquals(token(), 'hunter2')
  } finally {
    Deno.env.delete('YAK_TEST_TOKEN')
    await host.close()
  }
})

Deno.test('a body kept in the store is still found by its own words', async () => {
  // The index is cut from the words, and a property that says `store: blob`
  // holds an address where its text was. An index raised over the raw column
  // would hold hashes, so the host hands its computed reads to the index the
  // same way it hands them to the store — a search over a long body is what
  // says whether it did.
  let post: VocabDoc = {
    title: 'blog',
    $defs: {
      entity: doc.$defs!.entity,
      created: doc.$defs!.created,
      updated: doc.$defs!.updated,
      post: {
        component: true,
        type: 'object',
        kind: true,
        prefix: 'P',
        properties: {
          title: { type: 'string', search: true },
          body: { type: 'string', store: 'blob', search: true },
        },
      },
    },
  }
  let host = await compose(
    { db: ':memory:', plugins: ['blog', ...HTTP] },
    only({
      blog: {
        vocab: { docs: [post], keywords: [blobKeywords], derived: blobRead },
        rules: { rules: blobRules },
      },
    }),
  )
  try {
    await host.graph.apply([{
      entity: { eid: 'p1' },
      post: { title: 'On lemons', body: 'three lemons and a drizzle of syrup' },
    }])
    let found = await serving(host)(new Request('http://h/query?q=drizzle'))
    let rows = await found.json()
    assertEquals(rows.length, 1)
    assertEquals(rows[0].post.title, 'On lemons')
  } finally {
    host.close()
  }
})
