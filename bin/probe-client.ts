// deno-lint-ignore-file no-explicit-any
import { wireBreakdown } from './cdp-wire.ts'

// deno run -A bin/probe-client.ts http://localhost:PORT /tmp/fixed-targets.json
// Scratch CDP gate: no auth, same snapshot and target file for both runs.
const [base, targetFile] = Deno.args
if (
  !base || !targetFile ||
  !['localhost', '127.0.0.1'].includes(new URL(base).hostname)
) {
  throw Error(
    'Pass a loopback scratch PROBE URL and a shared six-target JSON file',
  )
}
const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
const port = (listener.addr as Deno.NetAddr).port
listener.close()
const dir = await Deno.makeTempDir({ dir: '/tmp', prefix: 'client-gate-' })
const child = new Deno.Command('google-chrome', {
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
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
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
  const pending = new Map(),
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
  const send = (method: string, params: object = {}) =>
    new Promise<any>((r, j) => {
      let id = ++serial
      pending.set(id, (m: any) => m.error ? j(m.error) : r(m.result))
      ws!.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression: string) => {
    let r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }
  const wait = async (expression: string) => {
    for (let i = 0; i < 600; i++) {
      if (await evaluate(expression)) return
      await pause(100)
    }
    throw Error('Timeout ' + expression)
  }
  const settled = async () => {
    for (let i = 0; i < 900; i++) {
      if ([...active.values()].every(Boolean) && Date.now() - last > 2000) {
        // CDP sees frames before the app's serialized apply/persist queue.
        // Wire quiet alone can measure half a boot (or a body still loading)
        // under host load. Wait for the addressed browser reads too.
        if (
          await evaluate(
            `${
              JSON.stringify([...active.keys()])
            }.every(sub=>__live.subscriptionState(sub).status!=='loading')`,
          )
        ) return
      }
      await pause(100)
    }
    throw Error(
      'Unanswered: ' +
        JSON.stringify([...active].filter(([, ready]) => !ready)),
    )
  }
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
    source:
      `{const d=Object.getOwnPropertyDescriptor(WebSocket.prototype,'onmessage');Object.defineProperty(WebSocket.prototype,'onmessage',{...d,set(fn){d.set.call(this,function(e){if(globalThis.__pauseFrames){(globalThis.__frames??=[]).push(()=>fn.call(this,e))}else fn.call(this,e)})}});globalThis.__flush=()=>{globalThis.__pauseFrames=false;for(const fn of globalThis.__frames??[])fn();globalThis.__frames=[]}}`,
  })
  const metrics = (start = 0) => {
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
  const stats = () =>
    evaluate(
      `({cards:document.querySelectorAll('.Card').length,peeks:document.querySelectorAll('.Peek').length,cache:__probe.cacheN(),queries:__probe.subN(),transports:__probe.transportN?.()})`,
    )
  await send('Page.navigate', { url: base + '/' })
  await wait(
    `!!globalThis.__probe && __probe.cacheN()>10 && !!document.querySelector('.Card,.Dot,.Id') && typeof __flush==='function'`,
  )
  await evaluate(
    `(async()=>{globalThis.__live=await import('/live.ts');globalThis.__nav=await import('/components/nav.tsx')})()`,
  )
  await pause(15000)
  await settled()
  const cold = { ...metrics(), ...await stats() }
  const breakdown = wireBreakdown(events)
  let targets: string[]
  try {
    targets = JSON.parse(await Deno.readTextFile(targetFile))
  } catch {
    targets = await evaluate(
      `Object.entries(__live.cache.peek()).filter(([id,r])=>r.task&&r.doc?.title&&r.entity?.num).sort((a,b)=>b[1].entity.num-a[1].entity.num).slice(0,6).map(([id])=>id)`,
    )
    await Deno.writeTextFile(targetFile, JSON.stringify(targets))
  }
  if (targets.length !== 6) throw Error('Need six targets')
  await evaluate(`globalThis.__targets=${JSON.stringify(targets)}`)
  const body = (i: number) =>
    evaluate(
      `(async()=>{const text=__live.ent(__targets[${i}]).doc?.body;return {length:typeof text==='string'?text.length:null,sha256:typeof text==='string'?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(b=>b.toString(16).padStart(2,'0')).join(''):null}})()`,
    )
  const start = events.length, opens = []
  for (let i = 0; i < 6; i++) {
    const at = events.length
    await evaluate(`__live.peek.value=[{eid:__targets[${i}],x:600,y:250}]`)
    await settled()
    opens.push({
      ...metrics(at),
      body: await body(i),
      text: await evaluate(
        `document.querySelector('.Peek')?.textContent?.length??0`,
      ),
    })
    await evaluate('__live.peek.value=[]')
    await pause(300)
  }
  await settled()
  const six = { ...metrics(start), ...await stats(), opens }
  const reopenStart = events.length
  const before = await evaluate(
    `__pauseFrames=true;__live.peek.value=[{eid:__targets[0],x:600,y:250}];({title:!!__live.ent(__targets[0]).doc?.title})`,
  )
  await wait(`(globalThis.__frames?.length??0)>0`)
  await pause(300)
  const during = await evaluate(
    `({title:!!__live.ent(__targets[0]).doc?.title,text:document.querySelector('.Peek')?.textContent?.length,queued:globalThis.__frames?.length??0})`,
  )
  const reopenSubs = [
    ...new Set(
      events.slice(reopenStart).filter((e) =>
        e.method === 'Network.webSocketFrameSent'
      ).flatMap((e) => {
        try {
          let f = JSON.parse(e.params.response.payloadData)
          return f.sub ? [f.sub] : []
        } catch {
          return []
        }
      }),
    ),
  ]
  const readiness = await evaluate(
    `${
      JSON.stringify(reopenSubs)
    }.map(sub=>({sub,status:__live.subscriptionState(sub).status}))`,
  )
  await evaluate('__flush()')
  await settled()
  const afterReadiness = await evaluate(
    `${
      JSON.stringify(reopenSubs)
    }.map(sub=>({sub,status:__live.subscriptionState(sub).status}))`,
  )
  const reopen = {
    before,
    during,
    body: await body(0),
    readiness,
    afterReadiness,
    ...metrics(reopenStart),
    ...await stats(),
  }
  const errors = events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => ({
      text: e.params.exceptionDetails.text,
      description: e.params.exceptionDetails.exception?.description?.slice(
        0,
        1200,
      ),
    }))
  const answers = events.filter((e) =>
    e.method === 'Network.webSocketFrameReceived'
  ).flatMap((e) => {
    try {
      let text = e.params.response.payloadData, f = JSON.parse(text)
      return f.sub
        ? [{
          sub: f.sub,
          bytes: new TextEncoder().encode(text).length,
          n: f.changes?.length,
          error: f.error,
        }]
        : []
    } catch {
      return []
    }
  })
  console.log(
    JSON.stringify(
      { base, targets, cold, breakdown, six, reopen, errors, answers },
      null,
      2,
    ),
  )
  if (
    errors.length || answers.some((a) => a.error) || opens.some((o) =>
      o.body.length === null || o.text === 0
    ) || !during.title || !during.text || readiness.some((r: any) =>
      r.status !== 'loading'
    ) || afterReadiness.some((r: any) => r.status !== 'ready')
  ) throw Error('Rendering/readiness gate failed; see JSON report')
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
