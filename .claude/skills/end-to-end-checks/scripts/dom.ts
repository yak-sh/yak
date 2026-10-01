#!/usr/bin/env -S deno run -A
/**
 * Open a page in a Chrome started with --remote-debugging-port and print what
 * an expression evaluates to there, as JSON. The page's DOM is the truth this
 * app is checked against; headless screenshots of it don't render.
 *
 *   deno run -A dom.ts <cdp-port> <url> '<expression>' [--wait '<expression>']
 *
 * --wait polls its expression (default: document.readyState == 'complete')
 * until it is truthy, up to 15 s, before the main one runs. The expression may
 * return a promise. The tab is closed afterwards.
 *
 * @module
 */

let [port, url, expr, ...rest] = Deno.args
if (!port || !url || !expr) {
  console.error(
    "usage: dom.ts <cdp-port> <url> '<expression>' [--wait '<expression>']",
  )
  Deno.exit(2)
}
let i = rest.indexOf('--wait')
let wait = i >= 0 ? rest[i + 1] : "document.readyState == 'complete'"

let base = `http://127.0.0.1:${port}`
let tab =
  await (await fetch(`${base}/json/new?${encodeURI(url)}`, { method: 'PUT' }))
    .json()
let ws = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((ok, no) => (ws.onopen = ok, ws.onerror = no))

let n = 0
let pending = new Map<number, (v: unknown) => void>()
ws.onmessage = (m) => {
  let msg = JSON.parse(m.data)
  pending.get(msg.id)?.(msg)
  pending.delete(msg.id)
}
let send = (method: string, params: unknown) =>
  new Promise<any>((ok) => {
    let id = ++n
    pending.set(id, ok)
    ws.send(JSON.stringify({ id, method, params }))
  })
let evaluate = async (expression: string) => {
  let r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? 'threw')
  }
  return r.result?.result?.value
}

let until = Date.now() + 15_000
while (!(await evaluate(wait).catch(() => false))) {
  if (Date.now() > until) {
    console.error(`timed out waiting for: ${wait}`)
    break
  }
  await new Promise((r) => setTimeout(r, 100))
}
console.log(JSON.stringify(await evaluate(expr), null, 2))
ws.close()
await fetch(`${base}/json/close/${tab.id}`)
