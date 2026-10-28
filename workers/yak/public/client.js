import { decode, stringify, unpack } from './_wire.js'
import { browserDrafts, draftEid } from './_draft.js'
import { durableOutbox } from './_outbox.js'
import { system } from '@yaks/fp'
export { draftEid }

// The store an app's own pages talk to: one ES module, no build, served by
// the kernel at `<space>.yaks.app/<app>/api/client.js` beside the doors it
// wraps. A page writes
// `import { apply, query, subscribe } from './api/client.js'` and has
// the app's graph — the same bundle shape the MCP tools speak
// (`{entity: {eid}, ...components}`, a `$alias` wherever an eid goes), entity
// JSON back. Nothing to install and nothing to configure: the module's own
// address is the app's api directory, so a page at any depth reaches its own
// store, and the browser's cookie says who is asking.
//
// The import is relative, and nothing in an app names the app: the kernel
// gives every page it serves a `<base href>` at the app's own address
// (apps.ts `based`), so `./api/client.js` is this app's client from a page at
// any depth — a pretty path like `/lending/loans/1` included — and stays this
// app's client in a copy someone installed at another address (C-32905 item
// 1). An absolute `/<app>/api/client.js` still works; it just stops working
// the moment the app is copied.
//
// `subscribe(filter, cb)` is `query(filter)` that keeps answering: one socket
// onto the app's API, which watches any component homes the app uses, so a
// write from another device — or another tab, or an agent — re-renders the
// page without a poll. It hands back the same rows `query` does, the first of
// them over the page's own connection while the socket opens; the returned
// function ends it, and its `ready` is those first rows, for a page that waits
// for them. A page that subscribes to what it draws, all of it at once, loads
// in one round.
//
// `me()` is who is looking: the page asks beside its first reads, never ahead
// of them, so it can show a sign-in link or a name field on load rather than
// after a refusal, and its data does not wait for the answer.
//
// `upload(file, {name})` is the bytes half: the app's own file door
// (`POST ./api/blob`), which stores what a page hands it — a File off an
// input, a Blob a canvas made — under its own SHA-256 and answers the address
// to put in an `<img src>` and the eid for a row to point at. Deleting the row
// at that eid (`apply({entity: {eid}, $delete: true})`) deletes the upload,
// bytes and all. A big file goes up in parts, several at once, and an upload
// cut short resumes: sent again, from this tab or another, it sends only the
// parts the platform does not have yet (`POST ./api/blob/<sha>`). `digest(file)`
// is that SHA-256, the eid an upload of the file answers.
//
// `was(value)` is the precondition half of a write: hash what you read, name
// it under `$was`, and the store refuses the whole batch if that property has
// moved since — the read-modify-write two tabs cannot both win.
//
// `store(base)` is those doors at an address you name, and what the bound
// set is made of. Every app in a space shares one hostname, so
// `store('/other/api/')` reads a sibling app's graph the same way.
// `store(base, {clock})` keeps the store's waits (the outbox's and an
// upload's retries, the socket's reconnects) on `clock` (@yaks/fp `Clock`),
// which a test moves itself; unset, the runtime's.
//
// Errors need no wiring here: the kernel injects a reporter into every page
// it serves (public/report.js), so a throw, an uncaught rejection, or a
// refusal from these doors is already on its way to the app's store and the
// person's agent. Catch what you want to show; the telling is done.
//
// A refusal is thrown with the server's own words — 'not a writer of jeff',
// or what the store said about the batch — because that sentence is what the
// person's agent reads next (D-32318 §Errors are surfaced).

// A refusal, as one Error. The kernel and the store both answer a sentence —
// `{error: {code, message}}` from the kernel, plain words from the store —
// and that sentence is the whole of what a page shows and an agent reads.
// A body that is neither is a page (a 404 answers the platform's "Nothing
// here yet." HTML), so it never rides the throw: the status and a short line
// of it say what happened without dumping a document into an error message
// (C-32574 items 2 and 4).
//
// When signing in is the way through, the kernel also names where: the throw
// carries `signIn`, the login page already holding this page as its return
// address, so `catch (e) { if (e.signIn) location = e.signIn }` sends them
// and brings them back (T-32593). It carries the answer's `status` too, so a
// refusal the page never caught reaches the reporter as the no it was
// (report.js).
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
  e.status = r.status
  return e
}

