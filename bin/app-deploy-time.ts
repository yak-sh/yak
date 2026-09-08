#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
// What an app deploy costs the person making it, timed the way they feel it:
// an app_files write of a small app until its bytes answer live at the app URL,
// an app_deploy, and a one-file update until live. RUNS of each, medians and
// p95 appended as one row to bench/app-deploys.jsonl, which
// bin/app-deploy-gate.ts ratchets. Every answer's `Server-Timing` is kept too
// (median per stage), so a row that moved says which hop moved it.
//
//   TOKEN_FILE=/path/to/grant deno task app-deploy:time
//
// The token is a `grant` (an hour, narrowed to SPACE), read from a file and
// never printed. HOST defaults to production because staging (yaks.fyi) cannot
// sign anyone in until it can mail (T-34979); pass HOST=yaks.fyi once it can.
// The app is a throwaway, deleted forever at the end — this records; it never
// commits or pushes.
import { RECORD, type Row, type Stat } from './app-deploy-gate.ts'

// Read when the bench runs, not when a test imports the helpers below.
let token = async () => {
  let file = Deno.env.get('TOKEN_FILE')
  if (!file) throw new Error('TOKEN_FILE: the path of a grant, unset')
  return (await Deno.readTextFile(file)).trim()
}
let space = Deno.env.get('SPACE') ?? 'jeff'
let host = Deno.env.get('HOST') ?? 'yaks.app'
let app = Deno.env.get('APP') ?? `bench-${Date.now().toString(36)}`
let runs = Number(Deno.env.get('RUNS') ?? 5)
let record = Deno.env.get('RECORD') ?? RECORD
let mcp = `https://${host}/mcp`
let id = 0

// `name;dur=N` entries → ms by stage.
export let stages = (header: string | null) =>
  Object.fromEntries(
    (header ?? '').split(',').flatMap((entry) => {
      let m = entry.trim().match(/^([^;,\s]+).*?;dur=([\d.]+)/)
      return m ? [[m[1], +m[2]]] : []
    }),
  ) as Record<string, number>

let call = async (name: string, args: Record<string, unknown>) => {
  let res = await fetch(mcp, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${await token()}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++id,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  let text = await res.text()
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 300)}`)
  // streamable http may answer SSE; take the last data: line
  let data = text.startsWith('event:') || text.startsWith('data:')
    ? text.split('\n').filter((l) => l.startsWith('data:')).pop()!.slice(5)
    : text
  let json = JSON.parse(data)
  if (json.error) throw new Error(`${name}: ${JSON.stringify(json.error)}`)
  if (json.result?.isError) {
    throw new Error(`${name}: ${JSON.stringify(json.result.content)}`)
  }
  return stages(res.headers.get('server-timing'))
}

let url = (path: string) => `https://${space}.${host}/${app}/${path}`

// poll until the body carries the marker; returns ms from t0
let live = async (path: string, marker: string, t0: number) => {
  for (;;) {
    let res = await fetch(url(path), { cache: 'no-store' })
    let body = await res.text()
    if (res.ok && body.includes(marker)) return performance.now() - t0
    if (performance.now() - t0 > 30_000) throw new Error(`not live: ${path}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

export let stats = (xs: number[]): Stat => {
  let s = [...xs].sort((a, b) => a - b)
  let q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { median: Math.round(q(0.5)), p95: Math.round(q(0.95)), n: s.length }
}

// Median per stage across the runs' headers, stages nobody reported dropped.
export let medians = (all: Record<string, number>[]) => {
  let by = new Map<string, number[]>()
  for (let one of all) {
    for (let [k, v] of Object.entries(one)) by.set(k, [...by.get(k) ?? [], v])
  }
  return Object.fromEntries(
    [...by].map(([k, xs]) => [k, stats(xs).median]),
  ) as Record<string, number>
}

let three = (m: string) => [
  {
    path: 'index.html',
    content:
      `<!doctype html><title>bench</title><p>${m}</p><link rel=stylesheet href=style.css><script src=app.js></script>`,
  },
  { path: 'style.css', content: `p{color:teal}/*${m}*/` },
  { path: 'app.js', content: `console.log('${m}')` },
]

let table = (row: Row) =>
  [
    `${row.host} v${row.version ?? '?'} runs=${row.runs}`,
    `files → live   ${row.files3.live.median} ms (call ${row.files3.call.median}, p95 ${row.files3.live.p95})`,
    `deploy         ${row.deploy.call.median} ms (p95 ${row.deploy.call.p95})`,
    `one file → live ${row.single.live.median} ms (call ${row.single.call.median}, p95 ${row.single.live.p95})`,
    ...Object.entries(row.timing ?? {}).map(([tool, by]) =>
      `  ${tool}: ${
        Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
          `${k} ${v}`
        ).join(', ')
      }`
    ),
  ].join('\n')

if (import.meta.main) {
  console.log(`app ${space}.${host}/${app}/ runs=${runs}`)
  await call('app_new', { slug: app, title: 'bench (throwaway)', space })
  let version = (await fetch(`https://${host}/`, { method: 'HEAD' })).headers
    .get('x-yak-version')

  let write: number[] = [], deploy: number[] = [], single: number[] = []
  let wcall: number[] = [], scall: number[] = []
  let wt: Record<string, number>[] = [], dt: Record<string, number>[] = []
  let st: Record<string, number>[] = []
  try {
    for (let i = 0; i < runs; i++) {
      let m = `w${i}-${Math.random().toString(36).slice(2)}`
      let t0 = performance.now()
      wt.push(await call('app_files', { app, space, files: three(m) }))
      wcall.push(performance.now() - t0)
      write.push(await live('index.html', m, t0))

      t0 = performance.now()
      dt.push(await call('app_deploy', { app, space }))
      deploy.push(performance.now() - t0)

      let s = `s${i}-${Math.random().toString(36).slice(2)}`
      t0 = performance.now()
      st.push(
        await call('app_files', {
          app,
          space,
          path: 'app.js',
          content: `console.log('${s}')`,
        }),
      )
      scall.push(performance.now() - t0)
      single.push(await live('app.js', s, t0))
    }
  } finally {
    // The throwaway goes whatever happened above; a delete that fails must not
    // hide the error that stopped the runs, so it is said beside it.
    try {
      await call('app_delete', { app, space, forever: true })
      let gone = await fetch(url('index.html'), { cache: 'no-store' })
      await gone.text()
      console.log(`deleted forever; GET index.html → ${gone.status}`)
    } catch (e) {
      console.error(
        `app_delete failed — delete ${space}/${app} by hand: ${
          e instanceof Error ? e.message : e
        }`,
      )
    }
  }

  let row: Row = {
    at: new Date().toISOString(),
    host,
    version,
    runs,
    files3: { call: stats(wcall), live: stats(write) },
    deploy: { call: stats(deploy) },
    single: { call: stats(scall), live: stats(single) },
    timing: {
      app_files: medians(wt),
      app_deploy: medians(dt),
      single_file: medians(st),
    },
  }
  await Deno.writeTextFile(record, JSON.stringify(row) + '\n', { append: true })
  console.log(table(row))
  console.log(`recorded → ${record}`)
}
