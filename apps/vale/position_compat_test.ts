// Kept Vale pages keep their vocabulary after the saved location contracts.
import { equal, ok, test, throws, until } from '@yaks/testing'
import { type Bundle, graph, signed, token } from '@yaks/graph'
import { loadVocab, metaDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { compile, lenses, lensesIn, packageEid, versions } from '@yaks/lens'
import { docs as lensDocs } from '../../packages/lens/vocab.ts'
import { club } from '../../packages/member/testing.ts'
import { memberKeywords, members } from '@yaks/member'
import { completing } from '../../packages/kernel/completion.ts'
import { api } from '../../packages/api/route.ts'
import { type Frame, subscriptions } from '../../packages/api/subs.ts'
import core from '../../packages/kernel/vocab.json' with { type: 'json' }
import words from './vocab.json' with { type: 'json' }
import {
  contractPaths,
  lensRule,
  retainedLenses,
} from '../../workers/yak/lenses.ts'

let app = { ...words, package: '@app/vale-compat' }
let speaks = { [packageEid(app.package)]: 0 }
let moment = '2026-10-03T18:00:00.000Z', time = Date.parse(moment)
let person = { by: 'kim', via: 'browser' }
let value = (row: Bundle, name: string) => row[name] as Record<string, unknown>
let setup = async (guard = false, expanded = false, shuffled = false) => {
  let vocab = loadVocab([
    metaDoc,
    ...club.docs,
    { $defs: { completed: core.$defs.completed } },
    ...lensDocs,
    expanded
      ? {
        ...app,
        $defs: {
          ...app.$defs,
          seen: app.$defs.saved_position.ops[0].view.declaration,
        },
      }
      : app,
  ], [memberKeywords])
  let data = ram(vocab)
  let reordered = (value: unknown): unknown =>
    value && typeof value == 'object'
      ? Array.isArray(value) ? value.map(reordered) : Object.fromEntries(
        Object.entries(value).reverse().map(([k, v]) => [k, reordered(v)]),
      )
      : value
  let storage = shuffled
    ? {
      ...data,
      tx: (body: (tx: import('@yaks/graph').Tx) => unknown) =>
        data.tx((tx) =>
          body({
            ...tx,
            get: (ids, names) =>
              Promise.resolve(tx.get(ids, names)).then((rows) =>
                rows.map((r) => reordered(r) as Bundle)
              ),
          })
        ),
    } as typeof data
    : data
  let g = graph({
    vocab,
    storage,
    plugins: [
      lenses(() => {}, expanded ? { vocab, rows: lensesIn([app]) } : undefined),
    ],
  })
  await g.apply([
    {
      entity: { eid: packageEid(app.package) },
      _package: { name: app.package },
    },
    ...lensesIn([app]),
    {
      entity: { eid: 'app' },
      app: { space: 'club' },
      access: { mode: 'open' },
    },
    {
      entity: { eid: 'owner-seat' },
      member: { space: 'club', person: 'owner', role: 'owner' },
    },
    {
      entity: { eid: 'hero' },
      player: {},
      position: { level: 'mossvale', x: 1, z: 2, at: time },
      $actor: person,
    },
    {
      entity: { eid: 'beast' },
      position: { level: 'mossvale', x: 50, z: 50, at: time },
    },
    {
      entity: { eid: 'request' },
      teleport_request: { player: 'hero', level: 'mossvale', x: 10, z: 20 },
      $actor: { by: 'owner' },
    },
  ], { trusted: true, now: moment })
  if (guard) {
    g.use({ name: 'completion', hooks: { precondition: completing } })
    g.use(members({ app: 'app', space: 'club', vocab }))
  }
  return g
}
let old = async (g: ReturnType<typeof graph>) =>
  value((await g.get(['hero'], ['seen'], { speaks }))[0], 'seen')

test('kept Vale reads virtual membership, defaults, ISO time, fields, ordering and aggregates after contraction', async () => {
  let g = await setup()
  equal(await old(g), {
    level: 'mossvale',
    x: 1,
    z: 2,
    at: moment,
    yaw: 0,
    teleport: null,
  })
  equal(
    (await g.read('.seen .seen.yaw=0 .seen.at>=2026-10-03&.order=-seen.at', {
      speaks,
    })).map((r) => r.entity.eid),
    ['hero'],
  )
  equal(await g.rows('.seen&.fields=seen.x,seen.at', { speaks }), [{
    eid: 'hero',
    'seen.x': 1,
    'seen.at': moment,
  }])
  equal(await g.rows('.seen&.count', { speaks }), [{ n: 1, value: '' }])
  equal(
    (await g.read('.seen.at>=30s-ago', { speaks, now: time + 20_000 })).length,
    1,
  )
  equal(
    (await g.read('.seen.at>=30s-ago', { speaks, now: time + 40_000 })).length,
    0,
  )
  equal(
    (await g.read('!seen&*', { speaks })).some((r) => r.entity.eid == 'beast'),
    true,
  )
  let view = await g.view('.seen', { speaks })
  ok(view?.vocab.comp('seen'))
  ok(!g.vocab.comp('seen'))
})

test('kept Vale writes directed marks under the hero owner, guards converted values and refuses forged references', async () => {
  let g = await setup(true)
  await g.apply(
    signed([{
      entity: { eid: 'hero' },
      seen: { x: 3, at: moment, yaw: 1.5, teleport: 'request' },
      $speaks: speaks,
      $was: { seen: { at: token(moment), yaw: token(0) } },
    }], person),
    { now: moment },
  )
  equal(value((await g.get(['hero']))[0], 'position').x, 3)
  equal((await old(g)).teleport, 'request')
  equal(value((await g.get(['request']))[0], 'completed').by, 'kim')
  await throws(
    () =>
      g.apply(
        signed([{
          entity: { eid: 'hero' },
          seen: { x: 4 },
          $speaks: speaks,
          $was: { seen: { at: token('2026-10-02T00:00:00.000Z') } },
        }], person),
      ),
    'has moved',
  )
  await g.apply([{
    entity: { eid: 'next-request' },
    teleport_request: { player: 'hero', level: 'mossvale', x: 1, z: 2 },
    $actor: { by: 'owner' },
  }])
  await throws(() =>
    g.apply(
      signed([{
        entity: { eid: 'hero' },
        seen: { teleport: 'next-request' },
        $speaks: speaks,
      }], { by: 'stranger' }),
    )
  )
  await g.apply([{
    entity: { eid: 'other-request' },
    teleport_request: { player: 'beast', level: 'mossvale', x: 10, z: 20 },
    $actor: { by: 'owner' },
  }])
  await throws(
    () =>
      g.apply(
        signed([{
          entity: { eid: 'hero' },
          seen: { teleport: 'other-request' },
          $speaks: speaks,
        }], person),
      ),
    'must address',
  )
  equal((await g.get(['other-request']))[0].completed, undefined)
  await g.apply(
    signed([{
      entity: { eid: 'hero' },
      seen: { teleport: null },
      $speaks: speaks,
    }], person),
  )
  equal((await g.get(['request']))[0].completed, undefined)
  equal((await old(g)).teleport, null)
})

test('a request mark updates a kept hero subscription and HTTP replies include its old acknowledgement', async () => {
  let g = await setup(), frames: Frame[] = []
  let sink = (f: Frame) => {
    frames.push(f)
  }
  let subs = subscriptions(g), raw: Frame[] = []
  let rawSink = (f: Frame) => {
    raw.push(f)
  }
  await subs.open(rawSink, 'raw', true, { speaks })
  await subs.open(sink, 'hero', '.seen', { speaks })
  frames.length = 0
  await g.apply([{ entity: { eid: 'request' }, completed: { at: moment } }], {
    trusted: true,
    now: moment,
  })
  await until(() =>
    frames.some((f) =>
      f.bundles?.some((r) =>
        r.entity.eid == 'hero' && value(r, 'seen')?.teleport == 'request'
      )
    )
  )
  ok(
    frames.some((f) =>
      f.bundles?.some((r) =>
        r.entity.eid == 'hero' && value(r, 'seen')?.teleport == 'request'
      )
    ),
  )
  ok(
    raw.some((f) =>
      f.bundles?.some((r) =>
        r.entity.eid == 'hero' && value(r, 'seen')?.teleport == 'request'
      )
    ),
  )
  let handler = api({
    graph: g,
    authenticate: () => person,
    read: () => ({ speaks }),
    write: (_, rows) => rows.map((r) => ({ ...r, $speaks: speaks })),
  })
  let response = await handler(
    new Request('http://vale/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{
        entity: { eid: 'hero' },
        seen: { x: 7, teleport: 'request' },
      }]),
    }),
  )
  equal(response.status, 200)
  let reply = await response.json() as Bundle[]
  ok(
    reply.some((r) =>
      r.entity.eid == 'hero' && value(r, 'seen')?.x == 7 &&
      value(r, 'seen')?.teleport == 'request'
    ),
  )
  await subs.drop(sink)
  await subs.drop(rawSink)
})

