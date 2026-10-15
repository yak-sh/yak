// Explicit administrative migration is allowed while ordinary app work sleeps.
import { equal, test, until } from '@yaks/testing'
import { type Bundle, token } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import {
  directory,
  fetch as directoryFetch,
  stamp,
  storeName,
} from './directory.ts'
import { trash } from './erase.ts'
import { Store } from './graph.ts'
import { storeOf } from './door.ts'
import { KERNEL } from './meta.ts'
import { platform, slot } from './testing.ts'
import { sign } from './lib/token.ts'
import * as sweep from './sweep.ts'
import type { Rule } from './mover.ts'

let fixture = async () => {
  await using p = platform('dormant mover secret')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) }, true)
  let space = await dir.own('dormant-mover-owner', 'asleep')
  await dir.apply({
    entities: [{ entity: { eid: 'mover-admin' }, person: {} }, {
      entity: { eid: '$app' },
      app: {
        slug: 'held',
        space: space.eid,
        store: 'asleep/held.123456',
        access: 'public',
      },
    }],
  })
  await stamp(p.env, {
    entities: [{
      entity: { eid: '$seat' },
      member: {
        space: (await dir.space('yak'))!.eid,
        person: 'mover-admin',
        role: 'owner',
      },
    }],
  })
  let app = (await dir.app(space, 'held'))!
  let name = storeName(space, app)
  let ask = storeOf(p.env.STORE, name, { eid: app.eid, access: 'public' })
  let rows = Array.from({ length: 300 }, (_, i) => ({
    entity: { eid: crypto.randomUUID() },
    doc: { title: 'Legacy' },
    ...i == 0 ? { wake: { at: '2020-01-01T00:00:00.000Z' } } : {},
  }))
  for (let i = 0; i < rows.length; i += 100) {
    let written = await ask('/apply', {
      method: 'POST',
      body: JSON.stringify(rows.slice(i, i + 100)),
    }, KERNEL)
    if (!written.ok) {
      throw new Error(`source write: ${written.status} ${await written.text()}`)
    }
    await written.body?.cancel()
  }
  let ctx = p.states.get(name)!
  await until(() => slot(ctx, 'weighed') != null, {
    label: 'source size receipt',
  })
  await trash(p.env, dir, space, app, {
    person: 'dormant-mover-owner',
    role: 'owner',
  })
  await until(async () => await ctx.storage.get<boolean>('dormant') == true, {
    label: 'source asleep',
  })
  let sent: Bundle[] = [], fired: number[] = [], results: number[] = []
  let call = crypto.randomUUID()
  let rule: Rule = {
    mark: 'yak/store/dormant-probe/1',
    live: 'apps',
    find: '.doc.title=Legacy&*',
    move: (row, read) => {
      fired.push(read?.('.fired')?.length ?? -1)
      results.push(read?.(`.result.call=${call}`)?.length ?? -1)
      return [
        {
          entity: row.entity,
          doc: { title: 'Moved' },
          $was: { doc: { title: token('Legacy') } },
        },
        ...row.wake
          ? [{
            entity: { eid: call },
            call: { to: toolEid('mail_show'), args: {} },
          }]
          : [],
      ]
    },
    forward: (row) => [row],
  }
  p.env.ERRORS = {
    send: (rows) => {
      sent.push(...rows)
      return Promise.resolve()
    },
  }
  let current = new Store(ctx, p.env, [rule])
  let get = p.env.STORE.get.bind(p.env.STORE)
  p.env.STORE.get = (id) =>
    String(id) == name ? { fetch: (r) => current.fetch(r) } : get(id)
  let cookie = `yak_session=${await sign({
    person: 'mover-admin',
    space: null,
    exp: Date.now() + 60_000,
  }, 'dormant mover secret')}`
  let other = `yak_session=${await sign({
    person: 'dormant-mover-owner',
    space: null,
    exp: Date.now() + 60_000,
  }, 'dormant mover secret')}`
  let move = async (rehearse: boolean, authorized = true) => {
    let response = await sweep.fetch(
      new Request(
        `https://yaks.app/api/move?store=${name}${
          rehearse ? '&rehearse=1' : ''
        }`,
        {
          method: 'POST',
          headers: { cookie: authorized ? cookie : other },
        },
      ),
      p.env,
    )
    return { status: response.status, body: await response.json() }
  }
  let unauthorized = await move(true, false)
  let reads = 0
  let sourceExec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (sql, ...args) => {
    reads++
    return sourceExec(sql, ...args)
  }
  let ordinary = await ask('/vocab', undefined, KERNEL)
  let ordinarySQL = reads
  let proof = await move(true)
  let before = {
    sent: sent.length,
    alarm: await ctx.storage.getAlarm(),
    dormant: await ctx.storage.get<boolean>('dormant'),
  }
  let started = await move(false)
  await current.alarm()
  let partial = {
    sent: sent.length,
    alarm: await ctx.storage.getAlarm(),
    dormant: await ctx.storage.get<boolean>('dormant'),
  }
  current = new Store(ctx, p.env, [rule])
  reads = 0
  let coldRead = await ask('/vocab', undefined, KERNEL)
  let activeSQL = reads
  await current.alarm()
  let done = await move(false)
  let final = {
    sent: sent.length,
    alarm: await ctx.storage.getAlarm(),
    dormant: await ctx.storage.get<boolean>('dormant'),
  }
  let after = await ask('/vocab', undefined, KERNEL)
  let appAfter = await dir.app(space, 'held')
  let warmed = current
  let statements = 0
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (sql, ...args) => {
    statements++
    return exec(sql, ...args)
  }
  current = new Store(ctx, p.env, [rule])
  await current.alarm()
  let sleeping = await ask('/vocab', undefined, KERNEL)
  let sleepingSQL = statements
  current = warmed
  let revived = await ask('/revive', { method: 'POST' }, KERNEL)
  await current.alarm()
  let query = async (q: string) => {
    let response = await ask(
      `/query?q=${encodeURIComponent(q)}`,
      undefined,
      KERNEL,
    )
    return await response.json() as Bundle[]
  }
  await until(async () => (await query(`.result.call=${call}`)).length == 1, {
    label: 'restored ordinary tool effect',
  })
  let firstFiring = await query('.fired')
  await current.alarm()
  let secondFiring = await query('.fired')
  let dormantResults = [...new Set(results)], dormantFired = [...new Set(fired)]
  // A restore already in flight can complete while the mover sheds its permit.
  await (await ask('/apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: rows[1].entity,
      doc: { title: 'Legacy' },
    }]),
  }, KERNEL)).body?.cancel()
  current = new Store(ctx, p.env, [{
    ...rule,
    mark: 'yak/store/dormant-race/1',
  }])
  await (await ask('/dormant', { method: 'POST' }, KERNEL)).body?.cancel()
  await move(false)
  let put = ctx.storage.put.bind(ctx.storage), restoredDuringCleanup = false
  ctx.storage.put = async (key, value) => {
    await put(key, value)
    if (key == 'moving' && value === false && !restoredDuringCleanup) {
      restoredDuringCleanup = true
      await (await ask('/revive', { method: 'POST' }, KERNEL)).body?.cancel()
    }
  }
  try {
    await current.alarm()
  } finally {
    ctx.storage.put = put
  }
  let restoreAlarm = await ctx.storage.getAlarm()
  return {
    restoredDuringCleanup,
    restoreAlarm,

    revived: revived.status,
    firstFiring,
    secondFiring,
    results: dormantResults,
    resultCount: (await query(`.result.call=${call}`)).length,
    unauthorized,
    ordinary: ordinary.status,
    ordinarySQL,
    activeSQL,
    proof,
    before,
    started,
    partial,
    coldRead: coldRead.status,
    done,
    final,
    after: after.status,
    trashed: !!appAfter?.trashed,
    fired: dormantFired,
    statements: sleepingSQL,
    sleeping: sleeping.status,
  }
}

