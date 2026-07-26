// Inbound rides the pull: the fleet-mail sweep. The edge (Cloudflare
// inbox-worker) can't reach this box — the tailnet perimeter means WE
// pull. Two streams, one sweep: parsed email from GET /messages mints
// `mail` entities; raw captured requests from GET /requests are pulled
// apart here into `hook` entities (derived, not raw — a chatty source
// must not flood the graph with eager rows; provenance keeps the
// pointer back). Minted ids are stamped back (notified / processed) so
// the edge's spool drains — `read` is the OWNER's fact, never stamped
// here. Everything lands as DATA: unverified mail arrives verbatim with
// its verdict on the row; nothing executes on content. SERVER-ONLY
// (imports db).
import { apply, db } from './db.ts'
import { dispatch, trace } from './effects.ts'
import { rfcId } from './mail.ts'
import { canon } from './mailer.ts'
import { type Change, uuid } from './types.ts'

type Cast = (changes: Change[]) => void
type Row = Record<string, string | number | null>

// One inbound message, as the fleet-mail API says it — the KV-era
// archive dialect (rowToJson in holdco services/inbox-worker): from/to/
// text rather than the column names, verified a BOOLEAN, received_at
// already ISO.
export type FleetMsg = {
  id: string
  ts?: number | null
  received_at?: string | null
  dir?: string | null
  from?: string | null
  from_header?: string | null
  to?: string | null
  subject?: string | null
  text?: string | null
  verified?: boolean | null
  in_reply_to?: string | null
}

// One raw captured request from the edge's spool (the requests-spool
// branch): no edge opinion — method/path/headers/body/sig verdict,
// captured as received. headers is a JSON object, stringified.
export type SpoolReq = {
  id: string
  ts?: number | null
  source?: string | null
  method?: string | null
  path?: string | null
  headers?: string | null
  body?: string | null
  sig_ok?: number | null
}

// The API surface the sweep needs — injectable, so tests hand in
// fixtures and never touch the network. requests() answers null when
// the spool doesn't exist yet (the endpoint 404s until the owner
// deploys it): absent = "nothing to pull", never an error.
export type FleetApi = {
  messages: () => Promise<FleetMsg[]>
  notified: (ids: string[]) => Promise<void>
  requests: () => Promise<SpoolReq[] | null>
  processed: (ids: string[]) => Promise<void>
}

// The theft guard: the store's notified stamp is first-writer-wins, so
// a probe server on a scratch db (DB_PATH set) that inherits live creds
// STEALS delivery — messages mint into a throwaway db and the live
// server never sees them (it happened; T-3839). Probes will always
// inherit env, so the sweep is the part that refuses: default-deny on
// any non-default db, FLEET_MAIL_SWEEP=1 the deliberate opt-in. The
// live service sets neither. Pure over env, so the gate itself tests.
export let mayStamp = (env = (k: string) => Deno.env.get(k)): boolean =>
  !env('DB_PATH') || env('FLEET_MAIL_SWEEP') == '1'

