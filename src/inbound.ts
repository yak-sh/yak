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
import { apply, readComp } from './db.ts'
import { link } from './edge.ts'
import { db } from './live_db.ts'
import { commitEffects } from './effects.ts'
import { named, rfcId } from './mail.ts'
import { canon, fleetAddress } from './mailaddr.ts'
import { record } from './telemetry.ts'
import { type Change, uuid } from './types.ts'
import { isRef } from './props.ts'

// The eid→id storage seam (D-18866): component tables key by the owner int id
// and store refs as int ids; this module speaks EIDs. OWNED matches a row by
// owner eid, refEid projects a stored ref id back to its eid on read, and a
// write binds a reference column through bindOf (its eid resolved to an id).
let OWNED = `entity = (select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`
let bindOf = (comp: string, col: string) =>
  isRef(comp, col) ? `(select id from entity where eid = ?)` : '?'

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
  // The letter's headers as the fleet edge captured them: a JSON object,
  // stringified (SpoolReq.headers's shape). Absent until the edge forwards
  // them — `routingHeaders` keeps only the fixed few we persist (T-14133).
  headers?: string | null
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

// The isolation predicate: am I the authoritative instance on the live
// graph, or a probe on a scratch copy? False the moment DB_PATH names a
// copy. It is the one gate every OUTWARD, to-disk-or-network effect asks
// before touching anything a probe must leave alone — persona files in
// live venture repos and the embed model (server.ts), and, with a
// mail-specific opt-in layered on top, fleet-mail delivery (mayStamp
// below). Pure over env, so the gate itself tests.
export let isLive = (env = (k: string) => Deno.env.get(k)): boolean =>
  !env('DB_PATH')