test('the mover preserves newer saved values, historical attribution, contracts membership and retains rollback views', () => {
  let chain = compile(lensesIn([app]))
  let source: Bundle = {
    entity: { eid: 'hero' },
    player: {},
    seen: { level: 'old', x: 1, z: 2, at: moment, teleport: 'request', yaw: 2 },
    position: { level: 'new', x: 99, z: 99, at: time + 1 },
    updated: { by: 'kim', via: 'browser', at: moment },
  }
  let request: Bundle = {
    entity: { eid: 'request' },
    teleport_request: { player: 'hero' },
  }
  let moved = chain.put([source], { facts: [source, request], migrate: true })
  equal(moved[0].position, source.position)
  equal(moved[1].completed, { by: 'kim', via: 'browser', at: moment })
  let noAck = { ...source, seen: { ...value(source, 'seen'), teleport: null } }
  equal(
    chain.put([noAck], {
      facts: [noAck, { ...request, completed: { at: moment } }],
      migrate: true,
    }).length,
    1,
  )
  let contracted = contractPaths(app, ['seen'])
  ok(!contracted.$defs?.seen)
  let legacy = {
    ...app,
    $defs: {
      ...app.$defs,
      seen: app.$defs.saved_position.ops[0].view.declaration,
    },
  }
  delete (legacy.$defs as Record<string, unknown>).saved_position
  let rollback = retainedLenses(contracted, legacy)
  ok(!rollback.$defs?.seen)
  ok(
    compile(lensesIn([rollback])).schema([rollback]).some((d) =>
      !!d.$defs?.seen
    ),
  )
  equal(lensRule('vale', app)?.live, undefined)
})