// A read already on its way answers everyone who asks it meanwhile, as one
// request: the outbox's `me` and the page's own on load, a subscription's
// fill and the page's query of the same line. Each caller parses its own copy,
// so no two share an object to change. A write that lands ends the sharing:
// a read asked after it is its own, so it sees the write.
let door = (base) => {
  let flying = new Map()
  let send = async (path, init) => {
    let version = pageVersion()
    if (version != null) {
      let headers = new Headers(init?.headers)
      headers.set('x-yak-version', version)
      init = { ...init, headers }
    }
    let r = await fetch(new URL(path, base), init)
    return { r, body: await r.text() }
  }
  let sent = (path, init) => {
    if (init) return send(path, init).finally(() => flying.clear())
    let held = flying.get(path)
    if (!held) {
      held = send(path).finally(() =>
        flying.get(path) == held && flying.delete(path)
      )
      flying.set(path, held)
    }
    return held
  }
  return async (path, init) => answered(path, await sent(path, init))
}

let answered = (path, { r, body }) => {
  if (!r.ok) {
    let error = refused(r, body)
    // A timeout, overload or proxy HTML is not a deliberate store refusal.
    let explicit = false
    try {
      explicit = !!JSON.parse(body).error
    } catch { /* unknown response */ }
    if (
      path == 'apply' && explicit && r.status < 500 &&
      ![408, 425, 429].includes(r.status)
    ) {
      error.outcome = 'refused'
    }
    throw error
  }
  let receipt = body ? JSON.parse(body) : null
  if (
    path == 'apply' && (r.status == 202 || receipt?.pending ||
      receipt?.ok !== true || !receipt?.aliases ||
      typeof receipt.aliases != 'object' || Array.isArray(receipt.aliases) ||
      !Array.isArray(receipt?.bundles))
  ) {
    throw new Error(
      receipt?.message || 'Write is still unsaved; its outcome is unknown',
    )
  }
  return receipt
}

// The release the platform's tags in this page name (page-script.ts) is the
// page that is still running, even after the app's serving pointer has moved.
let pageVersion = () => {
  let value = globalThis.document?.querySelector(
    'script[data-yak-version]',
  )?.dataset.yakVersion
  return value != null && /^[0-9]+$/.test(value) ? value : null
}

// The address a store's doors hang off. Every app in a space shares one
// hostname, so the address a page names is a path — `store('/lending/api/')`,
// which the guide's own line — and a path is no `new URL` base by itself:
// the documented call threw `Invalid base URL` (C-32800 item 6). It is
// resolved against this origin, and a path that names the api directory
// without saying so keeps its meaning: the doors are under it, so the base
// ends in a slash or `query` would replace the last segment. A sandboxed
// app's page (installed.ts) has an opaque origin, which reads "null" and is no
// base either, so its own address stands in: the hostname is the same.
// A path as a URL carries it, each segment escaped.
let encodedPath = (path) =>
  String(path).split('/').map(encodeURIComponent).join('/')

let based = (base) => {
  if (base instanceof URL) return base
  let here = globalThis.location
  let at = new URL(base, here?.origin == 'null' ? here.href : here?.origin)
  if (!at.pathname.endsWith('/')) at.pathname += '/'
  return at
}

// The precondition a read-modify-write carries: the SHA-256 of a value as the
// page read it, which a bundle names under `$was` — per component, per
// property. The store refuses the whole batch if that property has moved since,
// so two tabs, two phones or an agent and a page cannot both spend one balance
// or claim one reward. `null` is "it held none", which guards a property that
// must still be empty. The hash is the store's own (@yaks/graph `token`), so a
// page and a tool guard the same value alike.
//
//     let [me] = await query(`id=${eid}&.player`)
//     await apply({
//       entity: { eid },
//       player: { gold: me.player.gold + 10, claimed: today },
//       $was: { player: { claimed: await was(me.player.claimed) } },
//     })
export let was = async (value) => {
  if (value == null) return null
  let bytes = new TextEncoder().encode(String(value))
  let sum = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...sum].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// SHA-256 over a File or Blob, read a few MiB at a time, so a file need not
