// The whole backend in one Deno.serve: static files out of src/, TS/TSX
// translated to JS per-request (sucrase strips types + compiles JSX — no
// bundling, no type-checking; `deno task check` is the type gate), bare
// imports resolved by the import map in index.html to the vendored ESM in
// src/vendor/, the sync websocket, and a src/ watcher that tells clients to
// reload. State lives in the db, so a reload IS hot: camera, cards, and
// views all come back where they were.
import { transform } from 'sucrase'
import { parseHTML } from 'linkedom'
import { type Change } from './types.ts'
import { apply, db, snapshot } from './db.ts'

let src = new URL('.', import.meta.url).pathname

let mime: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  png: 'image/png',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}

// Serve a file from under a root, refusing path escapes. TS/TSX comes back
// as JS, translated on the fly and cached by mtime.
let ts = new Map<string, { mtime: number; js: string }>()
let file = async (root: string, path: string) => {
  let full = root + path
  if (full.includes('..')) return new Response('no', { status: 400 })
  let ext = path.split('.').pop() ?? ''
  try {
    if (ext == 'ts' || ext == 'tsx') {
      let mtime = (await Deno.stat(full)).mtime?.getTime() ?? 0
      let hit = ts.get(full)
      if (!hit || hit.mtime != mtime) {
        hit = {
          mtime,
          js: transform(await Deno.readTextFile(full), {
            transforms: ['typescript', 'jsx'],
            jsxRuntime: 'automatic',
            jsxImportSource: 'preact',
            production: true,
            filePath: path,
          }).code,
        }
        ts.set(full, hit)
      }
      return new Response(hit.js, {
        headers: { 'content-type': mime.js, 'cache-control': 'no-cache' },
      })
    }
    return new Response(await Deno.readFile(full), {
      headers: {
        'content-type': mime[ext] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      },
    })
  } catch {
    return new Response('not found', { status: 404 })
  }
}

// The sync channel: clients send flat change batches ([{eid, name, comp}]),
// the server applies them and rebroadcasts to every other client. Non-array
// frames are control messages ('reload', from the watcher).
let clients = new Set<WebSocket>()
let cast = (changes: Change[], except?: WebSocket) => {
  let msg = JSON.stringify(changes)
  for (let c of clients) {
    if (c != except && c.readyState == WebSocket.OPEN) c.send(msg)
  }
}
let ws = (req: Request) => {
  let { socket, response } = Deno.upgradeWebSocket(req)
  socket.onopen = () => clients.add(socket)
  socket.onclose = () => clients.delete(socket)
  socket.onmessage = (m) => {
    try {
      apply(db, JSON.parse(String(m.data)) as Change[])
    } catch (e) {
      console.error('sync: bad batch dropped —', e)
      return
    }
    for (let c of clients) {
      if (c != socket && c.readyState == WebSocket.OPEN) c.send(m.data)
    }
  }
  return response
}

// Freeze a pasted URL: monolith fetches the page and inlines every asset
// into ONE self-contained, script-free, network-isolated HTML file. It
// lands on disk (an inlined page is megabytes — the db and every snapshot
// stay lean), the entity's web comp gets frozen_at (server-stamped; the
// wire allowlist doesn't carry it, so clients can't fake an archive), the
// page <title> becomes the entity's doc, and everyone hears over the ws.
let frozen = `${Deno.env.get('HOME')}/.tasks/frozen`

