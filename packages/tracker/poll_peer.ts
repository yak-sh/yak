// A loopback remote for poll thread tests. Its HTTP loop cannot be blocked by
// the test's host loop. No configured tracker or credential is read.
let calls: { path: string; body: unknown; began: number; ended: number }[] = []
let watched: Int32Array | undefined
let server = Deno.serve(
  { hostname: '127.0.0.1', port: 0, onListen: () => {} },
  async (r) => {
    let path = new URL(r.url).pathname
    let body = r.method == 'POST' ? await r.json() : undefined
    let began = Date.now()
    calls.push({ path, body, began, ended: Date.now() })
    if (watched) {
      Atomics.store(watched, 0, 1)
      Atomics.notify(watched, 0)
    }
    return path.endsWith('/bugs')
      ? Response.json([{ entity: { eid: 'bug' }, bug: { fault: 'one' } }])
      : Response.json({ ok: true })
  },
)
self.postMessage({ url: `http://127.0.0.1:${server.addr.port}` })
self.onmessage = ({ data }) => {
  if (data.watch) {
    watched = new Int32Array(data.watch)
    self.postMessage('watching')
  } else self.postMessage(calls)
}
