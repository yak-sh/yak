// The page waits for all of the store's words before it opens a local graph.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { client } from '@yaks/client'
import { connect, vocabulary } from './net.ts'
import { seedDesigns } from './designs_fixture.ts'
import words from './vocab.json' with { type: 'json' }
import core from '../../packages/kernel/vocab.json' with { type: 'json' }
import { docDoc } from '@yaks/doc'

test('a vocabulary 500 recovers before the page can query created', async () => {
  using time = new FakeTime()
  let fetchBefore = globalThis.fetch
  let calls = 0
  let urls: string[] = []
  try {
    globalThis.fetch = (url) => {
      urls.push(String(url))
      return Promise.resolve(
        ++calls == 1
          ? new Response('store unavailable', { status: 500 })
          : Response.json([words, core]),
      )
    }

    let opened = false
    let opening = vocabulary(new URL('https://example.test/vale/api/'))
      .then((vocab) => {
        opened = true
        return vocab
      })
    await time.tickAsync(0)
    assertEquals(calls, 1)
    assertEquals(opened, false)
    await time.tickAsync(1000)
    let vocab = await opening
    assertEquals(calls, 2)
    assertEquals(
      urls,
      Array(2).fill('https://example.test/vale/api/vocab.json'),
    )
    assertEquals(vocab.comp('created')?.name, 'created')
    let page = client(vocab, [], { vault: false, wireVault: false })
    assertEquals(page.read('.player&.created.by="person"&*'), [])
    page.close()
  } finally {
    globalThis.fetch = fetchBefore
  }
})

test('creature builds use the server answer without matching computed current locally', async () => {
  seedDesigns()
  let socket = pair().client
  let vocab = loadVocab([words, core, builderDoc, docDoc])
  let page = connect(new URL('https://example.test/vale/api/'), vocab, {
    connect: () => socket,
    fetch: () => Response.json([]),
    timer: () => {},
  })
  let graph = page.client
  try {
    // There is deliberately no local computed rule for built.current.
    assertThrows(() => graph.read(SPAWN_KINDS), Error, 'built.current')
    let ready = false
    let opening = page.spawnKinds().then(() => ready = true)
    assertEquals(ready, false)
    socket.emit('open')
    let ask = socket.sent.map((frame) =>
      frame as { id: string; subscribe?: string }
    )
      .find((frame) => frame.subscribe == SPAWN_KINDS)
    assert(ask, JSON.stringify(socket.sent))
    let failureAsk = (socket.sent as { id: string; subscribe?: string }[])
      .find((frame) => frame.subscribe == SPAWN_FAILURES)!
    assert(failureAsk, JSON.stringify(socket.sent))
    socket.emit('message', JSON.stringify({ id: failureAsk.id, bundles: [] }))
    socket.emit(
      'message',
      JSON.stringify({
        id: ask.id,
        bundles: [
          {
            entity: { eid: 'kind' },
            built: { current: true, slot: 'kind', build: 'build' },
          },
          {
            entity: { eid: 'build' },
            build: { variant: 'main', for: 'spawn' },
          },
          {
            entity: { eid: 'spawn' },
            spawned: { lvl: 1, x: 0, z: 0, roam: 2 },
          },
        ],
      }),
    )
    await opening
    assertEquals(ready, true)
    let person = crypto.randomUUID()
    let refused = [{
      entity: { eid: 'refused-build' },
      build: { variant: 'main', for: 'refused-spawn' },
      failed: {
        reason: 'figure names no creature',
        at: '2026-10-05T00:00:00Z',
      },
    }, {
      entity: { eid: 'refused-spawn' },
      spawned: { lvl: 1, x: 0 },
      created: { by: person },
      doc: { body: 'a bear' },
    }]
    socket.emit(
      'message',
      JSON.stringify({ id: failureAsk.id, bundles: refused }),
    )
    assertEquals(
      spawnNotices(page.world().spawnFailures(), person).map((n) => n.text),
      [
        'Could not spawn a bear: figure names no creature',
      ],
    )
    assertEquals(
      kindOf({
        entity: { eid: 'spawn' },
        spawned: { lvl: 1, x: 0, z: 0, roam: 2 },
      }),
      'kind',
    )
    socket.emit(
      'message',
      JSON.stringify({
        id: ask.id,
        bundles: [],
        gone: ['kind', 'build', 'spawn'],
      }),
    )
    assertEquals(
      kindOf({
        entity: { eid: 'spawn' },
        spawned: { lvl: 1, x: 0, z: 0, roam: 2 },
      }),
      undefined,
    )
  } finally {
    page.close()
    useSpawnKinds([])
  }
})

