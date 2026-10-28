// App lifecycle at the kernel seam, billed only to yak/platform by workerd's
// SQL cursor counters. Other Stores and R2 belong to this isolated probe.
import { type State, Store, type Time } from './graph.ts'
import { directory, fetch as directoryFetch } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import { PLATFORM_STORE, storeOf } from './door.ts'
import { type Args, call } from './tools.ts'
import type { Env } from './env.ts'
import { driver } from '@yaks/durable-object'
import { by, col, val } from '@yaks/sql'
import { meter, objectState } from './release_cost_fixture.ts'
import { directoryStanding } from './directory_standing_fixture.ts'

export let directoryLifecycleCost = async (
  storage: State['storage'],
  bindings: Pick<Env, 'STORE' | 'BLOBS'>,
  history: number,
) => {
  let { context, settled } = objectState(storage)
  let store: Store
  let env = {
    ...bindings,
    STORE: {
      idFromName: (name: string) => name,
      get: (name: unknown) =>
        name == PLATFORM_STORE
          ? { fetch: (req: Request) => store.fetch(req) }
          : bindings.STORE.get(bindings.STORE.idFromName(String(name))),
    },
    WIRE: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: () => Promise.resolve(Response.json({})) }),
    },
    BUILDER: {
      idFromName: (name: string) => name,
      get: () => {
        throw new Error('lifecycle probe needs no builder')
      },
    },
    ASSETS: {
      fetch: () => {
        throw new Error('lifecycle probe needs no assets')
      },
    },
    OAUTH_KV: {},
    STORE_TRACING: 'off',
  } satisfies Env
  store = new Store(context, env)
  let meta = metaOf(storeOf(env.STORE, PLATFORM_STORE))
  let dir = directory({ fetch: (req) => directoryFetch(req, env) }, true)
  // Seed the platform through its write door before adding unrelated history.
  await dir.apply({ entities: [] })
  let person = (await dir.personAt('admin@bot.yak.sh'))!
  let slug = `lifecycle-cost-${crypto.randomUUID().slice(0, 8)}`
  let spaceId = crypto.randomUUID()
  await meta.apply([{
    entity: { eid: spaceId },
    space: { slug, store: slug },
    doc: { title: 'Directory lifecycle cost probe' },
  }, {
    entity: { eid: crypto.randomUUID() },
    member: { space: spaceId, person, role: 'owner' },
  }], KERNEL)
  let space = (await dir.space(slug))!
  let documents = Math.min(history, 2000)
  for (let start = 0; start < documents; start += 100) {
    await meta.apply(
      Array.from(
        { length: Math.min(100, documents - start) },
        (_, i) => ({
          entity: { eid: crypto.randomUUID() },
          doc: {
            title: `Retained directory document ${start + i}`,
            body: 'kept',
          },
        }),
      ),
      KERNEL,
    )
  }
  await store.alarm()
  await settled()
  await storage.deleteAlarm?.()
  // An idle directory retains receipts until its next keyed write. Include
  // expired successful traffic, as well as unrelated graph rows.
  let sql = driver(storage)
  for (let i = 0; i < history; i++) {
    let [receipt] = sql.query({
      t: 'insert',
      into: 'yak_writes',
      cols: ['at', 'headers', 'body', 'state', 'idempotency_key', 'answer'],
      rows: [[
        val('2020-01-01T00:00:00.000Z'),
        val('{}'),
        val(''),
        val('applied'),
        val(`old-${i}`),
        val(i % 4 ? '[]' : null),
      ]],
      returning: [col('seq')],
    })
    if (i % 4 == 0) {
      sql.query({
        t: 'insert',
        into: 'yak_write_answers',
        cols: ['seq', 'part', 'body'],
        rows: [[val(Number(receipt.seq)), val(0), val('[]')]],
      })
    }
  }
  // The steps run on a Store whose clock stands eleven minutes on, past
  // every setup receipt's resend window.
  let at = Date.now() + 11 * 60_000, later: Time = { now: () => at }
  store = new Store(context, env, undefined, later)
  let m = meter(storage)
  // A step is billed for what it owed the directory's pool too.
  let run = async (name: string, args: Args) => {
    m.step(name)
    let out = await call({ env, dir, person }, name.split(' ')[0], {
      space: slug,
      ...args,
    })
    await settled()
    return out
  }
  try {
    // admin push on a missing app: failed list, create, upload, release.
    try {
      await run('app_files list', { app: 'probe', op: 'list' })
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('no app probe')) throw e
    }
    await run('app_new', { slug: 'probe', title: 'Probe' })
    m.step(null)
    await directoryStanding(
      bindings.STORE,
      space,
      (await dir.app(space, 'probe'))!,
      person,
    )
    await run('app_files', {
      app: 'probe',
      files: [{
        path: 'index.html',
        content: '<!doctype html><title>Probe</title>',
      }],
    })
    await run('app_deploy', { app: 'probe' })
    await run('app_delete', { app: 'probe', forever: true })
    m.step(null)
    // A code deploy with unchanged vocabulary invalidates the shape stamp.
    driver(storage).query({
      t: 'update',
      table: 'yak_kv',
      set: { v: val('previous deploy') },
      where: by({ k: 'schema' }),
    })
    m.step('deploy wake')
    store = new Store(context, env, undefined, later)
    await meta.query(`.entity.eid=${space.eid}`)
    m.step('wake alarm')
    await store.alarm()
    await settled()
    m.step(null)
    return { history, steps: m.steps, top: m.top(20) }
  } finally {
    m.stop()
  }
}
