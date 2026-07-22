// The pure heart of the tasks channel — split out of server.ts so the socket-
// free logic (who a broadcast batch is aimed at, how it renders) is unit-
// testable without a WebSocket or an MCP stdio pipe. server.ts wires these to
// the live stream; server_test.ts drives them with hand-built batches.
//
// A `Change` is the wire unit `{eid, name, comp}` — a component PATCH. The /ws
// endpoint rebroadcasts every applied batch to every client, so this channel is
// just another client that reads, never writes: it watches the stream for two
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
// either), and how to turn an eid into a human id (T-7, S-31) — null when the
// eid isn't known yet.
export type Ctx = {
  sessionEid: string
  actorEid?: string | null
  idOf: (eid: string) => string | null
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
export type Row = { num: number; comps: Set<string> }
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
}

// eid → human id (T-7), or null when the spine's num hasn't been seen yet.
export let humanId = (index: Index, eid: string): string | null => {
  let row = index.get(eid)
  if (!row || !row.num) return null
  let has: Record<string, true> = {}
  for (let c of row.comps) has[c] = true
  return idOf({ kind: kindOf(has), num: row.num })
}

// Find the session entity whose session.id equals the id this plugin serves,
// within one batch — the boot snapshot resolves it, or a later SessionStart
// mint does. Returns the eid plus the actor it runs for (both may arrive in the
// same or a later session patch).
export let findSession = (
  changes: Change[],
  sessionId: string,
): { eid: string; actorEid?: string } | undefined => {
  for (let c of changes) {
    if (c.name != 'session' || !c.comp) continue
    if (str(c.comp.id) != sessionId) continue
    let actor = str(c.comp.actor_eid)
    return { eid: c.eid, actorEid: actor || undefined }
  }
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
// deterministic. Two things are aimed at a session:
//
//   1. a `comment` whose target_eid is this session's eid — someone messaging
//      the session — but ONLY at mint, when the batch also carries the doc that
//      holds the words (a bodiless later patch is skipped).
//   2. a `knock` (types.ts): to_eid is the recipient — this session or its
//      actor — and target_eid is what to look at; the words ride as a plain
//      comment on the TARGET in the same batch (the :knock contract).
export let channelEvents = (changes: Change[], ctx: Ctx): Event[] => {
  let docs = docsIn(changes)
  let out: Event[] = []
  for (let c of changes) {
    if (!c.comp) continue

    if (c.name == 'comment') {
      if (str(c.comp.target_eid) != ctx.sessionEid) continue
      let content = words(docs.get(c.eid))
      if (!content) continue // bodiless mint or a later comp-only patch
      let from = ctx.idOf(str(c.comp.author_eid)) ?? 'unknown'
      out.push({ content, meta: { kind: 'comment', from: cleanAttr(from) } })
      continue
    }

    if (c.name == 'knock') {
      let recipient = str(c.comp.to_eid)
      if (recipient != ctx.sessionEid && recipient != ctx.actorEid) continue
      let at = str(c.comp.target_eid)
      let atId = at ? ctx.idOf(at) ?? at : null
      let note = commentOn(changes, docs, at)
      let head = atId ? `knock: look at ${atId}` : 'knock'
      let content = note ? `${head} — ${note}` : head
      out.push({ content, meta: { kind: 'knock' } })
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