// Env → client, or null = dormant (no url/token configured, or a
// non-live db refusing to stamp — the sweep never errors over absence;
// server.ts says which once at boot).
export let fleetApi = (): FleetApi | null => {
  let url = Deno.env.get('FLEET_MAIL_API_URL')?.replace(/\/+$/, '')
  let token = Deno.env.get('FLEET_MAIL_API_TOKEN')
  if (!url || !token || !mayStamp()) return null
  let call = async (method: string, path: string, body?: unknown) => {
    let res = await fetch(`${url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (res.status == 404) {
      await res.body?.cancel()
      return null
    }
    if (!res.ok) {
      throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
    }
    return await res.json()
  }
  // The Worker binds one SQL variable per id, and D1's SQLite caps a
  // statement at 100 — a full sweep's stamp-back must arrive in bites.
  let stamp = async (path: string, ids: string[]) => {
    for (let i = 0; i < ids.length; i += 50) {
      await call('POST', path, { ids: ids.slice(i, i + 50) })
    }
  }
  return {
    // The KV-era aliases are the stable contract: unnotified=1 narrows
    // to rows never swept, .dir=in keeps outbound archive rows out.
    // Rows arrive ascending ts, 100/page — the next sweep gets the rest.
    messages: async () =>
      (await call('GET', '/messages?unnotified=1&.dir=in&limit=100')) ?? [],
    notified: (ids) => stamp('/messages/notified', ids),
    requests: (): Promise<SpoolReq[] | null> =>
      call('GET', '/requests?unprocessed=1&limit=100'),
    processed: (ids) => stamp('/requests/processed', ids),
  }
}

// The attachments proxy's lookup: a client names the MAIL ENTITY (E-9,
// a bare num, an eid); the worker's R2 store speaks message_id. The two
// misses stay distinct so the route can teach — null = no mail at all,
// a null message_id = a row that never came through the spool (outbound
// and relay mail carry no attachments).
export let mailIdOf = (ref: string): { message_id: string | null } | null => {
  let m = ref.match(/^[A-Za-z]+-(\d+)$/) ?? ref.match(/^(\d+)$/)
  let row = m
    ? db.prepare(
      `select m.message_id from mail m
       join entity e on e.eid = m.eid where e.num = ?`,
    ).get(+m[1])
    : db.prepare('select message_id from mail where eid = ?').get(ref)
  return (row ?? null) as { message_id: string | null } | null
}

// One raw GET against the fleet-mail API — the Bearer token attaches
// HERE and travels no further (M-4524: clients talk to this server,
// never the worker). Null = dormant, same absence the sweep honors.
export let fleetRaw = (path: string): Promise<Response> | null => {
  let url = Deno.env.get('FLEET_MAIL_API_URL')?.replace(/\/+$/, '')
  let token = Deno.env.get('FLEET_MAIL_API_TOKEN')
  if (!url || !token) return null
  return fetch(`${url}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

// The address book, reversed: which entity wears this address? Unmatched
// inbound aims at the holdco project (P-20) — the operator's triage
// pile — resolved by name each sweep, so a db without it (tests, a
// fresh install) just leaves the mail unrouted.
export let routeTo = (addr: string | null | undefined): string | null => {
  let hit = addr
    ? (db.prepare('select eid from email where address = ? collate nocase')
      .get(String(addr)) as { eid: string } | undefined)
    : undefined
  if (hit) return hit.eid
  let fallback = db.prepare(
    'select e.eid from entity e join project p on p.eid = e.eid where e.num = 20',
  ).get() as { eid: string } | undefined
  return fallback?.eid ?? null
}

// A hook's first route segment names the venture's fleet inbox. The
// address canonicalizer makes cafe_car and CafeCar meet cafecar while
// the reversed address book remains the one venture registry.
export let hookTo = (path: string | null | undefined): string | null => {
  let venture = /^\/hook\/([^/?#]+)/.exec(path ?? '')?.[1]
  return routeTo(venture ? canon(`${venture}@bot.yak.sh`) : null)
}

// The From: HEADER names the author; the envelope from is SMTP plumbing
// (Cloudflare Email Sending stamps bounces@cf-bounce.… on every internal
// mail). The entity's from must be the author, or every reply aims at
// the bounce sink. Header shapes: `"name" <addr>` or a bare address.
export let author = (m: FleetMsg) => {
  let h = String(m.from_header ?? '').trim()
  let angled = /<([^<>\s]+@[^<>\s]+)>/.exec(h)
  return angled?.[1] ?? (/^\S+@\S+$/.test(h) ? h : m.from ?? null)
}

// When a message arrived: the store's ISO copy, else its epoch ts.
let arrivedAt = (m: FleetMsg) =>
  m.received_at ?? new Date(m.ts ?? Date.now()).toISOString()

// An inbound RFC reference names the mail it answers, not its graph eid.
// Match either the sender id on our outbound row or the unwrapped store id
// on an earlier inbound row; absence keeps the header without inventing an
// edge.
let replyOf = (mid: string | null | undefined): string | null => {
  if (!mid) return null
  let ref = rfcId(mid)
  let suffix = `%:${ref.replace(/[\\%_]/g, '\\$&')}`
  let row = db.prepare(
    `select eid from mail
     where sent_id = ? or message_id = ?
        or message_id like ? escape '\\'
     limit 1`,
  ).get(ref, ref, suffix) as { eid: string } | undefined
  return row?.eid ?? null
}

// One fleet message → the two halves of a mail entity: the wire batch
// (doc + mail, what apply() may write) and the stamp (inbound
// provenance, server-owned — message_id doubles as the never-send mark,
// so it lands BEFORE any effect can mistake arrival for an ask).
export let mailChanges = (m: FleetMsg, target: string | null) => {
  let eid = uuid()
  let reply = replyOf(m.in_reply_to)
  let wire: Change[] = [
    {
      eid,
      name: 'doc',
      comp: { title: m.subject || '(no subject)', body: m.text ?? '' },
    },
    {
      eid,
      name: 'mail',
      comp: {
        to: m.to ?? '',
        from: author(m),
        ...(target ? { target_eid: target } : {}),
        ...(reply ? { reply_to_eid: reply } : {}),
      },
    },
  ]
  let stamp: Row = {
    message_id: m.id,
    received_at: arrivedAt(m),
    verified: m.verified ? 1 : 0,
    in_reply_to: m.in_reply_to ?? null,
  }
  return { eid, wire, stamp }
}

// A captured request's headers, case-insensitively.
let hdr = (r: SpoolReq, name: string): string | null => {
  try {
    let h = JSON.parse(String(r.headers ?? '{}')) as Record<string, string>
    let k = Object.keys(h).find((k) => k.toLowerCase() == name)
    return k ? h[k] : null
  } catch {
    return null
  }
}

// The event word a request carries, best first: the sender's own header
// (github says x-github-event), a JSON body's event/type/action, else
// the route itself. A source nobody wrote a parser for still lands
// whole — adding a webhook source never touches the edge OR this sweep.
let eventOf = (r: SpoolReq): string => {
  let named = hdr(r, 'x-github-event') ?? hdr(r, 'x-event-key')
  if (named) return named
  try {
    let b = JSON.parse(String(r.body ?? '')) as Record<string, unknown>
    for (let k of ['event', 'type', 'action']) {
      if (typeof b[k] == 'string' && b[k]) return b[k] as string
    }
  } catch { /* not JSON — the route names it */ }
  return `${r.method ?? 'POST'} ${r.path ?? '/'}`.trim()
}

// One spool request → a hook entity: doc + hook tag on the wire, the
// whole derivation stamped ((source, spool_id) is the idempotency key,
// payload verbatim), and an `about` edge aiming it at the venture
// named by the request path (or the triage project when it names none).
export let hookChanges = (r: SpoolReq, target: string | null) => {
  let eid = uuid()
  let source = r.source || 'unknown'
  let event = eventOf(r)
  let wire: Change[] = [
    { eid, name: 'doc', comp: { title: `${source}: ${event}`, body: '' } },
    { eid, name: 'hook', comp: {} },
    ...(target
      ? [
        {
          eid,
          name: 'dependency',
          comp: { type: 'about', child_eid: target },
        } satisfies Change,
      ]
      : []),
  ]
  let stamp: Row = {
    source,
    event,
    payload: r.body ?? null,
    spool_id: r.id,
    received_at: new Date(r.ts ?? Date.now()).toISOString(),
  }
  return { eid, wire, stamp }
}

// The one writer for inbound stamps — server-owned columns never cross
// apply(), so the stamp broadcasts its own full row (the mail.ts
// idiom) or client caches hold a mail that never says where it came from.
let stamp = (table: string, eid: string, patch: Row, cast: Cast) => {
  let cols = Object.keys(patch)
  db.prepare(
    `update ${table} set ${cols.map((c) => `"${c}" = ?`).join(', ')}
     where eid = ?`,
  ).run(...cols.map((c) => patch[c]), eid)
  let row = db.prepare(`select * from ${table} where eid = ?`).get(eid)
  if (row) cast([{ eid, name: table, comp: row as Record<string, unknown> }])
}

// Mint one derived entity: apply the wire half, stamp provenance BEFORE
// dispatch (mailed() must find the inbound mark, not a deliverable), then
// let effects see the batch like any other door's.
let mint = (
  { eid, wire, stamp: s }: { eid: string; wire: Change[]; stamp: Row },
  table: string,
  cast: Cast,
) => {
  let t = trace()
  let out = apply(db, wire, t)
  cast(out)
  stamp(table, eid, s, cast)
  dispatch(out, t, (c, e) => console.warn(`inbound effect ${c} —`, e))
}

// An echo coming home: our own letter re-entering through the store —
// the RFC id in the store key is the sent_id a graph mail already
// wears. That letter EXISTS; minting again forks it into twins (one
// letter, one entity), and skipping silently loses the arrival — which
// is exactly what makes it UNREAD for the recipient (message_id set,
// read_at empty; T-5882). So the one entity gains its inbound half:
// arrival provenance, plus routing/author only where the send left them
// empty — a relay mail keeps aiming at its task, a stamped from stays.
// True = this message is an echo, handled; already-stamped means a
// duplicate delivery, recorded once and never twice.
let arrive = (m: FleetMsg, cast: Cast): boolean => {
  let r = db.prepare(
    `select eid, message_id, target_eid, reply_to_eid, "from" author
     from mail where sent_id = ?`,
  ).get(rfcId(m.id)) as
    | {
      eid: string
      message_id: string | null
      target_eid: string | null
      reply_to_eid: string | null
      author: string | null
    }
    | undefined
  if (!r) return false
  if (!r.message_id) {
    stamp('mail', r.eid, {
      message_id: m.id,
      received_at: arrivedAt(m),
      verified: m.verified ? 1 : 0,
      in_reply_to: m.in_reply_to ?? null,
      ...(r.target_eid ? {} : { target_eid: routeTo(m.to) }),
      ...(r.reply_to_eid ? {} : { reply_to_eid: replyOf(m.in_reply_to) }),
      ...(r.author ? {} : { from: author(m) }),
    }, cast)
  }
  return true
}

// The sweep: pull unnotified messages and unprocessed requests, mint
// what's new (idempotent on the provenance keys), stamp the spool back
// so it drains. Ids already minted still stamp back — that heals the
// crash gap between a mint and its notified. Each stream fails alone:
// a mail hiccup must not silence hooks, and vice versa.
let sweep = async (cast: Cast, api: FleetApi) => {
  try {
    let done: string[] = []
    for (let m of await api.messages()) {
      if (m.dir && m.dir != 'in') continue // only arrival mints
      if (!db.prepare('select 1 from mail where message_id = ?').get(m.id)) {
        if (!arrive(m, cast)) mint(mailChanges(m, routeTo(m.to)), 'mail', cast)
      }
      done.push(m.id)
    }
    if (done.length) await api.notified(done)
  } catch (e) {
    console.warn('inbound sweep (mail) —', e)
  }
  try {
    let reqs = await api.requests() // null: no spool yet — nothing to pull
    if (reqs) {
      let done: string[] = []
      for (let r of reqs) {
        if (
          !db.prepare('select 1 from hook where source = ? and spool_id = ?')
            .get(r.source || 'unknown', r.id)
        ) {
          mint(hookChanges(r, hookTo(r.path)), 'hook', cast)
        }
        done.push(r.id)
      }
      if (done.length) await api.processed(done)
    }
  } catch (e) {
    console.warn('inbound sweep (hooks) —', e)
  }
}

// The interval-safe door: dormant without config, and never two sweeps
// in flight (a slow pull must not stack on its own tail).
let sweeping = false
export let inboundSweep = async (cast: Cast, api = fleetApi()) => {
  if (!api || sweeping) return
  sweeping = true
  try {
    await sweep(cast, api)
  } finally {
    sweeping = false
  }
}
