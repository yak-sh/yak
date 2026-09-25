import { assertEquals } from '@std/assert'
import { ARGS, service, type Spawn } from './service.ts'

// A connector that never starts a process: each start is recorded, and ends
// when `end` is called or when it is killed.
let fake = () => {
  let starts: { cmd: string; args: string[]; env: Record<string, string> }[] =
    []
  let ends: ((code: number) => void)[] = []
  let spawn: Spawn = (cmd, args, env) => {
    starts.push({ cmd, args, env })
    let end!: (code: number) => void
    let status = new Promise<{ code: number }>((done) =>
      end = (code) => done({ code })
    )
    ends.push(end)
    return { status, kill: () => end(143) }
  }
  return { spawn, starts, ends }
}

let tick = () => new Promise((done) => setTimeout(done, 0))

Deno.test('no token, nothing to run', async () => {
  let f = fake()
  await service(null, { spawn: f.spawn }, new AbortController().signal)
  assertEquals(f.starts.length, 0)
})

Deno.test('the token rides in the environment, never the arguments', async () => {
  let f = fake()
  let stop = new AbortController()
  let running = service(null, { token: 'tok', spawn: f.spawn }, stop.signal)
  await tick()
  assertEquals(f.starts, [{
    cmd: 'cloudflared',
    args: ARGS,
    env: { TUNNEL_TOKEN: 'tok' },
  }])
  stop.abort()
  await running
  assertEquals(f.starts.length, 1)
})

Deno.test('a connector that exits is started again', async () => {
  let f = fake()
  let stop = new AbortController()
  let options = { token: 'tok', spawn: f.spawn, pause: 0 }
  let running = service(null, options, stop.signal)
  await tick()
  let error = console.error
  console.error = () => {}
  try {
    f.ends[0](1)
    await tick()
    await tick()
  } finally {
    console.error = error
  }
  assertEquals(f.starts.length, 2)
  stop.abort()
  await running
})

// A port nothing listens on, for as long as it takes to hand it over.
let free = () => {
  let l = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let { port } = l.addr
  l.close()
  return port
}

Deno.test('the door listens on its port and passes the link on to the server', async () => {
  let stop = new AbortController()
  let server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, signal: stop.signal, onListen() {} },
    (req) => new Response(`served ${new URL(req.url).pathname}`),
  )
  let port = free()
  let options = { secret: 's', port, routes: ['/mail/inbound'] }
  let running = service({ config: server.addr }, options, stop.signal)
  let ask = async (path: string) => {
    let r = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { 'x-yak-link': 's' },
    })
    return `${r.status} ${await r.text()}`
  }
  try {
    await tick()
    assertEquals(await ask('/mail/inbound'), '200 served /mail/inbound')
    assertEquals((await ask('/apply')).slice(0, 3), '404')
  } finally {
    stop.abort()
    await running
    await server.finished
  }
})
