/// <reference lib="deno.worker" />
// Code mode's sandbox: a permission-LESS worker (deno permissions: 'none' —
// no fs, no net, no env; proven by probe) that hosts agent-written JS. Its
// only capability is the graph, over postMessage: the host sends a
// snapshot in, the script queues changes out, and the host decides whether
// the batch applies (dry runs return it unapplied). The SDK mirrors the
// websocket protocol shapes — same Change, same rows() — just over
// postMessage instead of a socket.
import { type Change } from './types.ts'
import { rows } from './client.ts'

self.onmessage = async (e: MessageEvent) => {
  let { js, snapshot } = e.data
  let batch: Change[] = []
  let logs: string[] = []
  let apply = (...cs: (Change | Change[])[]) => batch.push(...cs.flat())
  let log = (...args: unknown[]) =>
    logs.push(
      args.map((a) => typeof a == 'string' ? a : JSON.stringify(a)).join(' '),
    )
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
      { ...snapshot, rows: rows(snapshot) },
      apply,
      log,
    )
    self.postMessage({ ok: true, result: result ?? null, batch, logs })
  } catch (err) {
    self.postMessage({ ok: false, error: String(err), batch, logs })
  }
}
