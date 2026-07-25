// The pure heart of the tasks channel — split out of server.ts so the socket-
// free logic (who a broadcast batch is aimed at, how it renders) is unit-
// testable without a WebSocket or an MCP stdio pipe. server.ts wires these to
// the live stream; server_test.ts drives them with hand-built batches.
//
// A `Change` is the wire unit `{eid, name, comp}` — a component PATCH. The /ws
// endpoint rebroadcasts every applied batch to every client, so this channel is
// just another client that reads, never writes: it watches the stream for three
// things aimed at ITS session and turns each into one channel event.

import { type Change, idOf, kindOf } from '../../src/types.ts'
import { type Seat, served } from '../../src/served.ts'

// A rendered channel event: `{content, meta}` is the notification params shape
// server.js emits under method notifications/claude/channel. The MCP server's
// name ("tasks") becomes the source= attribute; meta carries the rest (kind,
// from). Attacker-controlled strings live in meta/content, never built into a
// forged attribute. `eid` is the entity this event notifies about — the plugin
// stamps `notified` on it (its own delivery record) and it is stripped before
// the wire, never reaching the client.
export type Event = {
  content: string
  meta: Record<string, string>
  eid: string
}

// What channelEvents needs to know about the world beyond one batch: which
// session entity it serves, that session's actor (a knock may be aimed at
// either), its home project (where its mail lands), the eids of the tasks it has
// CLAIMED (a comment on any of them is a message to the claimant — the sweep's
// `mine` in client.ts notices()), how to turn an eid into a human id (T-7, S-31)
// — null when the eid isn't known yet — and a letter's words from the cache (the
// arrival stamp is a bare mail row). `notified` is the durable dedup: an entity
// already told (this plugin's own inject stamp, or the sweep) never re-rings,
// even across a reconnect.
export type Ctx = {
  sessionEid: string
  actorEid?: string | null
  homeEid?: string | null
  claimedEids?: Set<string>
  idOf: (eid: string) => string | null
  docOf?: (eid: string) => { title: string; body: string } | null
  // The durable read-state (T-7006): true once a mail wears `opened` or
  // `archived`, read off the index — so a letter already dealt with never
  // re-rings across a reconnect (the old ephemeral read_at guard, made
  // restart-proof).
  done?: (eid: string) => boolean
  // The durable dedup (T-7010): true once an entity wears `notified`, read off
  // the index — so anything this plugin (or the sweep) already told the operator
  // is not re-injected, even across a reconnect. Replaces the old ephemeral
  // `seen`/`delivered` set; `inject-needed == NOT notified`.
  notified?: (eid: string) => boolean
  // What THIS run injected — the plugin's own delivery memory, the one gate
  // no mode lifts. `notified` is the fleet's stamp (the bus writes it too,
  // and our own write is lost if the server is down when we try); this is
  // ours, so a replay can never re-ring what we already said.
  sent?: (eid: string) => boolean
  // Which pass this is; absent = a live frame.
  // - `catchup`: the {since} journal replay on a freshly-(re)connected
  //   socket (T-7167). It pushes past `notified`, because the digest/bus may
  //   have stamped a gap item while the channel was down and that stamp
  //   dedups a live RE-broadcast, not the one push an idle operator never
  //   got. Bounded to the snapshot→join window, so no backlog flood.
  // - `resume`: the reconnect sweep over a whole snapshot (T-7302). The
  //   disconnect→snapshot gap is INSIDE the snapshot, so no {since} window
  //   can replay it — the channel reconciles against state instead, and
  //   `notified` is what bounds it to what nobody has told this session yet.
  //   It also lets a knock the ladder already stamped `cast S-me` through:
  //   see the knock branch.
  // Either way `done`/`injects`/`operator` still gate — correctness, not
  // dedup.
  mode?: 'catchup' | 'resume'
  // Whether the served session is the project's operator loop — a specialist
  // (false) gets no project mail, only direct address (client.ts isOperator,
  // T-7006). Absent = true (an unresolved session errs toward delivery).
  operator?: boolean
}

let str = (v: unknown) => (typeof v == 'string' ? v : '')

