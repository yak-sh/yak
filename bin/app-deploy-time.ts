// Times yaks.app app deploys as a person sees them: app_files write → the new
// bytes answer live at the app URL; app_deploy; a single-file update → live.
// Token is read from $TOKEN_FILE (a grant), never printed.
let token = (await Deno.readTextFile(Deno.env.get('TOKEN_FILE')!)).trim()
let space = Deno.env.get('SPACE') ?? 'jeff'
let host = Deno.env.get('HOST') ?? 'yaks.app'
let app = Deno.env.get('APP') ?? `bench-${Date.now().toString(36)}`
let runs = Number(Deno.env.get('RUNS') ?? 5)
let mcp = `https://${host}/mcp`
let id = 0

let call = async (name: string, args: Record<string, unknown>) => {
  let res = await fetch(mcp, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
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
  return json.result
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

let stats = (xs: number[]) => {
  let s = [...xs].sort((a, b) => a - b)
  let q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { median: Math.round(q(0.5)), p95: Math.round(q(0.95)), n: s.length }
}

let three = (m: string) => [
  { path: 'index.html', content: `<!doctype html><title>bench</title><p>${m}</p><link rel=stylesheet href=style.css><script src=app.js></script>` },
  { path: 'style.css', content: `p{color:teal}/*${m}*/` },
  { path: 'app.js', content: `console.log('${m}')` },
]

console.log(`app ${space}.${host}/${app}/ runs=${runs}`)
await call('app_new', { slug: app, title: 'bench (throwaway)', space })

let write: number[] = [], deploy: number[] = [], single: number[] = []
let wcall: number[] = [], dcall: number[] = [], scall: number[] = []
for (let i = 0; i < runs; i++) {
  let m = `w${i}-${Math.random().toString(36).slice(2)}`
  let t0 = performance.now()
  await call('app_files', { app, space, files: three(m) })
  wcall.push(performance.now() - t0)
  write.push(await live('index.html', m, t0))

  t0 = performance.now()
  await call('app_deploy', { app, space })
  dcall.push(performance.now() - t0)
  deploy.push(performance.now() - t0)

  let s = `s${i}-${Math.random().toString(36).slice(2)}`
  t0 = performance.now()
  await call('app_files', { app, space, path: 'app.js', content: `console.log('${s}')` })
  scall.push(performance.now() - t0)
  single.push(await live('app.js', s, t0))
}

console.log(JSON.stringify({
  app_files_3_call: stats(wcall), app_files_3_live: stats(write),
  app_deploy: stats(deploy),
  single_file_call: stats(scall), single_file_live: stats(single),
}, null, 1))

await call('app_delete', { app, space, forever: true })
let gone = await fetch(url('index.html'), { cache: 'no-store' })
console.log(`deleted forever; GET index.html → ${gone.status}`)