// The theft guard: the store's notified stamp is first-writer-wins, so
// a probe server on a scratch db (DB_PATH set) that inherits live creds
// STEALS delivery — messages mint into a throwaway db and the live
// server never sees them (it happened; T-3839). Probes will always
// inherit env, so the sweep is the part that refuses: default-deny on
// any non-default db, FLEET_MAIL_SWEEP=1 the deliberate opt-in. The
// live service sets neither. Layered on isLive so mail arms only where
// it is both live AND opted in — the opt-in never leaks to other effects.
export let mayStamp = (env = (k: string) => Deno.env.get(k)): boolean =>
  isLive(env) || env('FLEET_MAIL_SWEEP') == '1'

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
       join entity e on e.id = m.entity where e.num = ?`,
    ).get(+m[1])
    : db.prepare(`select message_id from mail where ${OWNED}`).get(ref)
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

// The address book, reversed and STRICT: which entity wears this address,
// or nobody. Attribution uses this door and only this one — a sender the
// book doesn't know is a stranger, and a stranger must resolve to no one
// rather than to whatever the routing fallback would have picked (T-9934).
export let wearer = (addr: string | null | undefined): string | null =>
  (addr
    ? db.prepare(
      `select o.eid as eid from email join entity o on o.id = email.entity
       where address = ? collate nocase`,
    )
      .get(String(addr)) as { eid: string } | undefined
    : undefined)?.eid ?? null

// The same book as ROUTING: unmatched inbound aims at the holdco project
// (P-20) — the operator's triage pile — resolved by name each sweep, so a
// db without it (tests, a fresh install) just leaves the mail unrouted.
// An id-shaped local-part resolves the same way it does on the way OUT
// (`named`, src/mail.ts), or a letter to S-31@ would deliver in-graph and
// land in triage when it arrived from outside — one address, two answers.
export let routeTo = (addr: string | null | undefined): string | null => {
  let hit = wearer(addr) ?? (addr ? named(String(addr)) : null)
  if (hit) return hit
  let fallback = db.prepare(
    'select e.eid from entity e join project p on p.entity = e.id where e.num = 20',
  ).get() as { eid: string } | undefined
  return fallback?.eid ?? null
}

// A hook's first route segment names the venture's fleet inbox. The
// address canonicalizer makes cafe_car and CafeCar meet cafecar while
// the reversed address book remains the one venture registry.
export let hookTo = (path: string | null | undefined): string | null => {
  let venture = /^\/hook\/([^/?#]+)/.exec(path ?? '')?.[1]
  let address = venture ? canon(fleetAddress(venture)) : null
  let project = address
    ? db.prepare(
      `select o.eid as eid from email
       join project on project.entity = email.entity
       join entity o on o.id = email.entity
       where email.address = ? collate nocase`,
    ).get(address) as { eid: string } | undefined
    : undefined
  return project?.eid ?? routeTo(null)
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

// The ONLY inbound headers we persist (T-14133): non-content routing headers,
// canonical-cased. RFC 8058 one-click unsubscribe (Gmail/Yahoo bulk-sender
// requirements) plus the envelope trio — no body, no addressing beyond
// Reply-To, so this stays the narrow retention T-11903 settled on, never raw
// MIME. Add a name here and it persists; nothing else changes.
let keptHeaders = [
  'List-Unsubscribe',
  'List-Unsubscribe-Post',
  'Reply-To',
  'Return-Path',
  'Auto-Submitted',
]

// Pick the kept headers out of the edge's captured set (a stringified JSON
// object), case-insensitively, and return them under their canonical names as
// a JSON string — or null when the letter carried none (or the edge forwarded
// no headers at all). The graph reads this to prove which headers survived the
// last hop; it invents nothing, so a header absent upstream stays absent.
export let routingHeaders = (raw: string | null | undefined): string | null => {
  if (!raw) return null
  let all: Record<string, string>
  try {
    all = JSON.parse(raw) as Record<string, string>
  } catch {
    return null
  }
  let lower = new Map(
    Object.keys(all).map((k) => [k.toLowerCase(), k]),
  )
  let kept: Record<string, string> = {}
  for (let name of keptHeaders) {
    let k = lower.get(name.toLowerCase())
    if (k != null && all[k] != null) kept[name] = all[k]
  }
  return Object.keys(kept).length ? JSON.stringify(kept) : null
}

// An inbound RFC reference names the mail it answers, not its graph eid.
// Match either the sender id on our outbound row or the unwrapped store id
// on an earlier inbound row; absence keeps the header without inventing an
// edge.
let replyOf = (mid: string | null | undefined): string | null => {
  if (!mid) return null
  let ref = rfcId(mid)
  let suffix = `%:${ref.replace(/[\\%_]/g, '\\$&')}`
  let row = db.prepare(
    `select o.eid as eid from mail join entity o on o.id = mail.entity
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
        ...(target ? { target: target } : {}),
        ...(reply ? { reply_to: reply } : {}),
      },
    },
  ]
  // An INBOUND mail is a record of arrival, never an outbound ask — so it
  // wears no `deliver {to}`; its recipient is `to_addr`, the address it was
  // delivered to, alongside the rest of the arrival provenance. `from` rides
  // the STAMP too: an outbound mail's sender is derived from its author
  // (db.ts), and this is the one case where the sender is a fact about the
  // far side instead — the same server-only door as message_id and verified.
  let stamp: Row = {
    from: author(m),
    to_addr: m.to ?? null,
    message_id: m.id,
    received_at: arrivedAt(m),
    verified: m.verified ? 1 : 0,
    in_reply_to: m.in_reply_to ?? null,
    headers: routingHeaders(m.headers),
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
    ...(target ? link(eid, 'about', target) : []),
  ]
  let stamp: Row = {
    source,
    event,
    payload: r.body ?? null,
    spool_id: r.id,
    received_at: new Date(r.ts ?? Date.now()).toISOString(),
    method: r.method ?? null,
    path: r.path ?? null,
    headers: r.headers ?? null,
    sig_ok: r.sig_ok ?? null,
  }
  return { eid, wire, stamp }
}

