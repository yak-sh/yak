// The store an app's own pages talk to: one ES module, no build, served by
// the kernel at `<space>.yaks.app/<app>/api/client.js` beside the doors it
// wraps. A page writes
// `import { apply, query, subscribe } from './api/client.js'` and has
// the app's graph — the same bundle shape the MCP tools speak
// (`{entity: {eid}, ...components}`, a `$alias` wherever an eid goes), entity
// JSON back. Nothing to install and nothing to configure: the module's own
// address IS the app's api directory, so a page at any depth reaches its own
// store, and the browser's cookie says who is asking.
//
// The import is RELATIVE, and nothing in an app names the app: the kernel
// gives every page it serves a `<base href>` at the app's own address
// (apps.ts `based`), so `./api/client.js` is this app's client from a page at
// any depth — a pretty path like `/lending/loans/1` included — and stays this
// app's client in a copy someone installed at another address (C-32905 item
// 1). An absolute `/<app>/api/client.js` still works; it just stops working
// the moment the app is copied.
//
// `subscribe(filter, cb)` is `query(filter)` that keeps answering: one socket
// onto the app's store (the Store object's /ws, hibernating while nothing
// happens), so a write from another device — or another tab, or an agent —
// re-renders the page without a poll. It hands back the same rows `query`
// does; the returned function ends it.
//
// `me()` is who is looking: the page asks before it asks the person for
// anything, so it can show a sign-in link or a name field on load rather than
// after a refusal.
//
// `upload(file, {name})` is the bytes half: the app's own file door
// (`POST ./api/blob`), which stores what a page hands it — a File off an
// input, a Blob a canvas made — under its own SHA-256 and answers the address
// to put in an `<img src>` and the eid for a row to point at.
//
// `store(base)` is those doors at an address you name, and what the bound
// set is made of. Every app in a space shares one hostname, so
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

// A refusal, as one Error. The kernel and the store both answer a sentence —
// `{error: {code, message}}` from the kernel, plain words from the store —
// and that sentence is the whole of what a page shows and an agent reads.
// A body that is neither is a PAGE (a 404 answers the platform's "Nothing
// here yet." HTML), so it never rides the throw: the status and a short line
// of it say what happened without dumping a document into an error message
// (C-32574 items 2 and 4).
//
// When signing in is the way through, the kernel also names where: the throw
// carries `signIn`, the login page already holding this page as its return
// address, so `catch (e) { if (e.signIn) location = e.signIn }` sends them
// and brings them back (T-32593).
let refused = (r, body) => {
  let said = null
  try {
    said = JSON.parse(body).error
  } catch { /* not JSON: the status and a short line of whatever it was */ }
  let line = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, 120)
  let e = new Error(
    said?.message ?? said?.code ?? `${r.status} ${line || r.statusText}`,
  )
  if (said?.signIn) e.signIn = said.signIn
  return e
}

let door = (base) => async (path, init) => {
  let r = await fetch(new URL(path, base), init)
  let body = await r.text()
  if (!r.ok) throw refused(r, body)
  return body ? JSON.parse(body) : null
}

// The address a store's doors hang off. Every app in a space shares one
// hostname, so the address a page names is a PATH — `store('/lending/api/')`,
// which the guide's own line — and a path is no `new URL` base by itself:
// the documented call threw `Invalid base URL` (C-32800 item 6). It is
// resolved against this origin, and a path that names the api directory
// without saying so keeps its meaning: the doors are under it, so the base
// ends in a slash or `query` would replace the last segment.
let based = (base) => {
  if (base instanceof URL) return base
  let at = new URL(base, globalThis.location?.origin)
  if (!at.pathname.endsWith('/')) at.pathname += '/'
  return at
}

