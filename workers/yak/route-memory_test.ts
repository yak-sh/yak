import { graph, mint } from '@yaks/graph'
import { edits, mode, reads } from '@yaks/member'
import { by, tally } from '@yaks/sql'
import { bounded } from '@yaks/durable-object/ceiling'
import { whole } from '@yaks/query'
import { ram } from '@yaks/ram'
import { clock, equal, ok, test } from '@yaks/testing'
import { within } from './defects.ts'
import { directory, type Row, storeAt } from './directory.ts'
import { EPOCH } from './directory-copy.ts'
import { doorOf } from './door.ts'
import { Store } from './graph.ts'
import { db, slot, state } from './testing.ts'
import { platformVocab } from './vocab.ts'

let fixture = (initial: 'viewer' | 'editor' = 'viewer') => {
  let env = { CLOCK: clock() }
  let space = mint(), app = mint(), person = mint(), grant = mint()
  let place = { entity: { eid: space }, space: { slug: 'ada', store: 'ada' } }
  let definition = (
    access: 'public' | 'private' = 'private',
    version = 1,
  ): Row => ({
    entity: { eid: app },
    app: { slug: 'cookbook', space, access, store: 'ada/cookbook', version },
  })
  let standing = (access: 'viewer' | 'editor'): Row => ({
    entity: { eid: grant },
    grant: { app, person, access },
  })
  let rows = new Map<string, Row>([
    [space, place],
    [app, definition()],
    [grant, standing(initial)],
  ])
  let revision = 1
  let trips = 0
  let pending: Promise<void>[] = []
  let hold: ((answer: Response) => Promise<Response>) | undefined
  let via = {
    fetch: async (request: Request) => {
      if (request.method == 'POST') {
        let { entities } = await request.json() as { entities: Row[] }
        for (let row of entities) rows.set(row.entity.eid, row)
        revision++
        return Response.json(entities)
      }
      trips++
      let answer = Response.json([...rows.values()], {
        headers: { [EPOCH]: String(revision) },
      })
      let delayed = hold
      hold = undefined
      return delayed ? await delayed(answer) : answer
    },
  }
  let binding = {}
  let client = () => directory(via, { memory: binding, time: env.CLOCK })
  let route = (write = false, memory = true) =>
    within(
      {},
      {},
      () =>
        client().page(
          'ada',
          'cookbook',
          person,
          false,
          undefined,
          false,
          memory
            ? (page) => {
              if (!page.app || page.app.trashed) return false
              return (write ? edits : reads)(
                mode(page.app.access),
                page.role ?? page.grants?.get(app) ?? null,
              )
            }
            : undefined,
        ),
      env.CLOCK,
      { retain: (work) => pending.push(work) },
    )
  return {
    env,
    via,
    person,
    route,
    fresh: () => route(false, false),
    advance: env.CLOCK.advance,
    trips: () => trips,
    refreshing: () => pending.length,
    settled: () => Promise.all(pending.splice(0)),
    revokeElsewhere: () => {
      rows.delete(grant)
      revision++
    },
    grantEditorElsewhere: () => {
      rows.set(grant, standing('editor'))
      revision++
    },
    hideElsewhere: () => {
      rows.delete(app)
      revision++
    },
    publishElsewhere: (version = 1) => {
      rows.set(app, definition('private', version))
      revision++
    },
    makePublic: () => client().apply({ entities: [definition('public')] }),
    holdNext: () => {
      let began = Promise.withResolvers<void>()
      let finish = Promise.withResolvers<void>()
      hold = async (answer) => {
        began.resolve()
        await finish.promise
        return answer
      }
      return { began: began.promise, finish: finish.resolve }
    },
  }
}

test('a route stops standing at 30 seconds even while its refresh is pending', async () => {
  let f = fixture()
  equal((await f.route()).remembered, undefined)
  await f.advance(14_999)
  equal((await f.route()).remembered, 30_000)
  equal(f.trips(), 1)

  let refresh = f.holdNext()
  await f.advance(1)
  equal((await f.route()).remembered, 30_000)
  equal(f.refreshing(), 1)
  await refresh.began
  f.revokeElsewhere()
  try {
    await f.advance(14_999)
    equal((await f.route()).remembered, 30_000)
    equal(f.trips(), 2)
    await f.advance(1)
    let revoked = await f.route()
    equal([revoked.remembered, revoked.grants?.size, f.trips()], [
      undefined,
      0,
      3,
    ])
  } finally {
    refresh.finish()
    await f.settled()
  }
  let revoked = await f.route()
  equal([revoked.remembered, revoked.grants?.size, f.trips()], [
    undefined,
    0,
    4,
  ])
})

