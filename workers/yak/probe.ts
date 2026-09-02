// The kernel under test: `wrangler dev` boots workers/yak on a probe port
// with a throwaway persistence directory and a test secret, and a test
// drives it over HTTP the way a browser or a headless client would — a
// hostname rides `x-yak-host`, since fetch refuses a Host header and the
// kernel honors ours on a dev host (route.ts). Slow tier only: a real
// runtime boots. The pinned wrangler runs through npx (WRANGLER overrides the
// command); the process is its own session so `stop` takes workerd down with
// it, and proves the port closed before it returns.
import { until } from '../../src/testing.ts'
import { COOKIE, sign } from '../../src/token.ts'

let root = new URL('./', import.meta.url).pathname
let wrangler = (Deno.env.get('WRANGLER') ?? 'npx --yes wrangler@4.42.2')
  .split(' ')

let freePort = () => {
  let l = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let { port } = l.addr as Deno.NetAddr
  l.close()
  return port
}

let listening = async (port: number) => {
  try {
    ;(await Deno.connect({ hostname: '127.0.0.1', port })).close()
    return true
  } catch {
    return false
  }
}

export type Kernel = Awaited<ReturnType<typeof kernel>>

export let kernel = async () => {
  let port = freePort()
  let secret = crypto.randomUUID()
  let state = Deno.makeTempDirSync({ prefix: 'tasks-yak-' })
  let log = Deno.makeTempFileSync({ prefix: 'tasks-yak-', suffix: '.log' })
  // One handle per stream: a WritableStream locks to a single piper.
  let out = Deno.openSync(log, { write: true, append: true })
  let err = Deno.openSync(log, { write: true, append: true })
  let child = new Deno.Command('setsid', {
    args: [
      ...wrangler,
      'dev',
      '--config',
      'wrangler.toml',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      state,
      '--var',
      `SESSION_SECRET:${secret}`,
      '--show-interactive-dev-session=false',
    ],
    cwd: root,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let logged = Promise.all([
    child.stdout.pipeTo(out.writable, { preventClose: true }),
    child.stderr.pipeTo(err.writable, { preventClose: true }),
  ])
  let base = `http://127.0.0.1:${port}`
  // One request, at one hostname.
  let at = (host: string, path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        'x-yak-host': host,
      },
    })
  let stop = async () => {
    try {
      await new Deno.Command('kill', { args: ['-TERM', `-${child.pid}`] })
        .output()
    } catch { /* already gone */ }
    await until(async () => !(await listening(port)), {
      timeout: 15_000,
      poll: 100,
      label: 'the probe port to close',
    })
    await child.status
    await logged
    out.close()
    err.close()
    Deno.removeSync(state, { recursive: true })
    Deno.removeSync(log)
  }
  try {
    await until(async () => {
      try {
        return (await at('yaks.app', '/')).ok
      } catch {
        return false
      }
    }, { timeout: 60_000, poll: 250, label: () => Deno.readTextFileSync(log) })
  } catch (e) {
    await stop()
    throw e
  }
  return { base, secret, at, stop, log }
}

// A signed-in person's Cookie header, an hour long.
export let signedIn = async (k: Kernel, person: string) =>
  `${COOKIE}=${await sign(
    { person, space: null, exp: Math.floor(Date.now() / 1000) + 3600 },
    k.secret,
  )}`

type Row = { entity: { eid: string; num: number }; [k: string]: unknown }

// A client on one app's graph API, as one person (or nobody).
export let client = (
  k: Kernel,
  host: string,
  app: string,
  cookie?: string,
) => {
  let headers: Record<string, string> = cookie ? { cookie } : {}
  let get = async (q: string) =>
    (await (await k.at(host, `/${app}/api/query?${q}`, { headers }))
      .json()) as Row[]
  let post = (body: unknown) =>
    k.at(host, `/${app}/api/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    })
  let applied = async (body: unknown) => {
    let r = await post(body)
    if (r.status != 200) throw new Error(`apply ${r.status}: ${await r.text()}`)
    return (await r.json()) as {
      ok: boolean
      changes: { eid: string; name: string; comp: unknown }[]
    }
  }
  let put = (path: string, body: string, type?: string) =>
    k.at(host, `/${app}/api/files${path}`, {
      method: 'PUT',
      body,
      headers: { ...headers, ...(type ? { 'content-type': type } : {}) },
    })
  return { get, post, applied, put, headers }
}

// The directory's first rows, written by `person` through the meta space's
// bootstrap (index.ts): the person, their ownership of `yak`, and each space
// with its apps and the person as its owner. Returns the eids by slug.
export let seed = async (
  k: Kernel,
  person: string,
  spaces: { slug: string; apps: string[]; home?: string }[],
) => {
  let eids: Record<string, string> = {}
  let batch: unknown[] = [{ eid: person, name: 'person', comp: {} }]
  let meta = crypto.randomUUID()
  // The meta space already exists (seeded on first touch); read its eid.
  let [yak] = await client(k, 'yak.yaks.app', 'platform').get('.space.slug=yak')
  batch.push({
    eid: meta,
    name: 'member',
    comp: { space: yak.entity.eid, person, role: 'owner' },
  })
  for (let s of spaces) {
    let space = eids[s.slug] = crypto.randomUUID()
    batch.push({ eid: space, name: 'doc', comp: { title: s.slug } })
    batch.push({ eid: space, name: 'space', comp: { slug: s.slug } })
    batch.push({
      eid: crypto.randomUUID(),
      name: 'member',
      comp: { space, person, role: 'owner' },
    })
    for (let a of s.apps) {
      let app = eids[`${s.slug}/${a}`] = crypto.randomUUID()
      batch.push({ eid: app, name: 'doc', comp: { title: a } })
      batch.push({ eid: app, name: 'app', comp: { slug: a, space } })
    }
    if (s.home) {
      batch.push({
        eid: space,
        name: 'space',
        comp: { home: eids[`${s.slug}/${s.home}`] },
      })
    }
  }
  await client(k, 'yak.yaks.app', 'platform', await signedIn(k, person))
    .applied(batch)
  return eids
}
