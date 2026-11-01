// An object's move to a new address. Cloudflare keeps a Durable Object where it
// was first reached and never moves it (T-134094), so moving the directory
// nearer is a new object holding the old one's file. It takes two steps.
//
// `prepare` copies every table across while this object goes on serving, as long
// as that takes, and builds the far end's indexes. Nothing ever boots there.
//
// `to` is the short part. This object goes dormant, which ends its alarm and
// sockets, and restarts, which ends what it had in flight. The next incarnation
// boots nothing: it compares the two files a chunk at a time and sends what
// moved since the copy, while every request that reaches it waits. Once both
// ends are alike it leaves the mark `relocated` and from then on hands every
// request to the new object, a write's idempotency key still on it, so no
// caller on any deploy can reach the rows left behind. A step that fails puts
// the object back to serving, and the far end stays unaddressed.
//
// A wake that finds a hold under way (an instance died in it) starts it again,
// at most TRIES times, so a hold that kills its instance can't keep the platform
// down.
import {
  arrived,
  type Cell,
  type Chunk,
  chunks,
  copied,
  driver,
  type DurableStorage,
  ending,
  overwritten,
  page,
  type Plan,
  plan,
  raised,
  reread,
  retried,
  stale,
} from '@yaks/durable-object'
import { col, eq, select, table, val } from '@yaks/sql'
import { PLATFORM_STORE } from './door.ts'

export let LEAVE = '/relocate'
export let ARRIVE = '/relocate/arrive'
export let WHERE = '/relocate/where'
let TRIES = 2
let ROUNDS = 3

/** The object storage a move needs beyond its SQL. */
export type Relocating = DurableStorage & {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  deleteAll(): Promise<void>
  setAlarm(at: number): Promise<void>
}

type Leaving = { to: string; tries: number }
type Told =
  | { op: 'begin'; plan: Plan }
  | { op: 'rows'; table: Plan['tables'][number]; rows: Cell[][] }
  | { op: 'end'; plan: Plan }
  | { op: 'stale'; plan: Plan; chunks: Chunk[] }
  | { op: 'replace'; plan: Plan; chunk: Chunk; rows: Cell[][] }
  | { op: 'seal' }

let SOON = 1000

// Whether this object already answers to its own name: a store that has served
// holds that word, and copying over one would lose everything it has.
let serving = (sql: ReturnType<typeof driver>) => {
  try {
    return sql.query(select({
      cols: [col('v')],
      from: table('yak_kv'),
      where: eq(col('k'), val('name')),
    })).length > 0
  } catch {
    return false
  }
}

let arrive = async (storage: Relocating, told: Told): Promise<Response> => {
  let sql = driver(storage)
  if (told.op == 'begin') {
    if (serving(sql) && !await storage.get('arriving')) {
      return Response.json({ error: 'this object serves already' }, {
        status: 409,
      })
    }
    await storage.deleteAll()
    await storage.put('arriving', true)
    copied(driver(storage), told.plan)
    return Response.json({ ok: true })
  }
  if (!await storage.get('arriving')) {
    return Response.json({ error: 'nothing is arriving here' }, { status: 409 })
  }
  switch (told.op) {
    case 'rows':
      arrived(sql, told.table, told.rows)
      return Response.json({ ok: true })
    case 'end':
      return Response.json(ending(sql, told.plan))
    case 'stale':
      return Response.json(stale(sql, told.plan, told.chunks))
    case 'replace':
      overwritten(sql, told.plan, told.chunk, told.rows)
      return Response.json({ ok: true })
    case 'seal':
      await storage.put('arriving', false)
      await storage.setAlarm(Date.now() + SOON)
      return Response.json({ ok: true })
  }
}

// Where this object stands: its own egress names the colo it runs in.
let standing = async () => {
  let trace = await (await fetch('https://workers.cloudflare.com/cf.json'))
    .json() as { colo?: string; city?: string }
  return Response.json({ object: trace.colo, city: trace.city })
}

/** Each request an object is sent, answered by the move when it is the move's,
 * or handed to where the object now stands. Null is an object serving as ever. */