test('a successful refresh has its own 30 seconds including the time it spent reading', async () => {
  let f = fixture()
  await f.route()
  await f.advance(15_000)
  let refresh = f.holdNext()
  equal((await f.route()).remembered, 30_000)
  equal(f.refreshing(), 1)
  await refresh.began
  f.revokeElsewhere()
  await f.advance(5_000)
  refresh.finish()
  await f.settled()

  await f.advance(24_999)
  let second = f.holdNext()
  equal((await f.route()).remembered, 45_000)
  equal(f.refreshing(), 1)
  await second.began
  try {
    await f.advance(1)
    let revoked = await f.route()
    equal([revoked.remembered, revoked.grants?.size], [undefined, 0])
  } finally {
    second.finish()
    await f.settled()
  }
})

test('a directory write clears the isolate’s space even if an old refresh finishes afterward', async () => {
  let f = fixture()
  await f.route()
  await f.advance(15_000)
  let refresh = f.holdNext()
  ok((await f.route()).remembered)
  equal(f.refreshing(), 1)
  await refresh.began
  try {
    await f.makePublic()
  } finally {
    refresh.finish()
    await f.settled()
  }
  let fresh = await f.route()
  equal([fresh.remembered, fresh.app?.access, fresh.app?.policy], [
    undefined,
    'public',
    2,
  ])
  ok((await f.route()).remembered)
})

test('a new grant can admit a write and a new app can admit a read immediately', async () => {
  let f = fixture()
  await f.route()
  ok((await f.route()).remembered)
  f.grantEditorElsewhere()
  let editor = await f.route(true)
  equal([editor.remembered, [...editor.grants!.values()]], [
    undefined,
    ['editor'],
  ])
  ok((await f.route(true)).remembered)

  let missing = fixture()
  missing.hideElsewhere()
  equal((await missing.route()).app, null)
  missing.publishElsewhere()
  ok((await missing.route()).app)
})

test('Store admits a remembered older revision without relearning it and rereads a queued write at replay', async () => {
  let f = fixture('editor')
  let ctx = state('ada/cookbook')
  using _storage = ctx.storage
  bounded(ctx.storage, { refuse: true, now: f.env.CLOCK.now, report: () => {} })
  let rechecks = 0
  let store = new Store(ctx, {
    ...f.env,
    STORE: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (req) => {
          let q = new URL(req.url).searchParams.get('q')
          let snapshot = await f.via.fetch(req)
          if (!q?.includes('&?published&?demo')) return snapshot
          rechecks++
          let vocab = platformVocab()
          let directory = graph({ storage: ram(vocab), vocab })
          await directory.apply(await snapshot.json(), { trusted: true })
          return Response.json(await directory.read(whole(q)), {
            headers: snapshot.headers,
          })
        },
      }),
    },
  })
  type Page = Awaited<ReturnType<typeof f.route>>
  let inside = (page: Page, phone: string) => {
    let at = storeAt(page.space!, page.app!)
    let door = doorOf((req) => store.fetch(req), at.name, {
      ...at.app,
      phone,
    })
    return async (path: string, init: RequestInit = {}) => {
      let answer = await door(path, init, {
        'x-yak-person': f.person,
        'x-yak-role': 'editor',
      })
      await answer.body?.cancel()
      return answer.status
    }
  }
  await f.route()
  f.publishElsewhere(2)
  let fresh = await f.fresh()
  let query = '/query?q=.entity.eid=missing'
  equal(await inside(fresh, '+11234567890')(query), 200)
  let remembered = await f.route()
  equal([remembered.remembered, remembered.app?.policy], [30_000, 1])
  let cached = inside(remembered, '+10987654321')
  equal(await cached(query), 200)
  let learned = () =>
    ['policy', 'phone', 'release'].map((word) => slot(ctx, word))
  equal([...learned(), rechecks], [
    '2',
    '+11234567890',
    '2',
    0,
  ])

  store.ceiling.count({
    shape: () => 'write count',
    rowsRead: 0,
    rowsWritten: 200_000,
    returned: 0,
  })
  equal(
    await cached('/apply', {
      method: 'POST',
      body: JSON.stringify([{
        entity: { eid: mint() },
        doc: { title: 'Queued under the old grant' },
      }]),
    }),
    202,
  )
  let writes = (state: string) =>
    store.ceiling.free(() => tally(db(ctx), 'yak_writes', by({ state })))
  equal(writes('pending'), 1)
  f.revokeElsewhere()
  await f.advance(60_000)
  await ctx.storage.deleteAlarm()
  await store.alarm()
  equal([writes('pending'), writes('refused')], [0, 1])
  equal([...learned(), rechecks], [
    '3',
    '+11234567890',
    '2',
    1,
  ])
})
