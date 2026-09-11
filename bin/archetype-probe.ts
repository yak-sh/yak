// deno-lint-ignore-file no-explicit-any
// First-card CPU and settled wire measurements for renderer dispatch.
// Run against a scratch server only: deno run -A bin/archetype-probe.ts URL.
// The caller owns DB_PATH/TASKS_HOME/HARNESS_HOME and the server cleanup.
let [base] = Deno.args
if (
  !base ||
  !['localhost', '127.0.0.1'].includes(new URL(base).hostname)
) {
  throw Error(
    'Pass a loopback scratch PROBE URL',
  )
}
let listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
let port = (listener.addr as Deno.NetAddr).port
listener.close()
let dir = await Deno.makeTempDir({ dir: '/tmp', prefix: 'client-gate-' })
let child = new Deno.Command('google-chrome', {
  args: [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--remote-allow-origins=*',
    'about:blank',
  ],
  env: { TMPDIR: dir },
  stdout: 'null',
  stderr: 'null',
}).spawn()
let ws: WebSocket | undefined
let pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
try {
  let tab
  for (let i = 0; i < 100; i++) {
    try {
      tab =
        await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
          method: 'PUT',
        })).json()
      break
    } catch {
      await pause(100)
    }
  }
  ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((r) => ws!.onopen = r)
  let serial = 0
  let pending = new Map(),
    events: any[] = [],
    active = new Map<string, boolean>()
  let last = Date.now()
  ws.onmessage = (e) => {
    let m = JSON.parse(e.data)
    if (m.id) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    } else {
      events.push(m)
      let text = m.params?.response?.payloadData
      if (text && m.method.startsWith('Network.webSocketFrame')) {
        try {
          let f = JSON.parse(text)
          if (m.method === 'Network.webSocketFrameSent') {
            if (f.sub) active.set(f.sub, false)
            if (f.unsub) active.delete(f.unsub)
          } else if (f.sub && active.has(f.sub)) active.set(f.sub, true)
          if (f.sub || f.unsub || f.snapshot) last = Date.now()
        } catch { /* Non-JSON control frame or already-exited browser. */ }
      }
    }
  }
  let send = (method: string, params: object = {}) =>
    new Promise<any>((r, j) => {
      let id = ++serial
      pending.set(id, (m: any) => m.error ? j(m.error) : r(m.result))
      ws!.send(JSON.stringify({ id, method, params }))
    })
  let evaluate = async (expression: string) => {
    let r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }
  let wait = async (expression: string) => {
    for (let i = 0; i < 600; i++) {
      if (await evaluate(expression)) return
      await pause(100)
    }
    throw Error('Timeout ' + expression)
  }
  let settled = async () => {
    for (let i = 0; i < 900; i++) {
      if ([...active.values()].every(Boolean) && Date.now() - last > 2000) {
        return
      }
      await pause(100)
    }
    throw Error(
      'Unanswered: ' +
        JSON.stringify([...active].filter(([, ready]) => !ready)),
    )
  }
  await send('Performance.enable')
  await send('Page.enable')
  await send('Network.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      new MutationObserver(() => {
        if (!globalThis.__first && document.querySelector('.Card')) {
          globalThis.__first = {
            at: performance.now(), cards: document.querySelectorAll('.Card').length,
          }
        }
      }).observe(document, { childList: true, subtree: true });
      let descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
      Object.defineProperty(WebSocket.prototype, 'onmessage', {
        ...descriptor,
        set(fn) {
          descriptor.set.call(this, function(e) {
            try {
              let f = JSON.parse(e.data);
              if (f.sub === 'archetypes') globalThis.__descriptors = {
                at: performance.now(),
                rows: (f.changes ?? []).filter(c => c.name === 'archetype').length,
              };
            } catch {}
            fn.call(this, e);
          });
        },
      });
    `,
  })
  let metrics = (start = 0) => {
    let bytes = 0, ids = new Set<string>(), subs = 0, unsubs = 0, received = 0
    for (let e of events.slice(start)) {
      let text = e.params?.response?.payloadData
      if (!text) continue
      if (e.method === 'Network.webSocketFrameSent') {
        try {
          let f = JSON.parse(text)
          if (f.sub) subs++
          if (f.unsub) unsubs++
        } catch { /* Non-JSON control frame or already-exited browser. */ }
      }
      if (e.method !== 'Network.webSocketFrameReceived') continue
      bytes += new TextEncoder().encode(text).length
      received++
      try {
        let f = JSON.parse(text)
        for (
          let c of [
            ...f.changes ?? [],
            ...f.peers ?? [],
            ...f.snapshot?.changes ?? [],
          ]
        ) if (c.eid) ids.add(c.eid)
      } catch { /* Non-JSON control frame or already-exited browser. */ }
    }
    return { bytes, distinctIDs: ids.size, subs, unsubs, received }
  }
  let stats = () =>
    evaluate(
      `({cards:document.querySelectorAll('.Card').length,peeks:document.querySelectorAll('.Peek').length,cache:__probe.cacheN(),queries:__probe.subN(),transports:__probe.transportN?.()})`,
    )
  await send('Page.navigate', { url: base + '/' })
  await wait(
    `!!globalThis.__probe && __probe.cacheN()>10 && !!globalThis.__first`,
  )
  let firstCPU = await send('Performance.getMetrics')
  let firstWire = metrics()
  await pause(15000)
  await settled()
  let cold = { ...metrics(), ...await stats() }
  if (!cold.cards) throw Error('No cards mounted')
  console.log(JSON.stringify(
    {
      base,
      cold,
      firstCPU,
      firstWire,
      descriptors: await evaluate(`globalThis.__descriptors??null`),
      dom: await evaluate(
        `({cards:[...document.querySelectorAll('.Card')].map(e=>({body:!!e.querySelector('.Card_Scroll')})),loading:document.querySelectorAll('.Loading').length})`,
      ),
      performance: await evaluate(
        `({paint:performance.getEntriesByType('paint').map(p=>({name:p.name,startTime:p.startTime})),first:globalThis.__first})`,
      ),
      cpu: await send('Performance.getMetrics'),
      errors: events.filter((e) =>
        e.method === 'Runtime.exceptionThrown'
      ).length,
    },
    null,
    2,
  ))
} finally {
  ws?.close()
  try {
    child.kill('SIGTERM')
  } catch { /* Non-JSON control frame or already-exited browser. */ }
  await child.status
  for (let i = 0; i < 30; i++) {
    try {
      await Deno.remove(dir, { recursive: true })
      break
    } catch {
      await pause(100)
    }
  }
}
