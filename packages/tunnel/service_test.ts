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