import { loadVocab } from '@yaks/vocab'
import { builderDoc } from '@yaks/builders/vocab'
import { pair } from '../../packages/sync/testing.ts'
import {
  kindOf,
  SPAWN_FAILURES,
  SPAWN_KINDS,
  spawnNotices,
  useSpawnKinds,
} from './spawn.ts'

test('figures wait for current-main provenance and disappear when stale', async () => {
  let socket = pair().client
  let page = connect(
    new URL('https://example.test/vale/api/'),
    loadVocab([words, core, builderDoc]),
    {
      connect: () => socket,
      fetch: () => Response.json([]),
      timer: () => {},
    },
  )
  try {
    let opening = page.figures()
    socket.emit('open')
    let asks = socket.sent as { id: string; subscribe?: string }[]
    let figures = asks.find((a) => a.subscribe == FIGURE_ROWS)!
    let builds = asks.find((a) => a.subscribe == FIGURE_BUILDS)!
    assert(figures && builds)
    let figure = { ...figureSeeds[0].figure, of: 'made' }
    socket.emit(
      'message',
      JSON.stringify({
        id: figures.id,
        coverage: {
          figure: { figure: true, built: ['build'] },
        },
        bundles: [{ entity: { eid: 'made' }, beast_design: {} }, {
          entity: { eid: 'build' },
          build: { variant: 'main' },
        }, {
          entity: { eid: 'figure' },
          figure,
          built: { build: 'build' },
        }],
      }),
    )
    assertEquals(FIGURES.made, undefined)
    socket.emit(
      'message',
      JSON.stringify({
        id: builds.id,
        bundles: [
          {
            entity: { eid: 'figure' },
            built: { current: true, build: 'build' },
          },
          { entity: { eid: 'build' }, build: { variant: 'main' } },
        ],
      }),
    )
    await opening
    assertEquals<unknown>(FIGURES.made, figure)
    socket.emit(
      'message',
      JSON.stringify({ id: builds.id, bundles: [], gone: ['figure', 'build'] }),
    )
    assertEquals(FIGURES.made, undefined)
  } finally {
    page.close()
    useFigures(figureSeeds)
  }
})

import { FIGURE_BUILDS, FIGURE_ROWS, FIGURES, useFigures } from './figure.ts'
import { rows as figureSeeds } from './figures_fixture.ts'

test('spawn command sends no obsolete player input even with a selected hero', async () => {
  seedDesigns()
  let before = globalThis.fetch
  let sent: unknown[] = []
  let socket = pair().client
  let page = connect(
    new URL('https://example.test/vale/api/'),
    loadVocab([words, core, builderDoc]),
    {
      connect: () => socket,
      fetch: () => Response.json([]),
      timer: () => {},
    },
  )
  try {
    let net = page.world()
    net.choose('hero')
    globalThis.fetch = (_url, init) => {
      sent.push(JSON.parse(String(init?.body)))
      return Promise.resolve(Response.json({ text: 'Done.' }))
    }
    await net.command('spawn', { beast: 'a large polar bear' })
    assertEquals(sent, [{
      name: 'spawn',
      args: { beast: 'a large polar bear' },
    }])
  } finally {
    globalThis.fetch = before
    page.close()
  }
})

import { effort, LODES, naturalEid } from './gather.ts'
import { flat, type Prop } from './terrain.ts'
import { type WorkFrame, working } from './work.ts'
import { placeOf } from './area.ts'
import { comp } from './bundle.ts'
import { api } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import type { ClientOpts } from '@yaks/client'
import type { Trouble } from '@yaks/sync'
import type { Bundle } from './net.ts'