// Self-containment is enforced HERE, not at render: monolith inlines what
// it can reach, but anything it couldn't (404'd assets, preload hints,
// srcset variants, favicons) keeps its URL and would fetch when shown.
// The archive must render from its own bytes alone, so every remaining
// external reference is REMOVED: leftover scripts/frames/link tags, every
// url-bearing attribute that isn't data:, inline handlers, and url() in
// CSS. Returns the scrubbed page and its title (for the entity's doc).
let URLISH = [
  'src',
  'href',
  'srcset',
  'poster',
  'action',
  'formaction',
  'ping',
  'background',
  'data',
  'xlink:href',
]
let cssScrub = (css: string) =>
  css.replace(/url\(\s*(?!['"]?\s*data:)[^)]*\)/gi, 'url()')
let scrub = (raw: string) => {
  let { document } = parseHTML(raw)
  let all = (sel: string) => [...document.querySelectorAll(sel)]
  for (let el of all('script, base, iframe, frame, embed, object')) {
    el.remove()
  }
  for (let el of all('link')) {
    if (!(el.getAttribute('href') ?? '').startsWith('data:')) el.remove()
  }
  for (let el of all('meta[http-equiv]')) {
    if (/refresh/i.test(el.getAttribute('http-equiv') ?? '')) el.remove()
  }
  for (let el of all('*')) {
    for (let { name } of [...el.attributes]) {
      if (name.startsWith('on')) el.removeAttribute(name)
    }
    for (let a of URLISH) {
      let v = el.getAttribute(a)
      if (v && !/^\s*(data:|#|about:)/i.test(v)) el.removeAttribute(a)
    }
    let style = el.getAttribute('style')
    if (style?.includes('url(')) el.setAttribute('style', cssScrub(style))
  }
  for (let el of all('style')) el.textContent = cssScrub(el.textContent ?? '')
  return {
    html: document.toString(),
    title: document.querySelector('title')?.textContent?.trim(),
  }
}

let freeze = async (eid: string) => {
  let row = db.prepare('select url from web where eid = ?').get(eid) as
    | { url: string }
    | undefined
  if (!row) return new Response('no such web entity', { status: 404 })
  Deno.mkdirSync(frozen, { recursive: true })
  let out = `${frozen}/${eid}.html`
  let cmd = await new Deno.Command('monolith', {
    args: ['-j', '-f', '-I', '-q', '-t', '30', '-o', out, row.url],
  }).output()
  if (!cmd.success) {
    console.warn(
      'freeze failed:',
      row.url,
      new TextDecoder().decode(cmd.stderr),
    )
    return new Response('freeze failed', { status: 502 })
  }
  let { html, title } = scrub(await Deno.readTextFile(out))
  await Deno.writeTextFile(out, html)
  let changes: Change[] = [
    { eid, name: 'web', comp: { frozen_at: new Date().toISOString() } },
  ]
  db.prepare('update web set frozen_at = ? where eid = ?')
    .run(changes[0].comp!.frozen_at as string, eid)
  let hasDoc = db.prepare('select 1 from doc where eid = ?').get(eid)
  if (title && !hasDoc) {
    db.prepare('insert into doc (eid, title) values (?, ?)').run(eid, title)
    changes.push({ eid, name: 'doc', comp: { title } })
  }
  cast(changes)
  return Response.json(changes)
}

// Serve an archive. eid is validated to a bare uuid — no path escapes.
// The CSP mirrors the iframe's sandbox but holds in EVERY context (an
// archive opened directly in a tab has no iframe to sandbox it): no
// scripts, no network fetches — the freeze stays inert and offline.
let serveFrozen = async (eid: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(eid)) return new Response('no', { status: 400 })
  try {
    return new Response(await Deno.readFile(`${frozen}/${eid}.html`), {
      headers: {
        'content-type': mime.html,
        'content-security-policy':
          "sandbox allow-same-origin; script-src 'none'; connect-src 'none'",
      },
    })
  } catch {
    return new Response('not frozen', { status: 404 })
  }
}

// Explicit Deno.serve, not a `deno serve` default export: --watch restarts
// only complete gracefully once the old isolate drains, which a live
// listener + websockets never guarantee — reusePort lets the new isolate
// bind alongside the dying one, and only the options object can carry it.
Deno.serve(
  { port: Number(Deno.env.get('PORT') ?? 5173), reusePort: true },
  (req) => {
    let url = new URL(req.url)
    let path = url.pathname
    if (path == '/ws') return ws(req)
    if (path == '/snapshot') return Response.json(snapshot(db))
    if (path == '/freeze') return freeze(url.searchParams.get('eid') ?? '')
    if (path.startsWith('/frozen/')) {
      return serveFrozen(path.slice(8).replace(/\.html$/, ''))
    }
    return file(src.slice(0, -1), path == '/' ? '/index.html' : path)
  },
)

// Watch src/ and tell every client to reload (debounced — editors fire
// several events per save). The server itself restarts via --watch, whose
// scope is its own module graph — but a graceful restart only completes
// once THIS isolate's event loop drains, and open websockets hold it
// forever (the new isolate then dies on AddrInUse). So when a server-graph
// file changes, close every socket and stop watching: the isolate settles,
// the port frees, the restart binds. Clients reload-poll their way back.
let graph = ['server.ts', 'db.ts', 'types.ts']
let watch = async () => {
  let timer: ReturnType<typeof setTimeout> | null = null
  for await (let e of Deno.watchFs(src)) {
    if (e.paths.some((p) => graph.some((g) => p.endsWith(`/${g}`)))) {
      for (let c of clients) c.close()
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      for (let c of clients) {
        if (c.readyState == WebSocket.OPEN) c.send(JSON.stringify('reload'))
      }
    }, 50)
  }
}
watch()