let observed = await fixture()
test('admin move migrates a trashed store while its app and ordinary work stay asleep', () => {
  equal(observed.unauthorized.status >= 400, true)
  equal(observed.ordinary, 404)
  equal(observed.ordinarySQL, 0)
  equal(observed.proof.status, 200)
  equal(observed.proof.body.rules[0].failed, undefined)
  equal(observed.proof.body.rules[0].moved, 300)
  equal(observed.before, { sent: 0, alarm: null, dormant: true })
  equal(observed.started.status, 200)
  equal(observed.partial.sent, 250)
  equal(observed.partial.alarm != null, true)
  equal(observed.partial.dormant, true)
  equal(observed.coldRead, 404)
  equal(observed.activeSQL, 0)
  equal(observed.done.body.rules[0].moved, 300)
  equal(observed.done.body.rules[0].forwarded, 300)
  equal(observed.done.body.rules[0].done != null, true)
  equal(observed.final, { sent: 300, alarm: null, dormant: true })
  equal(observed.after, 404)
  equal(observed.trashed, true)
  equal(observed.fired, [0])
  equal(observed.statements, 0)
  equal(observed.sleeping, 404)
  equal(observed.results, [0])
  equal(observed.revived, 200)
  equal(observed.firstFiring.length, 1)
  equal(observed.secondFiring, observed.firstFiring)
  equal(observed.resultCount, 1)
  equal(observed.restoredDuringCleanup, true)
  equal(observed.restoreAlarm != null, true)
})