// fit in memory to be named: WebCrypto hashes only what is whole in memory.
// FIPS 180-4, the same digest the platform keeps the bytes under.
let K = new Uint32Array([
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
])

// Each 64-byte block from `at` to `end` folded into the state `h`.
let blocks = (h, w, b, at, end) => {
  for (let i = at; i < end; i += 64) {
    for (let t = 0; t < 16; t++) {
      let j = i + t * 4
      w[t] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]
    }
    for (let t = 16; t < 64; t++) {
      let x = w[t - 15], y = w[t - 2]
      let s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      let s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^
        (y >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0
    }
    let [a, b1, c, d, e, f, g, k] = h
    for (let t = 0; t < 64; t++) {
      let S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7))
      let t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0
      let S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10))
      let t2 = (S0 + ((a & b1) ^ (a & c) ^ (b1 & c))) | 0
      k = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b1
      b1 = a
      a = (t1 + t2) | 0
    }
    h[0] += a
    h[1] += b1
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += k
  }
}

// A file is read a MiB at a time, a multiple of 64, so only the last read
// leaves part of a block over. Every part the door asks for is a whole number
// of MiB, so the state after each MiB is the state some part starts from.
let MIB = 1024 * 1024

let hex = (h) => [...h].map((v) => v.toString(16).padStart(8, '0')).join('')

// The file's SHA-256, and the hash state after each whole MiB of it, the
// first being the state before any bytes.
let hashed = async (blob) => {
  let h = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ])
  let w = new Uint32Array(64)
  let size = blob.size
  let states = [hex(h)]
  let rest = new Uint8Array(0)
  for (let at = 0; at < size; at += MIB) {
    let b = new Uint8Array(await blob.slice(at, at + MIB).arrayBuffer())
    let whole = b.length - (b.length % 64)
    blocks(h, w, b, 0, whole)
    rest = b.subarray(whole)
    if (b.length == MIB) states.push(hex(h))
  }
  // The tail: what was left, a 1 bit, zeros, and the length in bits as 64.
  let tail = new Uint8Array(rest.length < 56 ? 64 : 128)
  tail.set(rest)
  tail[rest.length] = 0x80
  let view = new DataView(tail.buffer)
  view.setUint32(tail.length - 8, Math.floor(size / 2 ** 29))
  view.setUint32(tail.length - 4, (size * 8) >>> 0)
  blocks(h, w, tail, 0, tail.length)
  return { sha: hex(h), states }
}

export let digest = async (blob) => (await hashed(blob)).sha

// A file at least this big goes up in parts, several at once, which from
// here on send faster than one request, and their fixed second or two of
// beginning and assembling is about a tenth of the upload (measured, T-124790).
// Anything smaller is one request.
let SPLIT = 32 * 1024 * 1024
let LANES = 4

// Whether what failed was the way there, not the answer: no connection (a
// phone asleep, a train in a tunnel), or a platform that is busy or down.
// Anything else is a refusal.
let busy = (e) =>
  e.status == null || e.status >= 500 || e.status == 408 || e.status == 429

// Sent again while the way there failed, which waits for the browser to say it
// is back online. A refusal is thrown at once. Each wait doubles, to fifteen
// seconds.
let again = async (clock, call, tries = 0) => {
  try {
    return await call()
  } catch (e) {
    if (!busy(e) || tries >= 7) throw e
    if (globalThis.navigator?.onLine === false) {
      await new Promise((on) => addEventListener('online', on, { once: true }))
    }
    await new Promise((on) =>
      clock.after(Math.min(1000 * 2 ** tries, 15000), on)
    )
    return again(clock, call, tries + 1)
  }
}

