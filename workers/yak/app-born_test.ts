// What app_new leaves for later (T-143070): it waits on no purge of the edge,
// since an app answers nothing before its first release, and that release
// purges its space; and its store is made behind the answer, so the first
// write or deploy finds it standing.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { col, select, table, tally } from '@yaks/sql'
import { epochAt } from '@yaks/sqlite'
import { connector, fresh, recording, signIn } from './probe.ts'
import { Store } from './graph.ts'
import { db, state } from './testing.ts'

test('a new app purges nothing, stands its store up, and its first release purges its space', async () => {
  let { purged, PURGER } = recording()
  let reached: string[] = []
  let k = await fresh({}, (env) => {
    env.PURGER = PURGER
    let stores = env.STORE
    env.STORE = {
      ...stores,
      get: (id, options) => {
        let store = stores.get(id, options)
        return {
          ...store,
          fetch: (req: Request) => {
            reached.push(req.headers.get('x-store') ?? '')
            return store.fetch(req)
          },
        } as typeof store
      },
    }
  })
  try {
    let agent = connector(k, (await signIn(k)).cookie)
    await k.settled()
    purged.length = 0
    reached.length = 0
    let made = await agent.tool('app_new', { slug: 'garden', title: 'Garden' })
    await k.settled()
    let space = (await k.dir.space(/^app ([^/]+)\//.exec(made)![1]))!
    assertEquals(purged, [])
    assertEquals(reached.some((name) => name.includes('/garden.')), true)

    let deploy = async () => {
      purged.length = 0
      await agent.tool('app_files', {
        app: 'garden',
        op: 'write',
        path: 'index.html',
        content: `<h1>${crypto.randomUUID()}</h1>`,
      })
      await agent.tool('app_deploy', { app: 'garden' })
      await k.settled()
      return purged.filter((tag) => !tag.startsWith('app:')).sort()
    }
    assertEquals(await deploy(), [`space:${space.eid}`])
    assertEquals(await deploy(), [])
  } finally {
    await k.stop()
  }
})

// A new store's schema is a copy of what the last new store of its kind was
// made with (T-143307): hundreds of objects, laid down in a few statements,
// the same objects and rows as one made a statement each, its lineage its own.
test('a new app store lays its schema down in fewer statements than it has objects', async () => {
  let born = async () => {
    let ctx = state('', false)
    let res = await new Store(ctx as never).fetch(
      new Request('http://store/vocab', {
        headers: { 'x-store': 'ada/garden' },
      }),
    )
    await res.body?.cancel()
    let d = db(ctx)
    let objects = d.query(select({
      cols: [col('type'), col('name'), col('sql')],
      from: table('sqlite_schema'),
      order: [col('name')],
    }))
    return {
      stmts: Number(res.headers.get('x-yak-stmts')),
      objects,
      rows: objects.filter((o) =>
        o.type == 'table' && /^create table/i.test(String(o.sql))
      )
        .map((o) => [o.name, tally(d, String(o.name))]),
      meta: d.query(
        select({
          cols: [col('k')],
          from: table('server_meta'),
          order: [col('k')],
        }),
      ),
      epoch: epochAt(d),
    }
  }
  let first = await born(), second = await born()
  assert(second.stmts < second.objects.length, `${second.stmts} statements`)
  assertEquals(second.objects, first.objects)
  assertEquals(second.rows, first.rows)
  assertEquals(second.meta, first.meta)
  assertNotEquals(second.epoch, first.epoch)
})
