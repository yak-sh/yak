// An object's move to a new address. Cloudflare keeps a Durable Object where it
// was first reached and never moves it (T-134094), so moving the directory
// nearer is a new object holding the old one's file.
//
// The object leaving stops first: it goes dormant, which ends its alarm and
// sockets, and restarts, which ends what it had in flight. The next incarnation
// copies its file across before it boots anything, while every request that
// reaches it waits. A copy that arrives, table by table the same at both ends,
// leaves the mark `relocated`, and from then on this object hands every request
// to the new one, a write's idempotency key still on it, so no caller on any
// deploy can reach the rows left behind. A copy that fails puts the object back
// to serving, and the far end stays unaddressed until the next try wipes it.
//
// A wake that finds a copy under way (an instance died in it) starts it again,
// at most TRIES times, so a copy that kills its instance can't hold the
// platform down.
import {
  arrived,
  type Cell,
  type Copied,
  copied,
  driver,
  type DurableStorage,
  ending,
  page,
  type Plan,
  plan,
  raised,
} from '@yaks/durable-object'
import { col, eq, select, table, val } from '@yaks/sql'
import { PLATFORM_STORE } from './door.ts'

export let LEAVE = '/relocate'
export let ARRIVE = '/relocate/arrive'
export let WHERE = '/relocate/where'
let TRIES = 2

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
  if (told.op == 'begin') {
    let sql = driver(storage)
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
  let sql = driver(storage)
  if (told.op == 'rows') {
    arrived(sql, told.table, told.rows)
    return Response.json({ ok: true })
  }
  let tallies = ending(sql, told.plan)
  await storage.put('arriving', false)
  await storage.setAlarm(Date.now() + SOON)
  return Response.json(tallies)
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

  let copy = async (to: string): Promise<Response> => {
    let storage = o.storage()
    let sql = driver(storage)
    let made = plan(sql)
    await send(to, { op: 'begin', plan: made })
    let here: Record<string, Copied> = {}
    for (let t of made.tables) {
      let held = raised(), after = 0
      while (true) {
        let next = page(sql, t, after, held)
        held = next.held
        if (next.last == null) break
        await send(to, { op: 'rows', table: t, rows: next.rows })
        after = next.last
      }
      here[t.name] = held
    }
    let there = await (await send(to, { op: 'end', plan: made })).json()
    let unlike = made.tables.filter((t) =>
      JSON.stringify(here[t.name]) != JSON.stringify(there[t.name])
    ).map((t) => t.name)
    if (unlike.length) throw new Error(`unlike at both ends: ${unlike}`)
    await storage.put('relocated', to)
    await storage.put('relocating', false)
    moved = to
    return Response.json({
      to,
      tables: made.tables.length,
      rows: Object.values(here).reduce((n, c) => n + c.rows, 0),
      here,
    })
  }

  let begin = (leaving: Leaving) =>
    copying ??= (async () => {
      let storage = o.storage()
      try {
        await storage.put('relocating', {
          ...leaving,
          tries: leaving.tries + 1,
        })
        return await copy(leaving.to)
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
      moved = await storage.get<string>?.('relocated') ?? null
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
      if (moved) return Response.json({ to: moved })
      let to = new URL(request.url).searchParams.get('to')
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
    return moved ? o.object(moved).fetch(request) : null
  }
}