test('unmoved seen rows still answer kept pages while migration is rehearsal-only', async () => {
  let g = await setup(false, true)
  await g.apply([{
    entity: { eid: 'pending' },
    player: {},
    seen: { level: 'mossvale', x: 8, z: 9, at: moment, yaw: 1.2 },
  }])
  let rows = await g.read('.seen.x=8', { speaks })
  equal(rows.map((r) => r.entity.eid), ['pending'])
  equal(value(rows[0], 'seen').yaw, 0)
  equal(value(rows[0], 'seen').at, moment)
  equal(
    (await g.get(['pending'], undefined, { native: true }))[0].position,
    undefined,
  )
  equal(await g.view('.item', { speaks }), null)
})

test('an old acknowledgement write checks its addressed reference inside the canonical transaction', async () => {
  let g = await setup()
  let once = false
  g.use({
    name: 'concurrent-request-edit',
    hooks: {
      prepare: async (rows) => {
        if (!once) {
          once = true
          await g.apply([{
            entity: { eid: 'request' },
            teleport_request: { player: 'beast' },
          }])
        }
        return rows
      },
    },
  })
  await throws(
    () =>
      g.apply([{
        entity: { eid: 'hero' },
        seen: { teleport: 'request' },
        $speaks: speaks,
      }]),
    'has moved',
  )
  equal((await g.get(['request']))[0].completed, undefined)
  equal((await old(g)).teleport, null)
})

test('canonical expansion reads pending saved position and acknowledgement without persisting either', async () => {
  let g = await setup(false, true)
  await g.apply([
    {
      entity: { eid: 'pending' },
      player: {},
      seen: {
        level: 'mossvale',
        x: 8,
        z: 9,
        at: moment,
        teleport: 'pending-request',
      },
    },
    {
      entity: { eid: 'pending-request' },
      teleport_request: { player: 'pending', level: 'mossvale', x: 8, z: 9 },
    },
  ])
  let hero = (await g.read('.player ?position&*')).find((r) =>
    r.entity.eid == 'pending'
  )!
  let currentSpeaks = versions([app])
  equal(
    (await g.read('.player .position', { speaks: currentSpeaks })).length,
    2,
  )
  equal(
    (await g.read('.teleport_request.player=pending .completed', {
      speaks: currentSpeaks,
    })).length,
    1,
  )
  equal(value(hero, 'position'), { level: 'mossvale', x: 8, z: 9, at: time })
  let request =
    (await g.read('.teleport_request.player=pending .completed&*'))[0]
  equal(value(request, 'completed').at, moment)
  equal(
    (await g.read(
      '.teleport_request.player=pending (.completed.by=kim | .completed.at>=2026-10-03T00:00:00Z)',
    )).length,
    1,
  )
  equal(await g.rows('.teleport_request.player=pending .completed&.count'), [{
    n: 1,
    value: '',
  }])
  equal(
    (await g.get(['pending'], undefined, { native: true }))[0].position,
    undefined,
  )
  equal(
    (await g.get(['pending-request'], undefined, { native: true }))[0]
      .completed,
    undefined,
  )
  let subs = subscriptions(g)
  equal((await subs.read('.player .position.level=mossvale')).length, 0)
  let holder = () => {}
  await subs.relay(holder, [{
    entity: { eid: 'pending' },
    position: { level: 'mossvale', x: 10, z: 11, at: time },
  }])
  equal(
    (await subs.read('.player .position.level=mossvale')).map((r) =>
      r.entity.eid
    ),
    ['pending'],
  )
  await subs.drop(holder)
  equal((await subs.read('.player .position.level=mossvale')).length, 0)
  equal(
    (await subs.read('.player .position.level=mossvale', { durable: true }))
      .length,
    2,
  )
})