// The one writer for inbound stamps — server-owned columns never cross
// apply(), so the stamp broadcasts its own full row (the mail.ts
// idiom) or client caches hold a mail that never says where it came from.
let stamp = (table: string, eid: string, patch: Row, cast: Cast) => {
  let cols = Object.keys(patch)
  // A reference column (mail.target/reply_to) binds an eid this correlated
  // lookup resolves to the stored int id; the owner-key WHERE does the same for
  // the row itself. The read-back rides readComp so the cast carries eids.
  db.prepare(
    `update ${table} set ${
      cols.map((c) => `"${c}" = ${bindOf(table, c)}`).join(', ')
    }
     where ${OWNED}`,
  ).run(...cols.map((c) => patch[c]), eid)
  let row = readComp(db, eid, table)
  if (row) cast([{ eid, name: table, comp: row as Record<string, unknown> }])
}

// Mint one derived entity: apply the wire half, stamp provenance BEFORE
// dispatch (mailed() must find the inbound mark, not a deliverable), then
// let effects see the batch like any other door's.
//
// `by` is the AUTHOR — the sender the address book knows, not the sweep.
// Passing nothing used to leave the write unattributed, which the old
// writerActor fallback then read as the box owner: every stranger's letter
// entered the journal signed by him (T-9934).
let mint = (
  { eid, wire, stamp: s }: { eid: string; wire: Change[]; stamp: Row },
  table: string,
  cast: Cast,
  by?: string | null,
) => {
  commitEffects((t) => apply(db, wire, t, by), cast)
  stamp(table, eid, s, cast)
}

// An echo coming home: our own letter re-entering through the store —
// the RFC id in the store key is the sent_id a graph mail already
// wears. That letter EXISTS; minting again forks it into twins (one
// letter, one entity), and skipping silently loses the arrival — which
// is exactly what makes it UNREAD for the recipient (message_id set, no
// `opened` stamp; T-5882). So the one entity gains its inbound half:
// arrival provenance, plus routing/author only where the send left them
// empty — a relay mail keeps aiming at its task, a stamped from stays.
// True = this message is an echo, handled; already-stamped means a
// duplicate delivery, recorded once and never twice.
let arrive = (m: FleetMsg, cast: Cast): boolean => {
  let r = db.prepare(
    `select o.eid as eid, m.message_id, ${refEid('m.target')} as target,
            ${refEid('m.reply_to')} as reply_to, m."from" author
     from mail m join entity o on o.id = m.entity where m.sent_id = ?`,
  ).get(rfcId(m.id)) as
    | {
      eid: string
      message_id: string | null
      target: string | null
      reply_to: string | null
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
      ...(r.target ? {} : { target: routeTo(m.to) }),
      ...(r.reply_to ? {} : { reply_to: replyOf(m.in_reply_to) }),
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
//
// A failure surfaces DURABLY, not just on stderr: a dead token, a moved
// worker or a network refusal is an EMPTY spool as far as `console.warn`
// on a socket nobody collects is concerned, so a broken sweep looked
// exactly like a quiet one and hid for hours (T-15110). A `srv` telemetry
// row — queryable at /telemetry and `task telemetry --errors` — is the
// difference between "nothing arrived" and "the sweep can't pull". record()
// is best-effort by contract, so watching the sweep can never break it.
let broke = (stream: string, e: unknown) => {
  console.warn(`inbound sweep (${stream}) —`, e)
  record(db, {
    source: 'srv',
    name: `inbound sweep (${stream})`,
    ok: false,
    error: String(e),
  })
}

let sweep = async (cast: Cast, api: FleetApi) => {
  try {
    let done: string[] = []
    for (let m of await api.messages()) {
      if (m.dir && m.dir != 'in') continue // only arrival mints
      if (!db.prepare('select 1 from mail where message_id = ?').get(m.id)) {
        if (!arrive(m, cast)) {
          mint(mailChanges(m, routeTo(m.to)), 'mail', cast, wearer(author(m)))
        }
      }
      done.push(m.id)
    }
    if (done.length) await api.notified(done)
  } catch (e) {
    broke('mail', e)
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
    broke('hooks', e)
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
