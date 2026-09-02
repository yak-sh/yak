// The store an app's own pages talk to: one ES module, no build, served by
// the kernel at `<space>.yaks.app/<app>/api/client.js` beside the doors it
// wraps. A page writes
// `import { apply, query, subscribe } from './api/client.js'` and has the
// app's graph — the same bundle shape the MCP tools speak
// (`{entity: {eid}, ...components}`, a `$alias` wherever an eid goes), entity
// JSON back. Nothing to install and nothing to configure: the module's own
// address IS the app's api directory, so a page at any depth reaches its own
// store, and the browser's cookie says who is asking.
//
// `subscribe(filter, cb)` is `query(filter)` that keeps answering: one socket
// onto the app's store (the Store object's /ws, hibernating while nothing
// happens), so a write from another device — or another tab, or an agent —
// re-renders the page without a poll. It hands back the same rows `query`
// does; the returned function ends it.
//
// `store(base)` is those four doors at an address you name, and what the
// bound set is made of. Every app in a space shares one hostname, so
// `store('/other/api/')` reads a sibling app's graph the same way.
//
// Errors need no wiring here: the kernel injects a reporter into every page
// it serves (public/report.js), so a throw, an uncaught rejection, or a
// refusal from these doors is already on its way to the app's store and the
// person's agent. Catch what you want to SHOW; the telling is done.
//
// A refusal is thrown with the server's own words — 'not a writer of jeff',
// or what the store said about the batch — because that sentence is what the
// person's agent reads next (D-32318 §Errors are surfaced).

let door = (base) => async (path, init) => {
  let r = await fetch(new URL(path, base), init)
  let body = await r.text()
  if (!r.ok) throw new Error(body || `${r.status} ${r.statusText}`)
  return body ? JSON.parse(body) : null
}

export let store = (base) => {
  let ask = door(base)
  // One bundle or many, in; `{ok, changes, aliases}` back, where `aliases`
  // maps each `$alias` to the eid it minted.
  let apply = (bundles) =>
    ask('apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entities: Array.isArray(bundles) ? bundles : [bundles],
      }),
    })
  // The filter line, the grammar the boards speak: '.doc.title~=cake',
  // '.opaque.format=recipe', 'id=<eid>', 'limit=', 'after='. Newest first.
  let query = (filter = '') => ask(`query?${filter}`)
  // Full-text over the docs, ranked; a filter may ride along.
  let search = (text, filter = '') =>
    query(`${encodeURIComponent(text)}${filter ? `&${filter}` : ''}`)

  // The live half: one socket onto this store, opened on the first
  // subscription and shared by all of them, reconnecting on its own.
  let subs = new Map()
  let sock = null
  let tries = 0
  let n = 0
  let open = () => {
    if (sock) return sock
    let url = new URL('ws', base)
    url.protocol = url.protocol == 'https:' ? 'wss:' : 'ws:'
    let s = sock = new WebSocket(url)
    // Every subscription is (re)declared on open, so a reconnect needs no
    // catch-up: each answer replaces that sub's rows with what is true now.
    s.onopen = () => {
      tries = 0
      for (let [name, sub] of subs) {
        s.send(JSON.stringify({ sub: name, q: sub.q }))
      }
    }
    s.onmessage = (e) => {
      let f = JSON.parse(e.data)
      let sub = subs.get(f.sub)
      if (!sub) return
      // The store's own sentence about a query it could not serve; uncaught
      // on purpose, so the reporter tells the person's agent about it.
      if (f.error) throw new Error(f.error)
      fold(sub.rows, f)
      sub.cb(rows(sub.rows))
    }
    s.onclose = () => {
      sock = null
      if (subs.size) setTimeout(open, Math.min(1000 * 2 ** tries++, 15000))
    }
    return s
  }
  let tell = (frame) => {
    let s = open()
    if (s.readyState == 1) s.send(JSON.stringify(frame))
  }
  // The filter's matches now, and again on every change — a write from
  // another device, another tab, or an agent. `cb` is handed the same rows
  // `query()` answers with, so a page swaps one for the other and nothing
  // else changes; the returned function ends the subscription.
  let subscribe = (filter, cb) => {
    let name = `${++n}:${filter}`
    subs.set(name, { q: filter, rows: new Map(), cb })
    tell({ sub: name, q: filter })
    return () => {
      if (!subs.delete(name)) return
      // No subscriptions, no socket: the last one to leave closes it, and the
      // next subscribe opens a new one.
      if (!subs.size) {
        let s = sock
        sock = null
        return s && s.close()
      }
      tell({ unsub: name })
    }
  }
  return { apply, query, search, subscribe }
}

// One subscription frame folded into its rows: `replace` reseeds the set,
// a change patches one component (null clears it), a dead entity and a
// `drop` (it left the filter) both leave.
let fold = (rows, f) => {
  if (f.replace) rows.clear()
  for (let c of f.changes ?? []) {
    if (c.name == 'entity' && c.comp == null) {
      rows.delete(c.eid)
      continue
    }
    let row = rows.get(c.eid)
    if (!row) rows.set(c.eid, row = { entity: { eid: c.eid } })
    if (c.comp == null) delete row[c.name]
    else row[c.name] = { ...row[c.name], ...c.comp }
  }
  for (let eid of f.drop ?? []) rows.delete(eid)
}

// Oldest first, by the number the store minted — `query()`'s own order.
let rows = (held) =>
  [...held.values()].sort((a, b) => (a.entity.num ?? 0) - (b.entity.num ?? 0))

export let { apply, query, search, subscribe } = store(
  new URL('.', import.meta.url),
)
