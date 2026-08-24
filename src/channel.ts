// The pure event selector shared by the tasks channel and every provider's
// graph inbox. It owns the stream index, recipient rules, and rendering;
// transports only supply context and deliver the resulting events.
//
// A `Change` is the wire unit `{eid, name, comp}` — a component PATCH. The /ws
// endpoint rebroadcasts every applied batch to every client, so this channel is
// just another client that reads, never writes: it watches the stream for
// events about work ITS session owns and turns each into one channel event.

import { type Change, idOf, kindOf } from './types.ts'
import { type Seat, served } from './served.ts'

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
// CLAIMED (a comment on any of them is input for the claimant — the sweep's
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
  // re-rings across a reconnect.
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
  // The durable PUSH proofs captured at this channel process's first snapshot:
  // notified rows whose server-stamped `via` is null. The bus writes the same
  // presence through its serving session, so its non-null stamp cannot claim a
  // channel instance delivered anything. A baseline makes that distinction;
  // absent (tests, the inbox sweep), the whole-`notified` gate stands.
  baseline?: (eid: string) => boolean
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
  // `inbox` is the deliberate task_context sweep: unlike a live channel,
  // it may surface an addressed knock after the resolver stamped its routing
  // outcome. `notified` still bounds it to what nobody has read.
  mode?: 'catchup' | 'resume' | 'inbox'
  // Whether the served session is the project's operator loop. Only a positive
  // capability receives project mail or actor knocks; direct address and
  // claimed-task replies do not depend on it.
  operator?: boolean
  // The clock the recall recency bound reads (T-17487). A catch-up sweep
  // (inbox/resume) that scans accumulated rows must not replay a recall floater
  // that missed its beat: any older than `recallWindowMin` before `now` is
  // gone. A live frame sets neither `now` nor a birthday, so the bound is
  // inert there — everything in one frame is current.
  now?: number
}