test('newest marked request wins by its declared order, with a deterministic eid tie break', async () => {
  let g = await setup()
  await g.apply([
    {
      entity: { eid: 'zzz-earlier' },
      teleport_request: { player: 'hero' },
      completed: { at: moment },
    },
  ], { trusted: true, now: '2026-10-03T17:00:00.000Z' })
  await g.apply([
    {
      entity: { eid: 'aaa-latest' },
      teleport_request: { player: 'hero' },
      completed: { at: moment },
    },
  ], { trusted: true, now: '2026-10-03T19:00:00.000Z' })
  equal((await old(g)).teleport, 'aaa-latest')
  equal((await g.read('.seen.teleport=zzz-earlier', { speaks })).length, 0)
  equal((await g.read('.seen.teleport=aaa-latest', { speaks })).length, 1)
})

test('partial writes preserve pending locations and explicit clears consume their sources', async () => {
  for (
    let mode of [
      'old-partial',
      'old-clear',
      'old-whole',
      'current-partial',
      'current-clear',
    ]
  ) {
    let clear = mode.endsWith('clear') || mode == 'old-whole'
    let whole = mode == 'old-whole'
    let g = await setup(true, true)
    await g.apply([
      {
        entity: { eid: 'pending' },
        player: {},
        seen: {
          level: 'mossvale',
          x: 8,
          z: 9,
          at: moment,
          teleport: 'pending-request',
        },
        $actor: person,
      },
    ], { now: moment })
    await g.apply([
      {
        entity: { eid: 'pending-request' },
        teleport_request: { player: 'pending', level: 'mossvale', x: 8, z: 9 },
        $actor: { by: 'owner' },
      },
    ], { now: moment })
    let patch: Bundle = mode == 'current-clear'
      ? { entity: { eid: 'pending-request' }, completed: null }
      : mode == 'current-partial'
      ? { entity: { eid: 'pending' }, position: { x: 88 } }
      : {
        entity: { eid: 'pending' },
        seen: whole ? null : clear ? { teleport: null } : { x: 88 },
      }
    patch.$speaks = mode.startsWith('current') ? versions([app]) : speaks
    let reply = await g.apply(signed([patch], person), {
      now: '2026-10-04T00:00:00.000Z',
    })
    ok(reply.length)
    if (whole) {
      let keptReply = await g.answer(reply, { speaks, patch: true })
      equal(keptReply.find((r) => r.entity.eid == 'pending')?.seen, null)
    }
    let hero = (await g.get(['pending'], undefined, { native: true }))[0]
    equal(hero.seen, undefined)
    if (whole) equal(hero.position, undefined)
    else {
      equal(value(hero, 'position'), {
        level: 'mossvale',
        x: clear ? 8 : 88,
        z: 9,
        at: time,
      })
    }
    let request =
      (await g.get(['pending-request'], undefined, { native: true }))[0]
    if (clear) equal(request.completed, undefined)
    else {
      equal(value(request, 'completed'), {
        at: moment,
        by: person.by,
        via: person.via,
      })
    }
    let kept = (await g.get(['pending'], ['seen'], { speaks }))[0]
    if (whole) equal(kept.seen, undefined)
    else equal(value(kept, 'seen').teleport, clear ? null : 'pending-request')
  }
})

test('canonical expansion keeps relation facts when a caller projects only request metadata', async () => {
  let g = await setup(false, true)
  await g.apply([{
    entity: { eid: 'pending' },
    player: {},
    seen: {
      level: 'mossvale',
      x: 8,
      z: 9,
      at: moment,
      teleport: 'pending-request',
    },
  }, {
    entity: { eid: 'pending-request' },
    teleport_request: { player: 'pending', level: 'mossvale', x: 8, z: 9 },
  }], { trusted: true, now: moment })
  let metadata = (await g.get(['pending-request'], ['created']))[0]
  equal(metadata.entity.eid, 'pending-request')
  equal(Object.keys(metadata).sort(), ['created', 'entity'])
})

