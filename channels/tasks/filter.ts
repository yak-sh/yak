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

// A rendered channel event: the notification params shape server.js emits
// verbatim — `{content, meta}` under method notifications/claude/channel. The
// MCP server's name ("tasks") becomes the source= attribute; meta carries the
// rest (kind, from). Attacker-controlled strings live in meta/content, never
// built into a forged attribute.
export type Event = { content: string; meta: Record<string, string> }

// What channelEvents needs to know about the world beyond one batch: which
// session entity it serves, that session's actor (a knock may be aimed at
// either), its home project (where its mail lands), the eids of the tasks it has
// CLAIMED (a comment on any of them is a message to the claimant — the sweep's
// `mine` in client.ts notices()), how to turn an eid into a human id (T-7, S-31)
// — null when the eid isn't known yet — and a letter's words from the cache (the
// arrival stamp is a bare mail row). `seen` is the mail eids already delivered
// this run: any later full-row stamp re-broadcast (the mail.ts idiom casts whole
// rows) must not ring twice.
export type Ctx = {
  sessionEid: string
  actorEid?: string | null
  homeEid?: string | null
  claimedEids?: Set<string>
  idOf: (eid: string) => string | null
  docOf?: (eid: string) => { title: string; body: string } | null
  seen?: Set<string>
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
}
export type Index = Map<string, Row>

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

// eid → human id (T-7), or null when the spine's num hasn't been seen yet.
export let humanId = (index: Index, eid: string): string | null => {
  let row = index.get(eid)
  if (!row || !row.num) return null
  let has: Record<string, true> = {}
  for (let c of row.comps) has[c] = true
  return idOf({ kind: kindOf(has), num: row.num })
}

// Find the served session within one batch. Identity is the claude PROCESS:
// a session change carrying `pid` == ours is the session — and the LAST such
// change wins, because a /clear reifies a NEW entity under the same pid (it
// broadcasts after, and sits after, any trace of the row it replaces), so
// service follows the rotation. The weaker clues never rotate: a change on
// the already-resolved eid keeps actor/persona fresh, and the spawn-time id
// is the boot fast-path (an MCP subprocess's env id is frozen at spawn — it
// can't be trusted to name the session past boot).
export let findSession = (
  changes: Change[],
  by: { pid?: number; eid?: string; id?: string },
): { eid: string; actorEid?: string; personaEid?: string } | undefined => {
  let hit: Change | undefined
  let weak: Change | undefined
  for (let c of changes) {
    if (c.name != 'session' || !c.comp) continue
    if (by.pid != null && c.comp.pid == by.pid) hit = c
    else if (
      (by.eid != null && c.eid == by.eid) ||
      (by.id != null && str(c.comp.id) == by.id)
    ) weak = c
  }
  let c = hit ?? weak
  if (!c?.comp) return
  return {
    eid: c.eid,
    actorEid: str(c.comp.actor_eid) || undefined,
    personaEid: str(c.comp.persona_eid) || undefined,
  }
}

// The injection policy (owner, 2026-07-22): ALL verified unread mail aimed at
// this session's home project injects; unverified never does — it stays in the
// store/graph for deliberate triage. Narrowing later is one line here.
export let injects = (
  m: Record<string, unknown>,
  homeEid?: string | null,
): boolean =>
  !!m.verified && !m.read_at && !!homeEid && str(m.target_eid) == homeEid

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
  for (let c of changes) {
    if (!c.comp) continue

    if (c.name == 'comment') {
      let at = str(c.comp.target_eid)
      let mine = at == ctx.sessionEid || !!ctx.claimedEids?.has(at)
      if (!mine) continue
      let content = words(docs.get(c.eid))
      if (!content) continue // bodiless mint or a later comp-only patch
      let from = ctx.idOf(str(c.comp.author_eid)) ?? 'unknown'
      let meta: Record<string, string> = {
        kind: 'comment',
        from: cleanAttr(from),
      }
      // On a claimed TASK (not the session), name the target so the operator
      // knows which one — the sweep line prefixes the same id.
      if (at != ctx.sessionEid) meta.on = cleanAttr(ctx.idOf(at) ?? at)
      out.push({ content, meta })
      continue
    }

    if (c.name == 'knock') {
      // The resolver's stamp re-broadcasts the full row with acted_at
      // set (a server-only column, absent at mint) — that's the receipt
      // of a knock already delivered, not a second nudge.
      if (c.comp.acted_at != null) continue
      let recipient = str(c.comp.to_eid)
      if (recipient != ctx.sessionEid && recipient != ctx.actorEid) continue
      let at = str(c.comp.target_eid)
      let atId = at ? ctx.idOf(at) ?? at : null
      let note = commentOn(changes, docs, at)
      let head = atId ? `knock: look at ${atId}` : 'knock'
      let content = note ? `${head} — ${note}` : head
      out.push({ content, meta: { kind: 'knock' } })
      continue
    }

    if (c.name == 'mail') {
      // The sweep's stamp broadcast is the arrival: received_at is a
      // server-only column, so only the full-row stamp carries it (knock's
      // acted_at trick, inverted — here the stamp IS the news). The mint's
      // wire frames never wear it, and `seen` keeps any later full-row
      // re-broadcast from ringing twice.
      if (c.comp.received_at == null) continue
      if (!injects(c.comp, ctx.homeEid)) continue
      if (ctx.seen?.has(c.eid)) continue
      ctx.seen?.add(c.eid)
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
      out.push({ content, meta })
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