// How recent a recall floater must be to still ring (T-17487). A floater is
// ambient — relevant to the message that surfaced it and worthless later ("a
// thought that missed its beat is simply gone", recall.ts). Both delivery
// arms read this single window: busRows' `.created.at>=…` query (client.ts)
// keeps the backlog off the wire, and channelEvents' born bound below keeps
// the whole-snapshot path (noticesFor) in step, so the two never diverge.
export let recallWindowMin = 10

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
  // off the index, not off one batch, so a patch that carries only `turn`
  // can't blank the actor and a rotation can't strand a stale one. `pid`
  // is the seat (findSession, below); the rest route delivery.
  sess?: Sess
}
export type Sess = {
  id?: string
  pid?: number
  actorEid?: string
  personaEid?: string
  operator?: boolean
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
  if ('actor' in comp) s.actorEid = str(comp.actor) || undefined
  if ('persona' in comp) s.personaEid = str(comp.persona) || undefined
  if ('operator' in comp) {
    s.operator = comp.operator == true || comp.operator == 1
      ? true
      : comp.operator == false || comp.operator == 0
      ? false
      : undefined
  }
  if ('origin' in comp) s.origin = str(comp.origin) || undefined
  if ('requested_task' in comp) {
    s.requestedTaskEid = str(comp.requested_task) || undefined
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

// What a fresh channel process may trust as proof of an earlier PUSH. A
// channel writes anonymously (`via = null`); the comms bus names the session
// that printed the item. The distinction survives process churn because a
// snapshot carries every server-stamped column.
export let channelBaseline = (changes: Change[]) =>
  new Set(
    changes
      .filter((c) =>
        c.name == 'notified' && c.comp != null && c.comp.via === null
      )
      .map((c) => c.eid),
  )

// A recovered bus-served item already wears `notified`. Replace that one
// presence atomically after the push lands so its current stamp becomes the
// durable channel proof the next process can trust. The journal retains both
// acts; unopened state remains present throughout the transaction.
export let channelAck = (eid: string, replace = false): Change[] => [
  ...(replace ? [{ eid, name: 'notified', comp: null }] : []),
  { eid, name: 'notified', comp: {} },
]

// eid → human id (T-7), or null when the spine's num hasn't been seen yet.
export let humanId = (index: Index, eid: string): string | null => {
  let row = index.get(eid)
  if (!row || !row.num) return null
  let has: Record<string, true> = {}
  for (let c of row.comps) has[c] = true
  return idOf({ eid, kind: kindOf(has), num: row.num })
}

// A print-mode claude (`-p`/`--print` — every managed spawn and every
// comment-resume courier) renders NO channel events: the run is one turn
// and the process ends with it, so a notification injected mid-turn goes
// nowhere (proven live: five -p runs, zero channel events in the
// transcript — T-7420). Serving one is worse than serving nobody: each
// emit stamps `notified`, which silences the comms bus — the ear a -p
// agent DOES have, on its next tool call. Only flags before `--` count;
// after it, everything is the prompt.
export let printRun = (args: string[]) => {
  let end = args.indexOf('--')
  return args.slice(0, end < 0 ? undefined : end)
    .some((a) => a == '-p' || a == '--print')
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
    seats.push({ eid, num: row.num, pid: row.sess.pid, id: row.sess.id })
    if (by.id && row.sess.id == by.id) hinted = { eid, ...row.sess }
  }
  let seat = served(seats, by.pid)
  return seat ? { eid: seat.eid, ...index.get(seat.eid)?.sess } : hinted
}

// The injection policy (owner, 2026-07-22): ALL verified unread mail aimed at
// this session's home project injects; unverified never does — it stays in the
// store/graph for deliberate triage. `done` is the durable read-state — the
// `opened`/`archived` stamps (T-7006) read off the index — so a letter
// already opened or archived never re-rings. Narrowing later is one line here.
// `operator` gates PROJECT mail to the operator loop. Missing identity fails
// closed; claimed-work comments and session knocks are selected independently.
// Direct session comments remain a deprecated compatibility arm.
// A letter to the SESSION ITSELF (`S-31@<fleet domain>`, resolved in
// src/mail.ts) is direct address and rings whatever loop this is — the
// operator gate belongs to project mail alone, exactly as it does in the
// inbox predicate (client.ts `addressed`).
export let injects = (
  m: Record<string, unknown>,
  homeEid?: string | null,
  done?: boolean,
  operator = false,
  sessionEid?: string | null,
): boolean => {
  if (!m.verified || done) return false
  let at = str(m.target)
  if (sessionEid && at == sessionEid) return true
  return operator && !!homeEid && at == homeEid
}

// A knock the ladder settled as OURS: delivered.via `cast S-31` names the
// very session this channel serves (knock.ts writes `cast S-${num}` when the
// door answered). Paired with the `notified` gate it is the whole test for
// "the stamp says delivered and nobody delivered it".
let lost = (via: string, ctx: Ctx) => {
  let me = ctx.idOf(ctx.sessionEid)
  return !!me && via == `cast ${me}`
}

let words = (doc?: { title: string; body: string }) =>
  doc ? cleanBody(doc.body || doc.title) : ''

let byline = (
  stamp: Record<string, unknown> | undefined,
  idOf: Ctx['idOf'],
) => {
  let by = idOf(str(stamp?.by))
  let via = idOf(str(stamp?.via))
  return by && via && by != via ? `${by} · via ${via}` : by ?? via ?? 'unknown'
}

// Everything channelEvents reads from the batch, keyed by eid.
type Batch = {
  docs: Map<string, { title: string; body: string }>
  created: Map<string, Record<string, unknown>>
  delivered: Map<string, Record<string, unknown>>
  errored: Set<string>
  recipients: Map<string, string>
  sessions: Map<string, string>
  bodies: Map<string, string>
  metas: Set<string>
  born?: Map<string, number>
}

// Build every index channelEvents needs in ONE pass, not eight separate scans
// (T-18331). On the whole-snapshot arm (resume/inbox: boot digest, MCP read,
// tmux poll) `changes` is the entire graph, so eight passes cost ~8× for the
// ~200 changes that matter. Each field is exactly what its former per-name
// builder produced — last-wins per map, batch order preserved. `withBorn` is
// set only on the resume/inbox arm: a live frame is one moment so commentOn
// needs no birthdays, but a resume sweep reads a whole snapshot where a target
// may carry a year of comments and only the knock's own minute rode with it.
let indexBatch = (changes: Change[], withBorn: boolean): Batch => {
  let docs = new Map<string, { title: string; body: string }>()
  let created = new Map<string, Record<string, unknown>>()
  let delivered = new Map<string, Record<string, unknown>>()
  let errored = new Set<string>()
  let recipients = new Map<string, string>()
  let sessions = new Map<string, string>()
  let bodies = new Map<string, string>()
  let metas = new Set<string>()
  let born = withBorn ? new Map<string, number>() : undefined
  for (let c of changes) {
    if (!c.comp) continue
    switch (c.name) {
      // A comment's words and a knock's note both land as a `doc` beside their
      // own component at mint; a bodiless doc isn't in this batch.
      case 'doc':
        docs.set(c.eid, { title: str(c.comp.title), body: str(c.comp.body) })
        break
      // The `created` stamp byline reads; on the resume/inbox arm its parsed
      // `at` is also the birthday commentOn dates a note by.
      case 'created':
        created.set(c.eid, c.comp)
        if (born) {
          let t = Date.parse(str(c.comp.at))
          if (t) born.set(c.eid, t)
        }
        break
      // A deliverable's OUTCOME (D-14945): delivered/error travel as their own
      // frames — absent at a knock's mint, present in a resume snapshot.
      case 'delivered':
        delivered.set(c.eid, c.comp)
        break
      case 'error':
        errored.add(c.eid)
        break
      // WHO a deliverable is for — the shared `deliver {to}` facet; a knock is
      // cast with its deliver alongside, so the recipient is always in-batch.
      case 'deliver':
        recipients.set(c.eid, str(c.comp.to))
        break
      // A recall entry is addressed by its `entry.session` partition, not a
      // recipient facet. Only an entry that CARRIES a session maps one: apply()
      // echoes a second session-less `entry` per write (the stamped {eid,seq}
      // ingest coordinate), and skipping it stops a last-wins map from erasing
      // a floater's real partition. entry.session is never nulled, so a
      // session-less entry change is always that stamp.
      case 'entry':
        if (c.comp.session != null) sessions.set(c.eid, str(c.comp.session))
        break
      case 'content':
        bodies.set(c.eid, str(c.comp.body))
        break
      // Comments tagged `meta` (T-17319) — a transcript memo for the dream,
      // never a live knock; the comment branch skips these (load-bearing: a
      // meta memo must not fall through and deliver as an ordinary comment on
      // its session, the exact distraction it exists to avoid).
      case 'meta':
        metas.add(c.eid)
        break
    }
  }
  return {
    docs,
    created,
    delivered,
    errored,
    recipients,
    sessions,
    bodies,
    metas,
    born,
  }
}

// The filter + format, pure. Given one broadcast batch and the session context,
// return the channel events to emit — in batch order, so delivery is
// deterministic. Five event shapes reach a run:
//
//   1. a `comment` whose target is one of this run's CLAIMED tasks — but ONLY
//      at mint, when the batch also carries the doc that holds the words (a
//      bodiless later patch is skipped). It names the task in `on=` so the run
//      knows which work changed. This session's eid is accepted only through
//      the deprecated compatibility arm.
//   1b. a `notice` (D-13858): keyed exactly like a comment (claimed task, plus
//      the same session compatibility arm), but emitted, not said — off the
//      mail relay and out of the conversation thread.
//   2. a `knock` (types.ts): the shared `deliver {to}` is the recipient —
//      this session or its actor — and target is what to look at; the
//      words ride as a plain comment on the TARGET in the same batch (the
//      :knock contract).
//   3. a `mail` arrival for the session's home project — see the branch.
//   4. a `recall` (recall.ts): memories that floated up as this session
//      thought, written into its OWN log — addressed by the entry's session
//      partition, not a recipient facet.
export let channelEvents = (changes: Change[], ctx: Ctx): Event[] => {
  let {
    docs,
    created,
    delivered,
    errored,
    recipients,
    sessions,
    bodies,
    metas,
    born,
  } = indexBatch(changes, ctx.mode == 'resume' || ctx.mode == 'inbox')
  let out: Event[] = []
  // Already told by PUSH: this run's deliveries, or an anonymous channel stamp
  // from an earlier process. Without a baseline (tests, the inbox sweep), the
  // shared `notified` presence retains its ordinary whole-fleet meaning.
  let pushed = (eid: string) => ctx.baseline ? ctx.baseline(eid) : true
  let told = (eid: string) =>
    !!ctx.sent?.(eid) ||
    (ctx.mode != 'catchup' && !!ctx.notified?.(eid) && pushed(eid))
  for (let c of changes) {
    if (!c.comp) continue

    // A session's own write is never a message back to itself. This skip lived
    // as a post-filter inside notices() (client.ts), so the live channel push
    // path (channels/tasks/server.ts feed()) — the selector's other consumer —
    // echoed a session its own comments. Moved into the shared selector, both
    // consumers inherit one implementation and cannot drift (T-20163).
    // `created.via` is the instrument that wrote the entity; == the reading
    // session means the session authored it. Self-directed floaters stay safe:
    // a recall and a cadence self-knock are server/actor-minted with via ==
    // null (wake's knock is stamped for the wake's author, an actor eid that
    // resolves to no instrument), never == the reading session.
    if (created.get(c.eid)?.via == ctx.sessionEid) continue

    if (c.name == 'comment') {
      let at = str(c.comp.target)
      let mine = at == ctx.sessionEid || !!ctx.claimedEids?.has(at)
      if (!mine) continue
      if (metas.has(c.eid)) continue // a meta memo is harvested, never injected live
      let content = words(docs.get(c.eid))
      if (!content) continue // bodiless mint or a later comp-only patch
      if (told(c.eid)) continue
      let from = byline(created.get(c.eid), ctx.idOf)
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

    // A `notice` (D-13858): something happened ABOUT its target that nobody
    // said. Served beside comments and keyed the same way — its target is
    // this session or a task it claims — but it is not a comment: it carries
    // its own words in a doc, never rode a conversation, and fanout cannot
    // see it. `kind` names what happened; the byline is the emitter.
    if (c.name == 'notice') {
      let at = str(c.comp.target)
      let mine = at == ctx.sessionEid || !!ctx.claimedEids?.has(at)
      if (!mine) continue
      let content = words(docs.get(c.eid))
      if (!content) continue // bodiless mint or a later comp-only patch
      if (told(c.eid)) continue
      let from = byline(created.get(c.eid), ctx.idOf)
      let meta: Record<string, string> = {
        kind: 'notice',
        from: cleanAttr(from),
      }
      if (at != ctx.sessionEid) meta.on = cleanAttr(ctx.idOf(at) ?? at)
      out.push({ content, meta, eid: c.eid })
      continue
    }

    if (c.name == 'knock') {
      // A knock's OUTCOME is the shared delivered/error facet (D-14945),
      // broadcast as its own frame — absent at mint (the live inject path),
      // present in a resume snapshot. A settled knock is a receipt, not a
      // second nudge, so skip it. On a RESUME sweep it is the opposite:
      // delivered.via `cast S-me` is the ladder CLAIMING this channel took
      // it, and an un-`notified` row proves the claim false — that knock is
      // exactly what a disconnect ate (T-7302), so ring it and make it true.
      let won = delivered.get(c.eid)
      let acted = !!won || errored.has(c.eid)
      if (
        acted &&
        ctx.mode != 'inbox' &&
        !(ctx.mode == 'resume' && lost(str(won?.via), ctx))
      ) {
        continue
      }
      let recipient = recipients.get(c.eid) ?? ''
      if (
        recipient != ctx.sessionEid &&
        !(ctx.operator == true && recipient == ctx.actorEid)
      ) continue
      if (told(c.eid)) continue
      let at = str(c.comp.target)
      let atId = at ? ctx.idOf(at) ?? at : null
      let when = Date.parse(str(won?.at))
      let note = commentOn(
        changes,
        docs,
        at,
        born && when ? { born, at: when } : undefined,
      )
      // A knock delivered to your OWN home board and pointed at that board is a
      // cadence RETURN — your own timer bringing you back, not a stranger's
      // nudge. It says so and names the board as yours; every other target is
      // "look at X". The `kind="knock"` frame already says it is a knock, so
      // neither wording repeats the word.
      let mine = at != '' && at == ctx.homeEid && recipient == ctx.homeEid
      let head = mine
        ? `your pass resumes on ${atId}`
        : atId
        ? `look at ${atId}`
        : 'a knock'
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
        !injects(
          c.comp,
          ctx.homeEid,
          ctx.done?.(c.eid),
          ctx.operator == true,
          ctx.sessionEid,
        )
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
      continue
    }

    // A `recall` (recall.ts): memories that floated up as this session thought,
    // written into its own log. The delivery address is the entry's session
    // partition — no recipient facet — so it rings whatever loop this is, like a
    // comment on the session itself, never gated on operator/mail. The content
    // is the floater lines (M-id · title); the `notified` gate dedups a replay.
    if (c.name == 'recalled') {
      if (sessions.get(c.eid) != ctx.sessionEid) continue
      // Bounded to recent (T-17487): on a catch-up sweep — where `born` and
      // `now` are both set — a floater older than the recall window is a missed
      // beat, dropped so a backlog never floods the session. A live frame sets
      // neither, so a fresh floater always rings.
      let bornAt = born?.get(c.eid)
      if (
        ctx.now != null && bornAt != null &&
        bornAt < ctx.now - recallWindowMin * 60_000
      ) continue
      let content = cleanBody(bodies.get(c.eid) ?? '')
      if (!content) continue
      if (told(c.eid)) continue
      out.push({ content, meta: { kind: 'recall' }, eid: c.eid })
      continue
    }
  }
  return out
}

// The words riding a knock: a comment in the same batch aimed at the knock's
// TARGET. A knock is a nudge; the accompanying comment carries what to say.
// `near` is the resume sweep's clock: a snapshot is not a batch, so the words
// are picked by TIME instead — the newest comment on the target born in the
// knock's own minute, the window knock.ts's wordsFor() uses. None in that
// window means the knock arrives bare rather than wearing someone else's
// words.
let commentOn = (
  changes: Change[],
  docs: Map<string, { title: string; body: string }>,
  target: string,
  near?: { born: Map<string, number>; at: number },
) => {
  let best = ''
  let bestAt = 0
  for (let c of changes) {
    if (c.name != 'comment' || !c.comp) continue
    if (str(c.comp.target) != target) continue
    let w = words(docs.get(c.eid))
    if (!w) continue
    if (!near) return w
    let t = near.born.get(c.eid) ?? 0
    if (!t || t > near.at || near.at - t > 60_000 || t <= bestAt) continue
    best = w
    bestAt = t
  }
  return best
}