test('deploying the Vale view preserves stored eid text when the request becomes a keep reference', async () => {
  let driver = open(':memory:')
  try {
    let declaration = app.$defs.saved_position.ops[0].view.declaration
    let before = structuredClone(app) as import('@yaks/vocab').VocabDoc
    delete before.$defs!.saved_position
    delete before.$defs!.position
    before.$defs!.seen = declaration
    before.$defs!.teleport_request.properties!.player = {
      type: 'string',
      index: true,
    }
    let oldVocab = loadVocab([metaDoc, archetypeDoc, ...lensDocs, core, before])
    let oldGraph = graph({
      vocab: oldVocab,
      storage: storage(driver, oldVocab),
      plugins: [archetypes()],
    })
    oldGraph.install()
    await oldGraph.apply([{
      entity: { eid: 'pending' },
      player: {},
      seen: {
        level: 'mossvale',
        x: 8,
        z: 9,
        at: moment,
        teleport: 'pending-request',
      },
    }, {
      entity: { eid: 'pending-request' },
      teleport_request: { player: 'pending', level: 'mossvale', x: 8, z: 9 },
    }], { trusted: true, now: moment })
    let vocab = loadVocab([metaDoc, archetypeDoc, ...lensDocs, core, {
      ...app,
      $defs: { ...app.$defs, seen: declaration },
    }])
    let g = graph({
      vocab,
      storage: storage(driver, vocab),
      plugins: [
        lenses(undefined, { vocab, rows: lensesIn([app]) }),
        archetypes(),
      ],
    })
    g.install()
    await g.apply([
      {
        entity: { eid: packageEid(app.package) },
        _package: { name: app.package },
      },
      ...lensesIn([app]),
    ], { trusted: true })
    let held =
      (await g.get(['pending-request'], undefined, { native: true }))[0]
    equal(value(held, 'teleport_request').player, 'pending')
    equal(
      (await g.read('.teleport_request.player=pending .completed')).length,
      1,
    )
    equal(
      (await g.read('.player .position')).map((r) => value(r, 'position').x),
      [8],
    )
    equal(
      (await g.get(['pending-request'], ['created']))[0].entity.eid,
      'pending-request',
    )
    let source = (await g.get(['pending'], undefined, { native: true }))[0]
    equal(source.position, undefined)
    equal(value(source, 'seen').teleport, 'pending-request')
    equal(
      (await g.read('.seen.teleport=pending-request', { speaks })).length,
      1,
    )
    ok(source.entity.archetype)
    let rule = lensRule('vale-compat', app)!
    let patches = (await g.read(rule.find, { native: true })).flatMap((row) =>
      rule.move(row, (q) => g.read(q, { native: true }) as Bundle[])
    )
    await g.apply(signed(patches, null), { trusted: true })
    equal((await g.read('.seen', { native: true })).length, 0)
    equal((await g.read('.player .position')).length, 1)
    equal((await g.read('.teleport_request .completed')).length, 1)
  } finally {
    driver.close()
  }
})

test('equivalent transaction facts preserve old writes and mover patches despite object key order', async () => {
  for (let move of [false, true]) {
    for (let acknowledgement of [null, 'pending-request']) {
      let g = await setup(false, true, true)
      await g.apply([{
        entity: { eid: 'pending' },
        player: {},
        seen: {
          level: 'mossvale',
          x: 8,
          z: 9,
          at: moment,
          teleport: acknowledgement,
        },
      }, {
        entity: { eid: 'pending-request' },
        teleport_request: { player: 'pending', level: 'mossvale', x: 8, z: 9 },
      }], { trusted: true, now: moment })
      if (move) {
        let rule = lensRule('vale-compat', app)!
        let patches = (await g.read(rule.find, { native: true })).flatMap((
          row,
        ) => rule.move(row, (q) => g.read(q, { native: true }) as Bundle[]))
        await g.apply(signed(patches, null), { trusted: true })
      } else {
        await g.apply([{
          entity: { eid: 'pending' },
          seen: { x: 88 },
          $speaks: speaks,
        }])
      }
      equal(value((await g.get(['pending']))[0], 'position').x, move ? 8 : 88)
      equal((await g.read('.seen', { native: true })).length, 0)
      equal(
        (await g.read('.teleport_request .completed')).length,
        acknowledgement ? 1 : 0,
      )
    }
  }
})
