#!/usr/bin/env -S deno run -A
// Web-perf probe: drive the real app in headless Chrome over CDP and measure
// what a human feels — load-to-interactive and the latency of the hot
// interactions (navigate to a busy board, open a card, type in the palette).
// Doubles as the perf-ratchet's web half: `--json` emits machine-readable
// timings a baseline gate can compare. It launches its own Chrome and reaps it.
//
// Usage: webperf.ts <base-url> [--profile] [--json]
//   --profile  capture a CPU profile during the run and print the hottest self-time frames
//   --json     emit only the timings object as JSON (for the gate)
//
// NEVER point --profile-driving runs at the live graph: it navigates and types.
// Give it a probe server URL.

let base = Deno.args[0] ?? 'http://localhost:5199'
let wantProfile = Deno.args.includes('--profile')
let asJson = Deno.args.includes('--json')

let log = (...a: unknown[]) => {
  if (!asJson) console.log(...a)
}

// --- launch chrome ---------------------------------------------------------
let port = 9200 + Math.floor(Date.now() % 700)
// Chrome's singleton socket path lives under user-data-dir and must fit the
// ~108-char unix socket limit — keep the dir short (a deep TMPDIR crashes it).
let dir = await Deno.makeTempDir({ dir: '/tmp', prefix: 'wp' })
let chrome = new Deno.Command('google-chrome', {
  args: [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    // Chrome 130+ rejects the CDP websocket without an explicit origin allow.
    '--remote-allow-origins=*',
    'about:blank',
  ],
  env: { TMPDIR: dir },
  stdout: 'null',
  stderr: 'null',
}).spawn()

let cleanup = async () => {
  try {
    chrome.kill('SIGTERM')
  } catch { /* already gone */ }
  try {
    await chrome.status
  } catch { /* */ }
  // Chrome's children (zygote, gpu, network, crashpad) outlive the parent by a
  // moment and keep writing into the profile, so a single remove races them and
  // loses — silently, because the only symptom is /tmp slowly filling with
  // wp* dirs (74 of them by the time anyone looked). Retry briefly instead.
  for (let i = 0; i < 20; i++) {
    try {
      await Deno.remove(dir, { recursive: true })
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

// --- CDP plumbing ----------------------------------------------------------
// Chrome 130+ serves /json/new only over PUT; the rest are GET.
let httpJson = async (path: string, method = 'GET') => {
  for (let i = 0; i < 80; i++) {
    try {
      let r = await fetch(`http://localhost:${port}${path}`, { method })
      return await r.json()
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('chrome CDP never came up')
}

// Open a fresh tab targeting the app, connect to its ws.
let tab = await httpJson(`/json/new?${encodeURIComponent(base + '/')}`, 'PUT')
let ws = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = () => res(null)
  ws.onerror = (e) => rej(e)
})

let id = 0
let waiters = new Map<number, (v: unknown) => void>()
let events: { method: string; params: Record<string, unknown> }[] = []
ws.onmessage = (m) => {
  let msg = JSON.parse(m.data)
  if (msg.id != null) waiters.get(msg.id)?.(msg.result ?? msg.error)
  else events.push(msg)
}
let send = (method: string, params: Record<string, unknown> = {}) => {
  let mid = ++id
  return new Promise<Record<string, unknown>>((res) => {
    waiters.set(mid, (v) => res(v as Record<string, unknown>))
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}

// Evaluate an expression in the page, awaiting a promise if it returns one.
let evalIn = async (expr: string) => {
  let r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  }) as { result?: { value?: unknown } }
  return r.result?.value
}

// Poll a boolean expression until true or timeout; return ms waited, or -1 on
// timeout (a timeout is data — a step too slow to finish is the regression).
let waitFor = async (expr: string, budgetMs = 15000) => {
  let t0 = performance.now()
  while (performance.now() - t0 < budgetMs) {
    if (await evalIn(expr)) return performance.now() - t0
    await new Promise((r) => setTimeout(r, 16))
  }
  return -1
}

// --- the measurement -------------------------------------------------------
let timings: Record<string, number> = {}
try {
  await send('Page.enable')
  await send('Runtime.enable')
  if (wantProfile) {
    await send('Profiler.enable')
    await send('Profiler.setSamplingInterval', { interval: 100 })
    await send('Profiler.start')
  }

  let ready = `!!document.querySelector('.Card, .Dot, .Id, main a[href^="/"]')`

  // (1) load-to-interactive: navigate to root, wait until a card is painted.
  let t0 = performance.now()
  await send('Page.navigate', { url: base + '/' })
  // The canvas paints after the socket seeds; a rendered .Dot/.Card is the signal.
  let w0 = await waitFor(ready)
  timings.load_to_interactive = w0 < 0 ? -1 : Math.round(performance.now() - t0)

  // (2) navigate to a busy board (P-19 has the most tasks) and time render.
  let t1 = performance.now()
  await send('Page.navigate', { url: base + '/P-19' })
  let w1 = await waitFor(`location.pathname.startsWith('/P-19') && ${ready}`)
  timings.open_board = w1 < 0 ? -1 : Math.round(performance.now() - t1)

  // (3) open the command palette and type — the interaction that feels laggy.
  let t2 = performance.now()
  await evalIn(`
    (() => {
      let ev = new KeyboardEvent('keydown', {key:'k', metaKey:true, bubbles:true})
      document.dispatchEvent(ev)
    })()
  `)
  // palette input appears; measure until it's focusable/present
  try {
    await waitFor(
      `!!document.querySelector('input[type="search"], .Palette input, [role="combobox"] input, input')`,
      5000,
    )
    timings.open_palette = Math.round(performance.now() - t2)
  } catch {
    timings.open_palette = -1
  }

  // (4) a re-render stress: measure a forced reflow after a scripted patch echo
  //     — how long the client takes to process a burst of cache reads.
  let stress = await evalIn(`
    (() => {
      let t = performance.now()
      // touch every rendered id chip: forces layout/read, a proxy for click cost
      let n = document.querySelectorAll('a[href^="/"], .Id, .Card').length
      let s = 0
      for (let i=0;i<200;i++) s += document.body.getBoundingClientRect().width
      return { ms: Math.round(performance.now()-t), nodes: n }
    })()
  `) as { ms: number; nodes: number }
  timings.render_nodes = stress?.nodes ?? -1

  if (wantProfile) {
    let prof = await send('Profiler.stop') as {
      profile?: {
        nodes: {
          id: number
          hitCount?: number
          callFrame: { functionName: string; url: string; lineNumber: number }
        }[]
      }
    }
    let nodes = prof.profile?.nodes ?? []
    let by = nodes
      .filter((n) => (n.hitCount ?? 0) > 0)
      .map((n) => ({
        fn: n.callFrame.functionName || '(anon)',
        loc: `${n.callFrame.url.split('/').pop()}:${
          n.callFrame.lineNumber + 1
        }`,
        hits: n.hitCount ?? 0,
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 20)
    if (!asJson) {
      log('\n=== hottest self-time frames (sampled) ===')
      for (let f of by) log(`${String(f.hits).padStart(5)}  ${f.fn}  ${f.loc}`)
    }
    timings._top_frame_hits = by[0]?.hits ?? 0
  }
} finally {
  try {
    ws.close()
  } catch { /* */ }
  await cleanup()
}

if (asJson) console.log(JSON.stringify(timings))
else {
  log('\n=== timings (ms) ===')
  for (let [k, v] of Object.entries(timings)) log(`${k}: ${v}`)
}