export let store = (base) => {
  base = based(base)
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
  // '.opaque.format=recipe', 'id=<eid>', 'limit=', 'after='. Oldest first,
  // by the number the store minted; a windowed read is the newest page of
  // that same order.
  //
  // A row carries ONLY the components the filter names, so name the ones the
  // page will draw: '.recipe!' answers recipes with no titles, and
  // '.recipe!&.doc?' answers both — '&' joins filters and '?' asks for a
  // component without filtering on it. A dotted word addresses that
  // component's own column ('.recipe.minutes<=30'), never a second
  // component; '&.doc?' is the way to ask for one of those.
  let query = (filter = '') => ask(`query?${filter}`)
  // Full-text over the docs, ranked. A word names no component to leave out,
  // the way `id=` does not, so a search with no filter answers whole entities
  // — the app's own components included, which is what a page drawing cards
  // from a search needs. Pass a filter and the ordinary rule is back:
  // `search('lemon', '.recipe!&.doc?')` is recipes with their titles.
  let search = (text, filter = '') =>
    query(`${encodeURIComponent(text)}${filter ? `&${filter}` : ''}`)

  // Who is looking, before anything is asked of them: `{person, name, role,
  // reads, writes, signIn}` — `person` null when they are signed out, `name`
  // what to call them, `writes` whether this app takes a write from them, and
  // `signIn` where a signed-out visitor signs in. Call it on load and the page
  // knows
  // whether to show a sign-in link or a name field, instead of finding out
  // from a refusal after someone has typed (C-32675 items 5 and 6).
  let me = () => ask('me')

  // Bytes, in: a File off an `<input type=file>`, a Blob a canvas made. The
  // door answers `{eid, url, mime, bytes}` — the eid to point a row at
  // (`{photo: {caption, blob: eid}}`) and the url to put in an `<img src>`.
  // Content-addressed, so the same file twice is one upload and one row, and
  // a page may re-send rather than remember. 20 MB is the ceiling; downscale
  // a photo on the page before you send it.
  let upload = (file, opts = {}) => {
    let name = opts.name ?? file.name ?? ''
    return ask('blob', {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        // A header is ASCII and a file's name is not, so the name is
        // percent-encoded here and decoded by the door.
        ...(name ? { 'x-yak-name': encodeURIComponent(name) } : {}),
      },
      body: file,
    })
  }

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
    // catch-up: the store answers each declaration with the whole set, so the
    // rows it replaces are dropped first.
    s.onopen = () => {
      tries = 0
      for (let [name, sub] of subs) {
        sub.rows.clear()
        s.send(JSON.stringify({ subscribe: sub.q, id: name }))
      }
    }
    s.onmessage = (e) => {
      let f = JSON.parse(e.data)
      let sub = subs.get(f.id)
      if (!sub) return
      // The store's own sentence about a query it could not serve; uncaught
      // on purpose, so the reporter tells the person's agent about it.
      if (f.refused) throw new Error(f.refused.message ?? f.refused.error)
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
  // `query()` answers with — the components the filter NAMES and no others,
  // so '.recipe!&.doc?' where the page draws titles — and a page swaps one
  // for the other and nothing else changes; the returned function ends the
  // subscription.
  let subscribe = (filter, cb) => {
    let name = `${++n}:${filter}`
    let q = asked(filter)
    subs.set(name, { q, rows: new Map(), cb })
    tell({ subscribe: q, id: name })
    return () => {
      if (!subs.delete(name)) return
      // No subscriptions, no socket: the last one to leave closes it, and the
      // next subscribe opens a new one.
      if (!subs.size) {
        let s = sock
        sock = null
        return s && s.close()
      }
      tell({ unsubscribe: name })
    }
  }
  return { apply, me, query, search, subscribe, upload }
}

// One subscription frame folded into its rows. A frame carries whole ROWS —
// the same answer `query()` gives, because the store paints the same word on
// both — so folding is just keeping them: a row replaces the one it names, and
// one that is `gone` (it died, or it stopped matching) leaves.
let fold = (rows, f) => {
  for (let row of f.bundles ?? []) rows.set(row.entity.eid, row)
  for (let eid of f.gone ?? []) rows.delete(eid)
}

// A page's filter as the STORE spells it. A fetch goes through the app's door,
// which does this on the way (workers/yak/wire.ts `lined`, listing.ts
// `asking`); a socket goes straight to the store, so a subscription is
// translated here — the same two rules, so `query(f)` and `subscribe(f)` ask
// one question.
//
// Two rules, and no more. Three riders the page spells bare are dotted words
// there (`id=` is an address, so it is `.eid=`), and the platform's own rows —
// the breaks it noted, the person row a store mints for each writer — are left
// out of the question unless the filter names one.
let RIDERS = { id: '.eid', limit: '.limit', after: '.after' }
let SCREEN = ['exception', 'error', 'person']
let OPERATOR = /^([A-Za-z_.\-[\]][\w.\-[\]]*)(!=|~=|<=|>=|<|>|=|!|\?)/

let plain = (v) => {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

// A decoded value the grammar would otherwise read as structure: `&` separates
// segments, and quotes glue a value across one. A dot-param's own spaces
// survive unquoted, and a value carrying a quote has no escape, so it goes over
// as it stands rather than becoming a different value.
let glued = (v, term) =>
  (v.includes('&') || (!term && /\s\./.test(v))) && !v.includes('"')
    ? `"${v}"`
    : v

let asked = (filter = '') => {
  let line = filter.replace(/^[?&]+/, '').split('&').filter(Boolean)
    .map((seg) => {
      let m = OPERATOR.exec(seg)
      if (!m) return glued(plain(seg), true)
      let v = glued(plain(seg.slice(m[0].length)))
      return `${RIDERS[m[1]] ?? m[1]}${m[2]}${v}`
    }).join('&')
  if (!line || line.includes('id=')) return line
  let screen = SCREEN.filter((k) => !line.includes(`.${k}`)).map((k) =>
    `.${k}=`
  )
  return [line, ...screen].join('&')
}

// Oldest first, by the number the store minted — `query()`'s own order.
let rows = (held) =>
  [...held.values()].sort((a, b) => (a.entity.num ?? 0) - (b.entity.num ?? 0))

export let { apply, me, query, search, subscribe, upload } = store(
  new URL('.', import.meta.url),
)
