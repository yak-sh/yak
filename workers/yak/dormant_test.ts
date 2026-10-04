import { equal, test, until } from '@yaks/testing'
import { directory, fetch as directoryFetch, storeName } from './directory.ts'
import { trash, untrash } from './erase.ts'
import { Store } from './graph.ts'
import { storeOf } from './door.ts'
import { KERNEL } from './meta.ts'
import { openIn } from './unseen.ts'
import { platform, slot } from './testing.ts'
import type { Wire } from '@yaks/durable-object'

test('trash makes a store dormant across every wake and restore keeps its data', async () => {
  using p = platform('dormant probe')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) }, true)
  let space = await dir.own('dormant-owner', 'dormant')
  await dir.apply({
    entities: [{
      entity: { eid: '$app' },
      app: {
        slug: 'held',
        version: 1,
        space: space.eid,
        store: 'dormant/held.123456',
        access: 'public',
      },
      doc: { title: 'Held' },
    }],
  })
  let app = (await dir.app(space, 'held'))!
  let name = storeName(space, app)
  let ask = storeOf(p.env.STORE, name, {
    eid: app.eid,
    access: 'public',
  })
  let eid = crypto.randomUUID()
  let written = await ask('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid }, doc: { title: 'Keep me' } }]),
  }, KERNEL)
  equal(written.status, 200, await written.text())
  let ctx = p.states.get(name)!
  // The initial write's size receipt is unrelated to trash delivery. Let its
  // asynchronous acknowledgement finish before measuring trash's SQL.
  await until(() => slot(ctx, 'weighed') != null, {
    label: 'initial size receipt',
  })
  let closed = 0
  let ws = {
    send() {},
    close() {
      closed++
    },
    serializeAttachment() {},
    deserializeAttachment() {
      return null
    },
  } as unknown as Wire
  ctx.live.push(ws)
  await ctx.storage.setAlarm(Date.now() + 60000)
  let statements = 0
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (sql, ...args) => {
    statements++
    return exec(sql, ...args)
  }
  let who = { person: 'dormant-owner', role: 'owner' as const }
  await trash(p.env, dir, space, app, who)
  await until(async () => await ctx.storage.get<boolean>('dormant') == true, {
    label: 'trash delivered',
  })
  equal(statements, 0)
  equal(await ctx.storage.getAlarm(), null)
  equal(closed > 0, true)
  equal(
    await openIn(p.env, space, {
      ...app,
      trashed: { at: new Date().toISOString(), by: who.person },
    }, who),
    [],
  )
  equal(statements, 0)
  statements = 0
  let store = p.object(name)
  for (let incarnation of [store, new Store(ctx, p.env)]) {
    equal(
      (await incarnation.fetch(new Request('http://store/vocab'))).status,
      404,
    )
    await incarnation.alarm()
    await incarnation.webSocketMessage(ws, '{}')
    await incarnation.webSocketClose(ws)
    await incarnation.webSocketError(ws, new Error('gone'))
  }
  equal(statements, 0)
  await untrash(p.env, dir, space, app, who)
  await until(async () => await ctx.storage.get<boolean>('dormant') == false, {
    label: 'restore delivered',
  })
  let response = await ask(
    `/query?q=${encodeURIComponent(`.entity.eid=${eid}&.doc`)}`,
    undefined,
    KERNEL,
  )
  equal(response.status, 200)
  equal((await response.json())[0].doc.title, 'Keep me')
})

test('directory recovery delivers trash before the dormant store boots', async () => {
  using p = platform('missed trash probe')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) }, true)
  let space = await dir.own('missed-owner', 'missed')
  await dir.apply({
    entities: [{
      entity: { eid: '$app' },
      app: {
        slug: 'held',
        space: space.eid,
        store: 'missed/held.123456',
        access: 'public',
      },
      trashed: { at: new Date().toISOString() },
    }],
  })
  let name = 'missed/held.123456'
  p.object(name)
  let ctx = p.states.get(name)!
  await ctx.storage.setAlarm(Date.now() + 60000)
  let statements = 0
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (sql, ...args) => {
    statements++
    return exec(sql, ...args)
  }
  await until(async () => await ctx.storage.get<boolean>('dormant') == true, {
    label: 'trash reconciled',
  })
  let store = new Store(ctx, p.env)
  await store.alarm()
  equal(await ctx.storage.getAlarm(), null)
  equal(statements, 0)
  equal((await store.fetch(new Request('http://store/vocab'))).status, 404)
})

test('an app store wake makes zero directory calls and directory SQL statements', async () => {
  using p = platform('wake directory probe')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) }, true)
  let space = await dir.own('wake-owner', 'wake')
  await dir.apply({
    entities: [{
      entity: { eid: '$app' },
      app: {
        slug: 'held',
        space: space.eid,
        store: 'wake/held.123456',
        access: 'public',
      },
    }],
  })
  let app = (await dir.app(space, 'held'))!
  let name = storeName(space, app)
  let ask = storeOf(p.env.STORE, name, { eid: app.eid, access: 'public' })
  await (await ask('/vocab', undefined, KERNEL)).body?.cancel()
  let ctx = p.states.get(name)!
  let directoryCtx = p.states.get('yak/platform')!
  let calls = 0
  let statements = 0
  let get = p.env.STORE.get.bind(p.env.STORE)
  p.env.STORE.get = (id) => {
    let stub = get(id)
    return {
      fetch: (r: Request) => {
        if (String(id) == 'yak/platform') calls++
        return stub.fetch(r)
      },
    }
  }
  let exec = directoryCtx.storage.sql.exec.bind(directoryCtx.storage.sql)
  directoryCtx.storage.sql.exec = (sql, ...args) => {
    statements++
    return exec(sql, ...args)
  }
  // The alarm path includes both first-incarnation dormancy and the tick gate.
  let incarnation = new Store(ctx, p.env)
  await incarnation.tick()
  equal({ calls, statements }, { calls: 0, statements: 0 })
})