export let relocation = (o: {
  storage: () => Relocating
  object: (name: string) => { fetch(req: Request): Promise<Response> }
  leave: () => Promise<void>
  resume: () => void
  report: (e: unknown) => void
}) => {
  let moved: string | null = null
  let looked: Promise<void> | null = null
  let copying: Promise<Response> | null = null

  let sent = async (
    sql: ReturnType<typeof driver>,
    to: string,
    t: Plan['tables'][number],
  ) => {
    let held = raised(), after = 0
    while (true) {
      let next = page(sql, t, after, held)
      held = next.held
      if (next.last == null) return held
      await send(to, { op: 'rows', table: t, rows: next.rows })
      after = next.last
    }
  }

  let send = async (to: string, told: Told) => {
    let r = await o.object(to).fetch(
      new Request(`http://store${ARRIVE}`, {
        method: 'POST',
        headers: { 'x-yak-kernel': '1' },
        body: JSON.stringify(told),
      }),
    )
    if (!r.ok) throw new Error(`${told.op}: ${r.status} ${await r.text()}`)
    return r
  }

  // Every table across while this object serves.
  let prepare = async (to: string): Promise<Response> => {
    let start = Date.now()
    let sql = driver(o.storage())
    let made = plan(sql)
    await send(to, { op: 'begin', plan: made })
    let rows = 0
    for (let t of made.tables) rows += (await sent(sql, to, t)).rows
    await send(to, { op: 'end', plan: made })
    return Response.json({
      to,
      tables: made.tables.length,
      rows,
      took: Date.now() - start,
    })
  }

  // What moved since `prepare`, across until both ends are alike. A row sent
  // again can fire the far end's triggers, so each round looks again.
  let hold = async (to: string): Promise<Response> => {
    let start = Date.now()
    let storage = o.storage()
    let sql = driver(storage)
    let made = plan(sql)
    let source = chunks(sql, made)
    let resent = 0
    for (let round = 0; round < ROUNDS; round++) {
      let differ = await (await send(to, {
        op: 'stale',
        plan: made,
        chunks: source,
      })).json() as Chunk[]
      if (!differ.length) {
        await send(to, { op: 'seal' })
        await storage.put('relocated', to)
        await storage.put('relocating', false)
        moved = to
        return Response.json({
          to,
          tables: made.tables.length,
          rows: source.reduce((n, c) => n + c.held.rows, 0),
          resent,
          took: Date.now() - start,
        })
      }
      for (let chunk of differ) {
        await send(to, {
          op: 'replace',
          plan: made,
          chunk,
          rows: reread(sql, made, chunk),
        })
        resent++
      }
    }
    throw new Error(`the two ends still differ after ${ROUNDS} rounds`)
  }

  let begin = (leaving: Leaving) =>
    copying ??= (async () => {
      let storage = o.storage()
      try {
        await storage.put('relocating', {
          ...leaving,
          tries: leaving.tries + 1,
        })
        return await hold(leaving.to)
      } catch (e) {
        o.report(e)
        await storage.put('relocating', false)
        await storage.put('dormant', false)
        await storage.setAlarm(Date.now() + SOON)
        o.resume()
        return Response.json({ error: String(e) }, { status: 500 })
      } finally {
        copying = null
      }
    })()

  let look = () =>
    looked ??= (async () => {
      let storage = o.storage()
      moved = await storage.get<string | false>?.('relocated') || null
      if (moved) return
      let leaving = await storage.get<Leaving | false>?.('relocating')
      if (!leaving) return
      if (leaving.tries < TRIES) void begin(leaving)
      else {
        o.report(new Error(`relocating to ${leaving.to} gave up`))
        await storage.put('relocating', false)
        await storage.put('dormant', false)
        await storage.setAlarm(Date.now() + SOON)
        o.resume()
      }
    })()

  return async (request: Request): Promise<Response | null> => {
    let path = new URL(request.url).pathname
    let kernel = request.headers.get('x-yak-kernel') == '1'
    if (kernel && path == ARRIVE) {
      return arrive(o.storage(), await request.json())
    }
    if (kernel && path == WHERE) return standing()
    if (request.headers.get('x-store') != PLATFORM_STORE) return null
    await look()
    if (kernel && path == LEAVE && request.method == 'POST') {
      let asked = new URL(request.url).searchParams
      let preparing = asked.get('prepare')
      if (preparing) {
        return await prepare(preparing).catch((e) => {
          o.report(e)
          return Response.json({ error: String(e) }, { status: 500 })
        })
      }
      // The way back, for a new object that can't serve: this one takes the
      // requests again, and whatever the new one committed stays there.
      if (asked.get('back') && moved) {
        moved = null
        let storage = o.storage()
        await storage.put('relocated', false)
        await storage.put('dormant', false)
        await storage.setAlarm(Date.now() + SOON)
        o.resume()
        return Response.json({ back: true })
      }
      if (moved) return Response.json({ to: moved })
      let to = asked.get('to')
      if (!to) return Response.json({ error: 'to' }, { status: 400 })
      if (!copying) {
        let leaving = { to, tries: 0 }
        await o.storage().put('relocating', leaving)
        await o.leave()
        return (await begin(leaving)).clone()
      }
      return (await copying).clone()
    }
    if (copying) await copying
    // A restart at the new object is sent again here, where a caller would have
    // sent it, rather than reaching that caller as this object's failure.
    let to = moved
    return to ? retried(() => o.object(to).fetch(request.clone()), true) : null
  }
}
