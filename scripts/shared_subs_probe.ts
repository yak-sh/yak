// Shared subscription proof (T-8341). Two app tabs mount one board while one
// Web Lock holder owns the only socket. A follower may disappear without
// tearing down the leader's subscription; a killed leader promotes the
// follower, which replays the board before subsequent matching writes.
//
// Unique app and CDP ports plus a scratch DB keep parallel probes isolated.
// Run: deno run -A --unstable-net --unstable-worker-options \
//   scripts/shared_subs_probe.ts

let root = new URL('..', import.meta.url).pathname
let temp = await Deno.makeTempDir({ prefix: 'tasks-shared-subs-' })
let profile = await Deno.makeTempDir({ prefix: 'tasks-shared-chrome-' })
let db = `${temp}/tasks.db`
let uuid = () => crypto.randomUUID()
let sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let port = () => {
  let listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let found = (listener.addr as Deno.NetAddr).port
  listener.close()
  return found
}
let appPort = port()
let cdpPort = port()
let base = `http://127.0.0.1:${appPort}`
let pass = true
let ok = (label: string, yes: boolean) => {
  console.log(`${yes ? 'PASS' : 'FAIL'}  ${label}`)
  pass = pass && yes
}

let until = async <T>(fn: () => Promise<T>, ms = 15_000): Promise<T> => {
  let end = Date.now() + ms
  for (;;) {
    let found = await fn()
    if (found) return found
    if (Date.now() > end) throw new Error('timed out')
    await sleep(100)
  }
}

let open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    let ws = new WebSocket(url)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', () => reject(new Error(`ws failed: ${url}`)))
  })

let cdp = (ws: WebSocket) => {
  let seq = 0
  let waiting = new Map<
    number,
    {
      resolve: (v: Record<string, unknown>) => void
      reject: (e: Error) => void
    }
  >()
  ws.addEventListener('message', (event) => {
    let message = JSON.parse(String(event.data))
    let wait = waiting.get(message.id)
    if (!wait) return
    waiting.delete(message.id)
    if (message.error) wait.reject(new Error(JSON.stringify(message.error)))
    else wait.resolve(message.result)
  })
  let send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let id = ++seq
      waiting.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { send }
}

type Page = {
  id: string
  ws: WebSocket
  eval: <T>(expression: string) => Promise<T>
}

let page = async (url: string): Promise<Page> => {
  let target = await (await fetch(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' },
  )).json()
  let ws = await open(target.webSocketDebuggerUrl)
  let client = cdp(ws)
  await client.send('Runtime.enable')
  let evalIn = async <T>(expression: string): Promise<T> => {
    let out = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    let result = out.result as { value: T; description?: string }
    if (out.exceptionDetails) {
      throw new Error(
        result.description ?? JSON.stringify(out.exceptionDetails),
      )
    }
    return result.value
  }
  await until(async () =>
    await evalIn('document.readyState') == 'complete' &&
    await evalIn('typeof globalThis.__sync') == 'function'
  )
  return { id: target.id, ws, eval: evalIn }
}

let close = async (p: Page) => {
  await fetch(`http://127.0.0.1:${cdpPort}/json/close/${p.id}`)
  p.ws.close()
}

let chromeBin = ['google-chrome', 'google-chrome-stable', 'chromium'].find(
  (bin) => {
    try {
      return new Deno.Command(bin, { args: ['--version'] }).outputSync().success
    } catch {
      return false
    }
  },
)
if (!chromeBin) throw new Error('no Chrome on PATH')

let server = new Deno.Command('deno', {
  args: [
    'run',
    '-A',
    '--unstable-net',
    '--unstable-worker-options',
    'src/server.ts',
  ],
  cwd: root,
  env: { ...Deno.env.toObject(), PORT: String(appPort), DB_PATH: db },
  stdout: 'null',
  stderr: 'null',
}).spawn()
let chrome = new Deno.Command(chromeBin, {
  args: [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-sandbox',
    'about:blank',
  ],
  stdout: 'null',
  stderr: 'null',
}).spawn()

