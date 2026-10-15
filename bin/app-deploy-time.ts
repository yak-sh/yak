#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
// What an app deploy costs the person making it, timed the way they feel it:
// an app_files write of a small app and an app_deploy, until its bytes answer
// live at the app URL (ship), then a one-file change deployed the same way
// (edit). RUNS of each, medians and p95 appended as one row to
// bench/app-deploys.jsonl (or $APP_DEPLOY_RECORD, which the monitor sets to
// its own state), which the app-deploy suite checks. Every answer's
// `Server-Timing` is kept too (median per stage), so a row that moved says
// which hop moved it.
//
//   deno task app-deploy:time
//
// It signs in as a throwaway account (`yak admin throwaway`, NAME) and mints a
// one-hour grant narrowed to that account's own space for the run: never the
// owner's account, never an account key. The grant is read from `yak grant`'s
// answer, kept in memory, never printed, and revoked at the end. HOST defaults
// to production because staging (yaks.fyi) cannot sign anyone in until it can
// mail (T-34979). The app is a throwaway, deleted forever at the end; this
// records and never commits or pushes.
import { RECORD, type Row, type Stat } from '../bench/app-deploy.ts'

let who = Deno.env.get('NAME') ?? 'app-deploy-bench'
let space = who
let host = Deno.env.get('HOST') ?? 'yaks.app'
let app = Deno.env.get('APP') ?? `bench-${Date.now().toString(36)}`
let runs = Number(Deno.env.get('RUNS') ?? 5)
let record = RECORD
let mcp = `https://${host}/mcp`
let id = 0

// `yak` as the throwaway: its connector tools, answered as JSON. It signs the
// account in when it has no connection yet.
let yak = async (...args: string[]) => {
  let out = await new Deno.Command('yak', {
    args: ['--host', host, '--as', who, '--json', ...args],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!out.success) {
    throw new Error(new TextDecoder().decode(out.stderr).trim().slice(0, 300))
  }
  return new TextDecoder().decode(out.stdout)
}

// The run's grant, minted once. Its token only ever sits in `grant`.
let grant = ''
let mint = async () => {
  let said = await yak('grant', '--space', space).catch(async () => {
    await new Deno.Command('yak', {
      args: ['admin', 'throwaway', who],
      stdout: 'null',
      stderr: 'null',
    }).output()
    return await yak('grant', '--space', space)
  })
  let body: string = JSON.parse(said).result?.[0]?.content?.body ?? ''
  let m = body.match(/^yak login (\S+)/)
  if (!m) throw new Error('grant: no token in the answer')
  grant = m[1]
}
let token = () => grant

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
      authorization: `Bearer ${token()}`,
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

// `hops` and `r2` are counts and not milliseconds (workers/yak/timing.ts): the
// round trips a call made to a store and to the bucket. They ride the same
// `dur` field as every stage, so they are pulled out here and said as counts
// beside the stage line rather than sorted in among the times — an N+1 shows
// up as a number that grew, in the row the gate already keeps.
let TRIPS = ['hops', 'r2']

let table = (row: Row) =>
  [
    `${row.host} v${row.version ?? '?'} runs=${row.runs}`,
    ...(['ship', 'edit'] as const).map((k) =>
      `${k.padEnd(5)} → live ${row[k].live.median} ms (write ${
        row[k].write.median
      }, deploy ${row[k].deploy.median}, p95 ${row[k].live.p95})`
    ),
    ...Object.entries(row.timing ?? {}).flatMap(([tool, by]) => [
      `  ${tool}: ${
        Object.entries(by).filter(([k]) => !TRIPS.includes(k))
          .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
      }`,
      `    round trips: ${TRIPS.map((k) => `${k} ${by[k] ?? 0}`).join(', ')}`,
    ]),
  ].join('\n')

type Lap = { write: number[]; deploy: number[]; live: number[] }
type Hops = Record<string, number>[]

// One change until it is live: app_files stages it, app_deploy releases it,
// and the clock stops when `path` answers with `marker`.
let ship = async (
  lap: Lap,
  hops: { files: Hops; deploy: Hops },
  files: Record<string, unknown>,
  path: string,
  marker: string,
) => {
  let t0 = performance.now()
  hops.files.push(await call('app_files', { app, space, ...files }))
  let t1 = performance.now()
  hops.deploy.push(await call('app_deploy', { app, space }))
  lap.write.push(t1 - t0)
  lap.deploy.push(performance.now() - t1)
  lap.live.push(await live(path, marker, t0))
}

let summary = (lap: Lap) => ({
  write: stats(lap.write),
  deploy: stats(lap.deploy),
  live: stats(lap.live),
})

export let main = async () => {
  console.log(`app ${space}.${host}/${app}/ runs=${runs}`)
  await mint()
  await call('app_new', { slug: app, title: 'bench (throwaway)', space })
  let version = (await fetch(`https://${host}/`, { method: 'HEAD' })).headers
    .get('x-yak-version')

  let first: Lap = { write: [], deploy: [], live: [] }
  let edit: Lap = { write: [], deploy: [], live: [] }
  let hops = {
    ship: { files: [], deploy: [] },
    edit: { files: [], deploy: [] },
  }
  try {
    for (let i = 0; i < runs; i++) {
      let m = `w${i}-${Math.random().toString(36).slice(2)}`
      await ship(first, hops.ship, { files: three(m) }, 'index.html', m)

      let s = `s${i}-${Math.random().toString(36).slice(2)}`
      await ship(
        edit,
        hops.edit,
        { path: 'app.js', content: `console.log('${s}')` },
        'app.js',
        s,
      )
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
    // The grant ends itself, and nothing else: a revoke by the token it names.
    await call('grant', { revoke: grant }).catch(() => {})
  }

  let row: Row = {
    at: new Date().toISOString(),
    host,
    version,
    runs,
    ship: summary(first),
    edit: summary(edit),
    timing: {
      ship_files: medians(hops.ship.files),
      ship_deploy: medians(hops.ship.deploy),
      edit_files: medians(hops.edit.files),
      edit_deploy: medians(hops.edit.deploy),
    },
  }
  await Deno.writeTextFile(record, JSON.stringify(row) + '\n', { append: true })
  console.log(table(row))
  console.log(`recorded → ${record}`)
}

if (import.meta.main) await main()