// Strip control bytes from graph-authored text before it reaches the session.
// Body keeps \n \t \r (legible markdown); a meta attribute collapses to one
// line and drops chars that could break out of the rendered <channel …> tag.
export let cleanBody = (s: string) =>
  // deno-lint-ignore no-control-regex
  str(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

export let cleanAttr = (s: string) =>
  str(s)
    .replace(/[\r\n\t]+/g, ' ')
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x1F\x7F"<>]/g, '')
    .trim()
    .slice(0, 400)

// The identity index: eid → its human number and the components it carries, fed
// from the boot snapshot and kept fresh by every broadcast (num rides in on
// first touch, a component patch adds/removes its name). humanId derives the id
// the same way the UI does — kindOf over the present components, then idOf.
// Mail-wearers also keep their doc: the arrival stamp is a bare mail row (a
// mint casts its doc a frame earlier; an echo's doc landed with the original
// send or the boot snapshot), so a letter's words must come from memory.
export type Row = {
  num: number
  comps: Set<string>
  doc?: { title: string; body: string }
  // A session row's own fields, MERGED across patches — identity is read
  // off the index, not off one batch, so a patch that carries only
  // `acked_at` can't blank the actor and a rotation can't strand a stale
  // one. `pid` is the seat (findSession, below); the rest route delivery.
  sess?: Sess
}
export type Sess = {
  id?: string
  pid?: number
  actorEid?: string
  personaEid?: string
  origin?: string
  requestedTaskEid?: string
}
export type Index = Map<string, Row>

// Merge one session patch into the row's remembered fields: a column the
// patch omits keeps its value, an explicit null clears it.
let remember = (row: Row, comp: Record<string, unknown>) => {
  let s = row.sess ?? (row.sess = {})
  if ('id' in comp) s.id = str(comp.id) || undefined
  if ('pid' in comp) s.pid = typeof comp.pid == 'number' ? comp.pid : undefined
  if ('actor_eid' in comp) s.actorEid = str(comp.actor_eid) || undefined
  if ('persona_eid' in comp) s.personaEid = str(comp.persona_eid) || undefined
  if ('origin' in comp) s.origin = str(comp.origin) || undefined
  if ('requested_task_eid' in comp) {
    s.requestedTaskEid = str(comp.requested_task_eid) || undefined
  }
}

export let learn = (index: Index, changes: Change[]) => {
  for (let c of changes) {
    // The spine: an entity-null tombstones the eid; otherwise stamp its num.
    if (c.name == 'entity') {
      if (c.comp == null) index.delete(c.eid)
      else {
        let row = index.get(c.eid) ?? { num: 0, comps: new Set<string>() }
        if (typeof c.comp.num == 'number') row.num = c.comp.num
        index.set(c.eid, row)
      }
      continue
    }
    // Edges carry no component identity — they never name a kind.
    if (c.name == 'dependency') continue
    let row = index.get(c.eid) ?? { num: 0, comps: new Set<string>() }
    if (c.comp == null) row.comps.delete(c.name)
    else row.comps.add(c.name)
    if (c.name == 'session') {
      if (c.comp == null) row.sess = undefined
      else remember(row, c.comp)
    }
    index.set(c.eid, row)
  }
  // Second pass, so a mint's doc is cached whichever side of its mail comp it
  // rides in the batch. A doc change is a PATCH — merge only what it carries.
  for (let c of changes) {
    if (c.name != 'doc' || !c.comp) continue
    let row = index.get(c.eid)
    if (!row?.comps.has('mail')) continue
    let doc = row.doc ?? { title: '', body: '' }
    if ('title' in c.comp) doc.title = str(c.comp.title)
    if ('body' in c.comp) doc.body = str(c.comp.body)
    row.doc = doc
  }
}

// eid → the cached doc of a mail-wearer, or null — the Ctx.docOf the live
// server wires in.
export let docOf = (index: Index, eid: string) => index.get(eid)?.doc ?? null

// eid → done (T-7006): it wears `opened` or `archived`. learn() keeps the
// comp set fresh from every broadcast, so this is restart-proof dedup —
// the Ctx.done the live server wires in.
export let doneOf = (index: Index, eid: string) => {
  let comps = index.get(eid)?.comps
  return !!comps && (comps.has('opened') || comps.has('archived'))
}

// eid → notified (T-7010): it already wears `notified` — told, whether by this
// plugin's own inject stamp or the bus/digest sweep. learn() keeps the comp set
// fresh from every broadcast, so this is restart-proof dedup — the Ctx.notified
// the live server wires in. Orthogonal to done: told, not dealt-with.
export let notifiedOf = (index: Index, eid: string) =>
  !!index.get(eid)?.comps.has('notified')

// eid → human id (T-7), or null when the spine's num hasn't been seen yet.
export let humanId = (index: Index, eid: string): string | null => {
  let row = index.get(eid)
  if (!row || !row.num) return null
  let has: Record<string, true> = {}
  for (let c of row.comps) has[c] = true
  return idOf({ kind: kindOf(has), num: row.num })
}

// The session THIS process serves, derived from the whole index — the
// shared seat rule (src/served.ts): the newest row wearing our pid, the
// same question the server-side door asks of the same graph, so the two
// cannot disagree about who hears a knock (T-7288).
//
// DERIVED, never ratcheted: the old rule moved forward only, to a higher
// num, which followed a /clear correctly but could never move BACK — so a
// row that stopped being a seat (a subagent's row that wrongly wore this
// pid, until its pid is cleared) kept the channel bound to a session
// nothing renders for. A subagent reifies with no pid at all now (cli.ts),
// and a correction to any row re-derives here on the next batch.
//
// `id` is the boot hint: an MCP subprocess's spawn-time
// CLAUDE_CODE_SESSION_ID names the conversation until a pid stamp lands,
// and is the only clue for a session whose pid never got stamped. A pid
// seat always outranks it.
export let findSession = (
  index: Index,
  by: { pid?: number; id?: string },
): ({ eid: string } & Sess) | undefined => {
  let seats: Seat[] = []
  let hinted: ({ eid: string } & Sess) | undefined
  for (let [eid, row] of index) {
    if (!row.sess) continue
    seats.push({ eid, num: row.num, pid: row.sess.pid })
    if (by.id && row.sess.id == by.id) hinted = { eid, ...row.sess }
  }
  let seat = served(seats, by.pid)
  return seat ? { eid: seat.eid, ...index.get(seat.eid)?.sess } : hinted
}

// The injection policy (owner, 2026-07-22): ALL verified unread mail aimed at
// this session's home project injects; unverified never does — it stays in the
// store/graph for deliberate triage. `done` is the durable read-state — the
// `opened`/`archived` stamps (T-7006) read off the index — replacing the old
// mail.read_at column so a letter already opened or archived never re-rings.
// Narrowing later is one line here.
// `operator` gates PROJECT mail to the operator loop: a specialist (a managed
// spawn, or a session started on a task) hears only direct address, never the
// project's mail (client.ts isOperator, T-7006). Default true — an unresolved
// session errs toward delivery, and comments/knocks reach it regardless.
export let injects = (
  m: Record<string, unknown>,
  homeEid?: string | null,
  done?: boolean,
  operator = true,
): boolean =>
  operator && !!m.verified && !done && !!homeEid &&
  str(m.target_eid) == homeEid

// A knock the ladder stamped as OURS: `delivery: cast S-31` names the very
// session this channel serves (knock.ts writes `cast S-${num}` when the door
// answered). Paired with the `notified` gate it is the whole test for "the
// stamp says delivered and nobody delivered it".
let lost = (c: Change, ctx: Ctx) => {
  let me = ctx.idOf(ctx.sessionEid)
  return !!me && str(c.comp?.delivery) == `cast ${me}`
}

// The two edges of the doc a component's body rides on, indexed by eid within
// the batch — a comment's words and a knock's note both land as a `doc` change
// beside their own component (mint-time). Bodiless means the doc isn't here.
let docsIn = (changes: Change[]) => {
  let docs = new Map<string, { title: string; body: string }>()
  for (let c of changes) {
    if (c.name == 'doc' && c.comp) {
      docs.set(c.eid, { title: str(c.comp.title), body: str(c.comp.body) })
    }
  }
  return docs
}

let words = (doc?: { title: string; body: string }) =>
  doc ? cleanBody(doc.body || doc.title) : ''

// The filter + format, pure. Given one broadcast batch and the session context,
// return the channel events to emit — in batch order, so delivery is
// deterministic. Three things are aimed at a session:
//
//   1. a `comment` whose target_eid is this session's eid OR one of its CLAIMED
//      tasks (commenting on a task you hold IS messaging you — the comms bus
//      rule) — but ONLY at mint, when the batch also carries the doc that holds
//      the words (a bodiless later patch is skipped). A comment on a claimed
//      task names that task in `on=` so the operator knows which one.
//   2. a `knock` (types.ts): to_eid is the recipient — this session or its
//      actor — and target_eid is what to look at; the words ride as a plain
//      comment on the TARGET in the same batch (the :knock contract).
//   3. a `mail` arrival for the session's home project — see the branch.
export let channelEvents = (changes: Change[], ctx: Ctx): Event[] => {
  let docs = docsIn(changes)
  let out: Event[] = []
  // Already told: our own deliveries always, the fleet's `notified` stamp
  // except on a catch-up replay (see Ctx.mode).
  let told = (eid: string) =>
    !!ctx.sent?.(eid) || (ctx.mode != 'catchup' && !!ctx.notified?.(eid))
  for (let c of changes) {
    if (!c.comp) continue

    if (c.name == 'comment') {
      let at = str(c.comp.target_eid)
      let mine = at == ctx.sessionEid || !!ctx.claimedEids?.has(at)
      if (!mine) continue
      let content = words(docs.get(c.eid))
      if (!content) continue // bodiless mint or a later comp-only patch
      if (told(c.eid)) continue
      let from = ctx.idOf(str(c.comp.author_eid)) ?? 'unknown'
      let meta: Record<string, string> = {
        kind: 'comment',
        from: cleanAttr(from),
      }
      // On a claimed TASK (not the session), name the target so the operator
      // knows which one — the sweep line prefixes the same id.
      if (at != ctx.sessionEid) meta.on = cleanAttr(ctx.idOf(at) ?? at)
      out.push({ content, meta, eid: c.eid })
      continue
    }

    if (c.name == 'knock') {
      // The resolver's stamp re-broadcasts the full row with acted_at
      // set (a server-only column, absent at mint) — that's the receipt
      // of a knock already delivered, not a second nudge. On a RESUME
      // sweep it is the opposite: `delivery: cast S-me` is the ladder
      // CLAIMING this channel took it, and an un-`notified` row proves the
      // claim false — that knock is exactly what a disconnect ate
      // (T-7302), so ring it and make the stamp true.
      if (c.comp.acted_at != null && !(ctx.mode == 'resume' && lost(c, ctx))) {
        continue
      }
      let recipient = str(c.comp.to_eid)
      if (recipient != ctx.sessionEid && recipient != ctx.actorEid) continue
      if (told(c.eid)) continue
      let at = str(c.comp.target_eid)
      let atId = at ? ctx.idOf(at) ?? at : null
      let note = commentOn(changes, docs, at)
      let head = atId ? `knock: look at ${atId}` : 'knock'
      let content = note ? `${head} — ${note}` : head
      out.push({ content, meta: { kind: 'knock' }, eid: c.eid })
      continue
    }

    if (c.name == 'mail') {
      // The sweep's stamp broadcast is the arrival: received_at is a
      // server-only column, so only the full-row stamp carries it (knock's
      // acted_at trick, inverted — here the stamp IS the news). The mint's
      // wire frames never wear it, and `notified` keeps any later full-row
      // re-broadcast — or a reconnect — from ringing twice.
      if (c.comp.received_at == null) continue
      if (
        !injects(c.comp, ctx.homeEid, ctx.done?.(c.eid), ctx.operator !== false)
      ) continue
      if (told(c.eid)) continue
      let id = ctx.idOf(c.eid)
      let doc = docs.get(c.eid) ?? ctx.docOf?.(c.eid)
      let from = cleanAttr(str(c.comp.from)) || 'unknown'
      let subj = cleanAttr(doc?.title ?? '')
      let ref = id ?? c.eid
      let content = cleanBody(doc?.body ?? '') ||
        `mail ${ref} from ${from}${subj && `: ${subj}`} — task mail show ${ref}`
      let meta: Record<string, string> = {
        kind: 'mail',
        from,
        auth: c.comp.verified ? 'VERIFIED' : 'UNVERIFIED',
      }
      if (subj) meta.subj = subj
      if (id) meta.id = id
      out.push({ content, meta, eid: c.eid })
    }
  }
  return out
}

// The words riding a knock: a comment in the same batch aimed at the knock's
// TARGET. A knock is a nudge; the accompanying comment carries what to say.
let commentOn = (
  changes: Change[],
  docs: Map<string, { title: string; body: string }>,
  target: string,
) => {
  for (let c of changes) {
    if (c.name != 'comment' || !c.comp) continue
    if (str(c.comp.target_eid) != target) continue
    let w = words(docs.get(c.eid))
    if (w) return w
  }
  return ''
}