// `go` for every item, `LANES` at a time; the first failure stops the rest
// taking new items, and is thrown once those under way have ended.
let lanes = async (items, go) => {
  let next = 0
  let failed = null
  let lane = async () => {
    while (!failed && next < items.length) {
      try {
        await go(items[next++])
      } catch (e) {
        failed ??= e
      }
    }
  }
  await Promise.all(Array.from({ length: LANES }, lane))
  if (failed) throw failed
}

export let store = (base, { clock = system } = {}) => {
  base = based(base)
  let rawAsk = door(base)
  let vocabulary
  let readWire = async (value, payload) => {
    // No extra request for a page whose answers contain no byte tags. Only
    // the vocabulary, never a global JSON reviver, gives the tag meaning.
    if (!payload && !JSON.stringify(value).includes('"$bytes"')) return value
    vocabulary ??= rawAsk('vocab.json').then((docs) => {
      let defs = {}
      for (let doc of docs) {
        for (let [name, def] of Object.entries(doc.$defs ?? {})) {
          defs[name] = {
            ...defs[name],
            ...def,
            properties: { ...defs[name]?.properties, ...def.properties },
          }
        }
      }
      return { def: (name) => defs[name] }
    }).catch((error) => {
      vocabulary = undefined
      throw error
    })
    return decode(await vocabulary, value, payload)
  }
  let ask = async (path, init) => readWire(await rawAsk(path, init))
  // One bundle or many, in; `{ok, aliases, bundles}` back, where `aliases`
  // maps each `$alias` to the eid it minted and `bundles` is the batch as
  // applied.
  // Identity is part of the disk scope. A failed identity lookup must never
  // replay another person's writes under an anonymous (or replacement) cookie.
  let queue, starting, closed = false
  let listeners = new Set()
  let notify = () => {
    for (let fn of listeners) fn()
  }
  let boot = () =>
    starting ??= ask('me').then(async ({ person }) => {
      if (closed) throw new Error('Write outbox is closed')
      queue = durableOutbox({
        scope: `${base}:${person ?? 'anonymous'}`,
        timer: (fn, ms) => clock.after(ms, fn),
        cancelTimer: (cancel) => cancel(),
        send: async (key, payload) => {
          let current = await ask('me')
          // Closing while identity is in flight must not start another write
          // after the page (or its transport) has gone away.
          if (closed) throw new Error('Write outbox is closed')
          if (current.person !== person) {
            throw new Error(
              'Write is unsaved: the signed-in person has changed',
            )
          }
          return ask('apply', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': key,
            },
            body: stringify(payload),
          })
        },
      })
      queue.onPending(notify)
      await queue.ready
      notify()
    })
  let outbox = {
    get ready() {
      return boot()
    },
    pending: () => queue?.pending() ?? [],
    onPending: (fn) => {
      listeners.add(fn)
      void boot().catch(() => {})
      return () => listeners.delete(fn)
    },
    retry: async (key) => {
      await boot()
      return queue.retry(key)
    },
    forget: async (key) => {
      await boot()
      return queue.forget(key)
    },
    close: () => {
      closed = true
      queue?.close()
      listeners.clear()
    },
  }
  // Browser stores recover on opening, even when the page has no new write.
  // Non-browser imports have no disk to recover and need no identity request.
  if (globalThis.indexedDB) void boot().catch(() => {})
  let apply = async (bundles) => {
    // Snapshot intent before the asynchronous identity lookup.
    let payload = structuredClone({
      entities: Array.isArray(bundles) ? bundles : [bundles],
    })
    await boot()
    return queue.submit(payload)
  }
  // The filter line, the grammar the boards speak: '.doc.title~=cake',
  // '.opaque.format=recipe', 'id=<eid>', 'limit='. Oldest first, in the order
  // the rows were written; a windowed read is the newest page of that same
  // order.
  //
  // A row carries only the components the filter names, so name the ones the
  // page will draw: '.recipe' answers recipes with no titles, and
  // '.recipe&?doc' answers both — '&' joins filters and '?' asks for a
  // component without filtering on it. A dotted word addresses that
  // component's own property ('.recipe.minutes<=30'), never a second
  // component; '&?doc' is the way to ask for one of those.
  let query = (filter = '') => ask(`query?${filter}`)
  // Full-text over the docs, ranked. A word names no component to leave out,
  // the way `id=` does not, so a search with no filter answers whole entities
  // — the app's own components included, which is what a page drawing cards
  // from a search needs. Pass a filter and the ordinary rule is back:
  // `search('lemon', '.recipe&?doc')` is recipes with their titles.
  let search = (text, filter = '') =>
    query(`${encodeURIComponent(text)}${filter ? `&${filter}` : ''}`)

  // Who is looking, before anything is asked of them: `{person, name, role,
  // reads, writes, signIn, invited}` — `person` null when they are signed
  // out, `name` what to call them, `writes` whether this app takes a write
  // from them, `signIn` where a signed-out visitor signs in, and `invited`
  // whether an invitation waits in their email to accept. Call it on load and
  // the page knows whether to show a sign-in link, the invitation or a name
  // field, instead of finding out from a refusal after someone has typed
  // (C-32675 items 5 and 6).
  let me = () => ask('me')

  // Bytes, in: a File off an `<input type=file>`, a Blob a canvas made. The
  // door answers `{eid, url, mime, bytes}` — the eid to point a row at
  // (`{photo: {caption, blob: eid}}`) and the url to put in an `<img src>`.
  // Content-addressed, so the same file twice is one upload and one row, and
  // a page may re-send rather than remember. Which files are taken is the
  // app's `vocab.json` to say (`"blob"`); downscale a photo on the page before
  // you send it. Deleting the row at `eid` deletes the upload and its bytes.
  //
  // A file of `SPLIT` bytes or more goes up in parts: the door says the part
  // size and the parts it still needs, those go `LANES` at a time, and asking
  // again finishes it. A connection that drops is waited out and the part
  // sent again; an upload begun in a tab that closed carries on from the
  // parts that arrived, when the same file is uploaded again.
  let upload = async (file, opts = {}) => {
    let name = opts.name ?? file.name ?? ''
    let mime = file.type || 'application/octet-stream'
    if (file.size < SPLIT) {
      return again(clock, () =>
        ask('blob', {
          method: 'POST',
          headers: {
            'content-type': mime,
            // A header is ASCII and a file's name is not, so the name is
            // percent-encoded here and decoded by the door.
            ...(name ? { 'x-yak-name': encodeURIComponent(name) } : {}),
          },
          body: file,
        }))
    }
    let { sha, states } = await hashed(file)
    let at = `blob/${sha}`
    let stand = () =>
      again(clock, () =>
        ask(at, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bytes: file.size, name, mime }),
        }))
    // An upload the platform let go of (409) is begun again; a few rounds
    // with nothing finished is a fault, not a slow line.
    for (let round = 0; round < 4; round++) {
      let { part, need, ...done } = await stand()
      if (!need) return done
      try {
        await lanes(need, (n) =>
          again(clock, () =>
            ask(`${at}/${n}`, {
              method: 'PUT',
              // Where the hash stood before this part, so the door hashes it
              // on from there as it passes.
              headers: { 'x-yak-state': states[(n - 1) * part / MIB] },
              body: file.slice((n - 1) * part, n * part),
            })))
      } catch (e) {
        if (e.status != 409) throw e
      }
    }
    throw new Error(`the upload of ${name || 'a file'} did not finish`)
  }

  // A file on the public web, at a path of this app's address: from then on
  // that address answers it to anyone, before the app runs and whatever its
  // access (`PUT ./api/public/<path>`). With no path it goes to a new UUID
  // path, a link only the people given it know (`POST ./api/public`). `file`
  // is a Blob or a File, served as its own type, so a page's HTML goes in a
  // Blob of `text/html`. Answers `{path, url, sha, mime, size}`. Only the
  // app's own people who write it publish; publishing the same path again
  // replaces the file there.
  let publish = (file, path) =>
    ask(path ? `public/${encodedPath(path)}` : 'public', {
      method: path ? 'PUT' : 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
  // Take a published file off the web again: its address goes back to the app.
  let unpublish = (path) =>
    ask(`public/${encodedPath(path)}`, { method: 'DELETE' })
  // Every file this app published, by path.
  let publicFiles = () => ask('public')

  // The live half: one socket onto this store, opened on the first
  // subscription and shared by all of them, reconnecting on its own.
  let subs = new Map()
  let sock = null
  let tries = 0
  let n = 0
  let open = () => {
    if (sock) return sock
    let url = new URL('ws', base)
    let version = pageVersion()
    if (version != null) url.searchParams.set('version', version)
    url.protocol = url.protocol == 'https:' ? 'wss:' : 'ws:'
    let s = sock = new WebSocket(url)
    // Every subscription is (re)declared on open, so a reconnect needs no
    // catch-up: the store answers each declaration with the whole set, so the
    // rows it replaces are dropped first.
    s.onopen = () => {
      tries = 0
      for (let [name, sub] of subs) {
        sub.rows.clear()
        sub.riders = []
        s.send(JSON.stringify({ subscribe: sub.q, id: name }))
      }
    }
    let receiving
    let land = (f) => {
      let sub = subs.get(f.id)
      if (!sub) return
      sub.heard = true
      if (f.refused) {
        let e = new Error(f.refused.message ?? f.refused.error)
        sub.first.reject(e)
        throw e
      }
      fold(sub, f)
      let now = rows(sub)
      sub.first.resolve(now)
      sub.cb(now)
    }
    s.onmessage = (e) => {
      let frame = typeof e.data == 'string' ? JSON.parse(e.data) : undefined
      if (!receiving && frame && !e.data.includes('"$bytes"')) {
        return land(frame)
      }
      let next = (receiving ?? Promise.resolve()).then(async () => {
        let data = e.data instanceof Blob ? await e.data.arrayBuffer() : e.data
        let packed = data instanceof ArrayBuffer ? unpack(data) : undefined
        land(
          await readWire(
            packed ? packed.value : frame ?? JSON.parse(data),
            packed?.payload,
          ),
        )
      })
      receiving = next.catch((error) => {
        // Report the bad frame without poisoning the next frame's queue.
        queueMicrotask(() => {
          throw error
        })
      }).finally(() => {
        if (receiving === held) receiving = undefined
      })
      let held = receiving
    }
    s.onclose = () => {
      sock = null
      let again = () => subs.size && open()
      if (subs.size) clock.after(Math.min(1000 * 2 ** tries++, 15000), again)
    }
    return s
  }
  let tell = (frame) => {
    let s = open()
    if (s.readyState == 1) s.send(stringify(frame))
  }
  // The filter's matches now, and again on every change — a write from
  // another device, another tab, or an agent. `cb` is handed the same rows
  // `query()` answers with — the components the filter names and no others,
  // so '.recipe&?doc' where the page draws titles — and a page swaps one
  // for the other and nothing else changes; the returned function ends the
  // subscription.
  //
  // Its `ready` is the first rows `cb` is handed, for a page that needs them
  // before it goes on (`let rows = await subscribe(f, draw).ready`), so that
  // page subscribes rather than querying first and asking the store twice. It
  // rejects with the store's refusal of the filter; a socket that will not
  // open only keeps it waiting for the rows. A rejection nobody awaits is the
  // socket's to report, as it always was, so it is not reported twice.
  let subscribe = (filter, cb) => {
    let name = `${++n}:${filter}`
    let q = asked(filter)
    let first
    let ready = new Promise((resolve, reject) => first = { resolve, reject })
    ready.catch(() => {})
    let sub = { q, rows: new Map(), riders: [], cb, heard: false, first }
    subs.set(name, sub)
    tell({ subscribe: q, id: name })
    // A socket that is not open yet is a handshake away — a connection of
    // its own and an upgrade — while a query rides the connection the page
    // already has. So the first rows come from a query, unless the socket
    // answers first; its answer is the whole set and replaces them. A query
    // whose way there failed says nothing here: the socket keeps trying.
    if (sock?.readyState != 1) {
      let mine = () => subs.get(name) == sub && !sub.heard
      query(filter).then((rows) => {
        if (!mine()) return
        first.resolve(rows)
        cb(rows)
      }, (e) => mine() && !busy(e) && first.reject(e))
    }
    let stop = () => {
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
    stop.ready = ready
    return stop
  }
  return {
    apply,
    outbox,
    me,
    query,
    search,
    subscribe,
    upload,
    publish,
    unpublish,
    publicFiles,
    drafts: (opts) =>
      browserDrafts({ apply, me, subscribe }, String(base), opts),
  }
}

// One subscription frame folded into its rows. A frame carries whole rows —
// the rows `query()` gives, once they are `named` — so folding is just keeping
// them: a row replaces the one it names, and one that is `gone` (it died, or it
// stopped matching) leaves. A `.fields` projection whose paths cross a
// reference also brings its riders, the entities those paths reach, every one
// of them in every frame, so they are kept as they come.
let fold = (sub, f) => {
  for (let row of f.bundles ?? []) sub.rows.set(row.entity.eid, named(row, f))
  for (let eid of f.gone ?? []) sub.rows.delete(eid)
  if (f.peers) sub.riders = f.peers.map((row) => named(row, f))
}

// A frame's row as `query()` answers it. The socket keeps each row in the
// store's own words, where a reference to a person is their eid, and says
// beside the rows what the store calls them: `names` by eid, and `refs`, the
// properties that reference (`created.by`). The query door paints the same
// rule (listing.ts `named`), so `created.by` is `{eid, name}` on both.
let named = (row, { refs = [], names = {} }) => {
  if (!refs.length) return row
  let name = (held, comp) =>
    Object.fromEntries(
      Object.entries(held).map(([prop, v]) =>
        typeof v == 'string' && Object.hasOwn(names, v) &&
          refs.includes(`${comp}.${prop}`)
          ? [prop, { eid: v, name: names[v] }]
          : [prop, v]
      ),
    )
  return Object.fromEntries(
    Object.entries(row).map(([comp, held]) => [
      comp,
      held && typeof held == 'object' && !Array.isArray(held)
        ? name(held, comp)
        : held,
    ]),
  )
}

// A page's filter as the store writes it. A fetch goes through the app's door,
// which does this on the way (workers/yak/wire.ts `lined`); a socket goes
// straight to the store, so a subscription is translated here, and
// `query(f)` and `subscribe(f)` ask one question. Three riders the page
// writes bare are dotted words there (`id=` is an address, so it is `.entity.eid=`).
// The platform's own rows are left out of either question where it is
// answered (listing.ts `asking`).
let RIDERS = { id: '.entity.eid', limit: '.limit', after: '.after' }
let OPERATOR = /^([A-Za-z_.\-[\]][\w.\-[\]]*)(!=|~=|<=|>=|<|>|=)/

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

// The line without the `?` a query string opens with. A `?` before a word is
// the grammar's own (`?doc` asks for a component), so it stays.
let bare = (filter) => filter.replace(/^\?(?![A-Za-z_])/, '').replace(/^&+/, '')

let asked = (filter = '') =>
  bare(filter).split('&').filter(Boolean)
    .map((seg) => {
      let m = OPERATOR.exec(seg)
      if (!m) return glued(plain(seg), true)
      let v = glued(plain(seg.slice(m[0].length)))
      return `${RIDERS[m[1]] ?? m[1]}${m[2]}${v}`
    }).join('&')

// Oldest first — `query()`'s own order, which is the order the fill arrived
// in and the order a live row is added at, so the map already holds it. The
// riders follow, as `query()` lists them: one the query also selects is one
// row, carrying what both said of it.
let rows = ({ rows, riders }) => {
  let out = new Map(rows)
  for (let r of riders) {
    let held = out.get(r.entity.eid) ?? {}
    let row = { ...held, ...r }
    for (let k in held) {
      let both = [held[k], r[k]].every((v) => v && typeof v == 'object')
      if (both) row[k] = { ...held[k], ...r[k] }
    }
    out.set(r.entity.eid, row)
  }
  return [...out.values()]
}

export let {
  apply,
  drafts,
  me,
  outbox,
  publicFiles,
  publish,
  query,
  search,
  subscribe,
  unpublish,
  upload,
} = store(
  new URL('.', import.meta.url),
)
