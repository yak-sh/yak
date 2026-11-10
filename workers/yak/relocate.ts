// An object's move to a new address. Cloudflare keeps a Durable Object where it
// was first reached and never moves it (T-134094), so moving a store nearer is
// a new object holding the old one's file. Any store moves this way: the
// directory, whose new object its constant names (door.ts `PLATFORM_OBJECT`),
// and an app's, whose new object the directory's `app.store` then names
// (sweep.ts `relocating`). It takes two steps.
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
//
// `copy` is the other use of the same steps, for any store: every table read
// at one instant and sent to a new object, which takes the name it is given and
// stands on its own. Nothing holds and nothing is handed over, so the source
// serves throughout and keeps every request; only the read is all at once,
// which is what makes it one instant without a hold. The copy arms no alarm and
// owes nothing its source owed (graph.ts `#forgiven`): it comes up when it is
// first asked, and its wakes resume then.
//
// Both ends run every statement through `freely`: counted against the
// object's ceiling, so what a move costs is told as it runs, and never
// refused (@yaks/durable-object `bounded`). A move is an admin's, as long as
// its store, and its steps are asynchronous, so `free` around each one would
// miss what runs between; stopped half way, the copy left behind is neither
// object, and the far end of a large store writes past its window by design.
// What a move ran stops neither end afterwards: the old object goes on
// serving through `prepare`, and the new one takes writes as soon as it is
// named.
import {
  arrived,
  type Cell,
  type Chunk,
  chunks,
  type Copied,
  copied,
  type driver,
  type DurableStorage,
  ending,
  freely,
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

export let LEAVE = '/relocate'
export let ARRIVE = '/relocate/arrive'
export let WHERE = '/relocate/where'
export let COPY = '/relocate/copy'
let TRIES = 2
let ROUNDS = 3

/** The object storage a move needs beyond its SQL. */
export type Relocating = DurableStorage & {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  deleteAll(): Promise<void>
  setAlarm(at: number): Promise<void>
}

type Leaving = { to: string; tries: number; store: string }
type Page = { table: Plan['tables'][number]; rows: Cell[][] }
type Told =
  | { op: 'begin'; plan: Plan }
  | { op: 'rows'; pages: Page[] }
  | { op: 'end'; plan: Plan }
  | { op: 'stale'; plan: Plan; chunks: Chunk[] }
  | { op: 'replace'; plan: Plan; chunk: Chunk; rows: Cell[][] }
  | { op: 'seal'; as?: string; from?: string }

let SOON = 1000
let SEND = 1024 * 1024

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

// The far end of a copy: its own name, and the word that it holds a copy of
// `from`, as the store keeps its words (graph.ts `KV`).
let named = (sql: ReturnType<typeof driver>, name: string, from: string) =>
  sql.query({
    t: 'insert',
    into: 'yak_kv',
    cols: ['k', 'v'],
    rows: [[val('name'), val(name)], [val('copied'), val(from)]],
    upsert: [{ on: [col('k')], set: { v: col('v', 'excluded') } }],
  })

// What the far end says to each step. `written` is how many rows it wrote for
// the step as the runtime counts (and bills) them, indexes included.
type Arrived = { written: number; tallies?: Record<string, Copied> }
let arrive = async (storage: Relocating, told: Told): Promise<Response> => {
  let written = 0
  let measure = (_: unknown, w?: number) => written += w ?? 0
  let sql = freely(storage, undefined, measure)
  let refused = (error: string) => Response.json({ error }, { status: 409 })
  if (told.op == 'begin') {
    if (serving(sql) && !await storage.get('arriving')) {
      return refused('this object serves already')
    }
    await storage.deleteAll()
    await storage.put('arriving', true)
    copied(freely(storage, undefined, measure), told.plan)
    return Response.json({ written })
  }
  if (!await storage.get('arriving')) return refused('nothing is arriving here')
  switch (told.op) {
    case 'rows':
      for (let p of told.pages) arrived(sql, p.table, p.rows)
      return Response.json({ written })
    case 'end':
      return Response.json({ tallies: ending(sql, told.plan), written })
    case 'stale':
      return Response.json(stale(sql, told.plan, told.chunks))
    case 'replace':
      overwritten(sql, told.plan, told.chunk, told.rows)
      return Response.json({ written })
    case 'seal':
      if (told.as) named(sql, told.as, told.from ?? '')
      await storage.put('arriving', false)
      if (!told.as) await storage.setAlarm(Date.now() + SOON)
      return Response.json({ written })
  }
}

// Where this object stands: its own egress names the colo it runs in.
let standing = async () => {
  let trace = await (await fetch('https://workers.cloudflare.com/cf.json'))
    .json() as { colo?: string; city?: string }
  return Response.json({ object: trace.colo, city: trace.city })
}

// Every table as it stands now, each read whole before anything is sent, so
// no write can land between two of its pages: one instant, without a hold.
// Pages travel together up to SEND bytes, since most tables of a small store
// hold a row or two and each send is a round trip.
let snapshot = (sql: ReturnType<typeof driver>) => {
  let made = plan(sql)
  let sends: Page[][] = [[]]
  let size = 0
  let tallies: Record<string, Copied> = {}
  for (let t of made.tables) {
    let held = raised(), after = 0
    while (true) {
      let next = page(sql, t, after, held)
      held = next.held
      if (next.last == null) break
      let bytes = JSON.stringify(next.rows).length
      if (size && size + bytes > SEND) {
        sends.push([])
        size = 0
      }
      sends.at(-1)!.push({ table: t, rows: next.rows })
      size += bytes
      after = next.last
    }
    tallies[t.name] = held
  }
  return { plan: made, sends: sends.filter((s) => s.length), tallies }
}

/** Each request an object is sent, answered by the move when it is the move's,
 * or handed to where the object now stands. Null is an object serving as ever. */
export let relocation = (o: {
  storage: () => Relocating
  object: (name: string) => { fetch(req: Request): Promise<Response> }
  leave: () => Promise<void>
  resume: () => void
  report: (e: unknown, store: string) => void
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
      await send(to, { op: 'rows', pages: [{ table: t, rows: next.rows }] })
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

  // Every table at one instant, and the copy made of it under the name `to`.
  // The far end's tallies must be the source's, row for row.
  let copy = async (from: string, to: string): Promise<Response> => {
    let start = Date.now()
    let { plan: made, sends, tallies } = snapshot(freely(o.storage()))
    let written = 0
    let told = async (said: Told) => {
      let answer: Arrived = await (await send(to, said)).json()
      written += answer.written
      return answer
    }
    await told({ op: 'begin', plan: made })
    for (let pages of sends) await told({ op: 'rows', pages })
    let far = (await told({ op: 'end', plan: made })).tallies ?? {}
    let differ = made.tables.map((t) => t.name).filter((t) =>
      far[t]?.rows != tallies[t].rows || far[t]?.digest != tallies[t].digest
    )
    if (differ.length) throw new Error(`the copy differs in ${differ}`)
    await told({ op: 'seal', as: to, from })
    let report = {
      from,
      to,
      tables: made.tables.length,
      rows: Object.values(tallies).reduce((n, t) => n + t.rows, 0),
      written,
      sends: sends.length + 3,
      took: Date.now() - start,
    }
    console.log('yak store copied', JSON.stringify(report))
    return Response.json(report)
  }

  // Every table across while this object serves.
  let prepare = async (to: string): Promise<Response> => {
    let start = Date.now()
    let sql = freely(o.storage())
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
    let sql = freely(storage)
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
        o.report(e, leaving.store)
        await storage.put('relocating', false)
        await storage.put('dormant', false)
        await storage.setAlarm(Date.now() + SOON)
        o.resume()
        return Response.json({ error: String(e) }, { status: 500 })
      } finally {
        copying = null
      }
    })()

  let look = (store: string) =>
    looked ??= (async () => {
      let storage = o.storage()
      moved = await storage.get<string | false>?.('relocated') || null
      if (moved) return
      let leaving = await storage.get<Leaving | false>?.('relocating')
      if (!leaving) return
      if (leaving.tries < TRIES) void begin(leaving)
      else {
        o.report(
          new Error(`relocating to ${leaving.to} gave up`),
          store,
        )
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
    let store = request.headers.get('x-store') ?? ''
    if (kernel && path == COPY && request.method == 'POST') {
      let to = new URL(request.url).searchParams.get('to')
      if (!to) return Response.json({ error: 'to' }, { status: 400 })
      return await copy(store, to).catch((e) => {
        o.report(e, store)
        return Response.json({ error: String(e) }, { status: 500 })
      })
    }
    await look(store)
    if (kernel && path == LEAVE && request.method == 'POST') {
      let asked = new URL(request.url).searchParams
      let preparing = asked.get('prepare')
      if (preparing) {
        return await prepare(preparing).catch((e) => {
          o.report(e, store)
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
      // Once every caller names the new object, the rows left here are a
      // second copy of what people wrote, which an erasure would never reach:
      // only the mark that hands requests on stays.
      if (asked.get('forget') && moved) {
        let storage = o.storage()
        await storage.deleteAll()
        await storage.put('relocated', moved)
        await storage.put('dormant', true)
        return Response.json({ to: moved, forgot: true })
      }
      if (moved) return Response.json({ to: moved })
      let to = asked.get('to')
      if (!to) return Response.json({ error: 'to' }, { status: 400 })
      if (!copying) {
        let leaving = { to, tries: 0, store }
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
    return to
      ? retried(() => o.object(to).fetch(request.clone() as Request), true)
      : null
  }
}
