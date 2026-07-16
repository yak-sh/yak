// The whole backend, as a `deno serve` module: static files out of src/, TS/TSX
// translated to JS per-request (sucrase strips types + compiles JSX — no
// bundling, no type-checking; `deno task check` is the type gate), bare
// imports resolved by the import map in index.html to the vendored ESM in
// src/vendor/, the sync websocket, and a src/ watcher that tells clients to
// reload. State lives in the db, so a reload IS hot: camera, cards, and
// views all come back where they were.
import { transform } from 'sucrase'
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

export default {
  fetch(req) {
    let path = new URL(req.url).pathname
    if (path == '/ws') return ws(req)
    if (path == '/snapshot') return Response.json(snapshot(db))
    return file(src.slice(0, -1), path == '/' ? '/index.html' : path)
  },
} satisfies Deno.ServeDefaultExport

// Watch src/ and tell every client to reload (debounced — editors fire
// several events per save). The server itself restarts via --watch, whose
// scope is its own module graph; this covers the client-side files it
// merely serves.
let watch = async () => {
  let timer: ReturnType<typeof setTimeout> | null = null
  for await (let _ of Deno.watchFs(src)) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      for (let c of clients) {
        if (c.readyState == WebSocket.OPEN) c.send(JSON.stringify('reload'))
      }
    }, 50)
  }
}
watch()