// A page whose selected hero has arrived, with each watch answered explicitly.
let storePage = (opts: Pick<ClientOpts, 'fetch' | 'report'> = {}) => {
  let socket = pair().client
  let page = connect(
    new URL('https://example.test/vale/api/'),
    loadVocab([words, core]),
    {
      connect: () => socket,
      fetch: () => Response.json([]),
      timer: () => {},
      ...opts,
    },
  )
  let net = page.world()
  net.choose('hero')
  socket.emit('open')
  let receive = (query: string, bundles: Bundle[]) => {
    let ask = (socket.sent as { id: string; subscribe?: string }[])
      .find((a) => a.subscribe?.includes(query))!
    assert(ask, query)
    socket.emit('message', JSON.stringify({ id: ask.id, bundles }))
  }
  receive('.entity.eid=', [{ entity: { eid: 'hero' }, player: {} }])
  return { page, net, receive, [Symbol.dispose]: page.close }
}

let harvest = (eid: string, node = 'tree'): Bundle => ({
  entity: { eid },
  item: { owner: 'hero', kind: 'oaklog', n: 1, at: 1000 },
  gathered: { node, life: 0, kind: 'oak', at: 1000 },
  place: placeOf(5, 5),
})

test('a returning hero cannot gather a life already known by their bag', () => {
  seedDesigns()
  let prop: Prop = { kind: 'oak', x: 5, z: 5, seed: 1, natural: true }
  let eid = naturalEid(prop)
  let natural = [{ prop, at: [5, 5, 5] as [number, number, number] }]
  for (
    let [source, query, place] of [
      ['bag projection', '.item.owner=', undefined],
      ['bag outside area', '.item.owner=', placeOf(1000, 1000)],
      ['nearby', '.place.chunk=', placeOf(5, 5)],
    ] as const
  ) {
    using client = storePage()
    let { net, receive } = client
    // The new area's world watch has not answered yet. The bag's projection
    // remembers gatherings without their place, wherever the hero has been.
    let row = harvest('harvest', eid)
    if (place) row.place = place
    else delete row.place
    receive(query, [row])
    net.follow(5, 5)
    let toil = working(net), v = flat(5, [], [prop])
    let f: WorkFrame = {
      body: { x: 3, y: 5, z: 5 },
      sheet: { bag: [], worn: {} },
      down: false,
      now: 1001,
    }
    let start = toil.tick(v, f, true, false, natural)
    assertEquals(start.doing, null, source)
    assertEquals(start.nodes.find((n) => n.eid == eid)?.spent, true, source)
    f.now += effort(LODES.oak, 1)
    assertEquals(
      toil.tick(v, f, false, false, natural).events.some((e) =>
        e.type == 'got'
      ),
      false,
      source,
    )
    assertEquals(
      net.gathered().map((b) => comp(b, 'gathered').node),
      [eid],
      source,
    )
  }
})

test('a gathering refused locally or by the store does not break later writes', async () => {
  seedDesigns()
  for (let where of ['page', 'store'] as const) {
    using time = new FakeTime()
    let vocab = loadVocab([words, core])
    let store = graph({ storage: ram(vocab), vocab })
    store.apply([{ entity: { eid: 'hero' }, player: {} }, harvest('first')])
    let serve = api({
      graph: store,
      authenticate: () => ({ by: '11111111-1111-4111-8111-111111111111' }),
    })
    let trouble: Trouble[] = [], sent: Request[] = []
    using client = storePage({
      fetch: (request) => {
        sent.push(request)
        let url = new URL(request.url)
        url.pathname = '/apply'
        return serve(new Request(url, request))
      },
      report: (r) => trouble.push(r),
    })
    let { net, page, receive } = client
    if (where == 'page') receive('.item.owner=', [harvest('first')])
    net.keep(harvest('second'))
    await time.tickAsync(0)
    assertEquals(trouble.length, 1, where)
    assert(
      String(trouble[0].error ?? trouble[0].refused?.message).includes(
        'unique constraint failed',
      ),
      where,
    )
    assertEquals(page.client.ent('second')?.gathered, undefined, where)
    assertEquals(
      net.gathered().map((b) => b.entity.eid),
      where == 'page' ? ['first'] : [],
      where,
    )
    assertEquals(sent.length, where == 'page' ? 0 : 1, where)
    net.keep(harvest('third', 'another-tree'))
    net.flush()
    await time.tickAsync(0)
    assertEquals(trouble.length, 1, where)
    assertEquals((await store.read('.gathered')).map((b) => b.entity.eid), [
      'first',
      'third',
    ], where)
    assertEquals(
      net.gathered().some((b) => b.entity.eid == 'third'),
      true,
      where,
    )
  }
})