let board = uuid()
let first = uuid()
let second = uuid()
let third = uuid()
let done = uuid()
let apply = (changes: unknown[]) =>
  fetch(`${base}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })
let task = (eid: string, status = 'open') => [
  { eid, name: 'doc', comp: { title: `probe-${eid}`, body: '' } },
  { eid, name: 'task', comp: { status, priority: 1 } },
]
let state = (p: Page) =>
  p.eval<
    { sync: { leader: boolean; socket: number | null }; members: string[] }
  >(
    `(async () => {
      let live = await import('/live.ts')
      return {
        sync: globalThis.__sync(),
        members: [...(live.subEids(${JSON.stringify(`board:${board}`)}) ?? [])],
      }
    })()`,
  )

let pages: Page[] = []
try {
  await until(async () => {
    try {
      return (await fetch(`${base}/capabilities`)).ok
    } catch {
      return false
    }
  })
  await apply([
    { eid: board, name: 'doc', comp: { title: 'Shared probe', body: '' } },
    { eid: board, name: 'board', comp: { query: '.status=open' } },
    ...task(first),
  ])
  // Read the board's num back over /query (the snapshot door is retired) —
  // one keyed fetch, entity JSON shaped {entity: {eid, num}, …}.
  let [ent] = await (await fetch(`${base}/query?id=${board}`))
    .json() as { entity: { num: number } }[]
  let url = `${base}/B-${ent.entity.num}?v=List`

  pages = [await page(url), await page(url)]
  await until(async () => {
    let states = await Promise.all(pages.map(state))
    return states.some((s) => s.members.includes(first)) &&
      states.filter((s) => s.sync.leader && s.sync.socket == WebSocket.OPEN)
          .length == 1 &&
      states.filter((s) => s.sync.socket == null).length == 1
  })
  ok('two board tabs share one physical socket', true)

  let states = await Promise.all(pages.map(state))
  let leader = pages[states.findIndex((s) => s.sync.leader)]
  let follower = pages.find((p) => p != leader)!
  await close(follower)
  pages = [leader]
  await apply(task(second))
  await until(async () => (await state(leader)).members.includes(second))
  ok('closing one owner leaves subscription updates in the other', true)

  let next = await page(url)
  pages.push(next)
  await until(async () => {
    let current = await state(next)
    return !current.sync.leader && current.sync.socket == null
  })
  await apply([
    { eid: board, name: 'board', comp: { query: '.status=done' } },
    ...task(done, 'done'),
  ])
  await until(async () =>
    (await Promise.all(pages.map(state))).every((s) =>
      s.members.includes(done) && !s.members.includes(first) &&
      !s.members.includes(second)
    )
  )
  ok('query replacement keeps the name and replaces its member set', true)

  await apply([{ eid: board, name: 'board', comp: { query: '.status=open' } }])
  await until(async () =>
    (await Promise.all(pages.map(state))).every((s) =>
      s.members.includes(first) && !s.members.includes(done)
    )
  )
  states = await Promise.all(pages.map(state))
  leader = pages[states.findIndex((s) => s.sync.leader)]
  follower = pages.find((p) => p != leader)!
  await close(leader)
  pages = [follower]
  await until(async () => (await state(follower)).sync.leader)
  await apply(task(third))
  await until(async () => (await state(follower)).members.includes(third))
  ok('a promoted follower replays before subsequent result updates', true)

  let last = await page(url)
  pages.push(last)
  await until(async () => {
    let current = await Promise.all(pages.map(state))
    return current.filter((s) => s.sync.socket == WebSocket.OPEN).length == 1 &&
      current.filter((s) => s.sync.socket == null).length == 1
  })
  ok('the promoted topology still owns only one socket', true)
} finally {
  await Promise.all(pages.map((p) => close(p).catch(() => {})))
  try {
    chrome.kill('SIGKILL')
  } catch { /* already gone */ }
  try {
    server.kill('SIGTERM')
  } catch { /* already gone */ }
  await Promise.allSettled([chrome.status, server.status])
  await Deno.remove(temp, { recursive: true })
  await Deno.remove(profile, { recursive: true })
}

if (!pass) Deno.exit(1)
