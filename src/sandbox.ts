/// <reference lib="deno.worker" />
// Code mode's sandbox: a permission-LESS worker (deno permissions: 'none' —
// no fs, no net, no env; proven by probe) that hosts agent-written JS. Its
// only capability is the graph, over postMessage: the host sends an eager
// snapshot in, the script queues changes out, and the host decides whether
// the batch applies (dry runs return it unapplied). The SDK mirrors the
// websocket protocol shapes — same Change, same rows() — just over
// postMessage instead of a socket.
//
// `graph.rows` is the eager snapshot, which omits the lazy entry partition
// (session logs). To reach it the SDK asks the HOST: `graph.query(filters)`
// and `graph.entries(session)` round-trip a request out and await the host's
// authoritative answer (io.query — the whole graph, entries included). The
// worker stays permissionless; the graph is still its only capability, now
// including the partition on demand.
import { type Change } from './types.ts'
import { type Row, rows } from './client.ts'

// A pending host round-trip, keyed by request id — resolved when its `res`
// reply lands on the single onmessage below.
let seq = 0
let pending = new Map<number, (r: { rows?: Row[]; error?: string }) => void>()

// Ask the host to answer a filter line against the authoritative graph.
let ask = (
  q: string,
  kind?: string,
  opts?: { after?: number; limit?: number },
) =>
  new Promise<Row[]>((resolve, reject) => {
    let req = ++seq
    pending.set(req, (r) =>
      r.error ? reject(new Error(r.error)) : resolve(r.rows ?? []))
    self.postMessage({ ask: { req, q, kind, opts } })
  })

self.onmessage = async (e: MessageEvent) => {
  let d = e.data
  // A reply to a graph.query/entries round-trip — hand it to its waiter.
  if (d && d.res != null) {
    let cb = pending.get(d.res)
    if (cb) {
      pending.delete(d.res)
      cb(d)
    }
    return
  }
  // The one script run.
  let { js, snapshot } = d
  let batch: Change[] = []
  let logs: string[] = []
  let apply = (...cs: (Change | Change[])[]) => batch.push(...cs.flat())
  let log = (...args: unknown[]) =>
    logs.push(
      args.map((a) => typeof a == 'string' ? a : JSON.stringify(a)).join(' '),
    )
  // Filters as an array or one line; both reach the host as the `&`-joined
  // grammar io.query speaks.
  let query = (
    filters: string | string[],
    kind?: string,
    opts?: { after?: number; limit?: number },
  ) => ask(Array.isArray(filters) ? filters.join('&') : filters, kind, opts)
  // One Session's ordered log partition — the named-scope shorthand for query.
  let entries = (session: string, opts?: { after?: number; limit?: number }) =>
    ask(`.entry.session=${session}`, undefined, opts)
  try {
    // The script body runs async with the SDK in scope; its return value
    // travels back verbatim (JSON-cloneable values only).
    let fn = new Function(
      'graph',
      'apply',
      'log',
      `return (async () => { ${js} })()`,
    )
    let result = await fn(
      { ...snapshot, rows: rows(snapshot), query, entries },
      apply,
      log,
    )
    self.postMessage({ ok: true, result: result ?? null, batch, logs })
  } catch (err) {
    self.postMessage({ ok: false, error: String(err), batch, logs })
  }
}
