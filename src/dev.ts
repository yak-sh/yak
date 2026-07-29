// The development and deployed server supervisor. Successors bind beside their
// predecessors, announce when boot is complete, then let the predecessor drain;
// the public port therefore always has a ready listener during source deploys.
import { serverFile } from './reload.ts'

let src = new URL('.', import.meta.url).pathname
let deno = Deno.execPath()
let args = [
  'run',
  '-A',
  '--unstable-net',
  '--unstable-worker-options',
  'src/server.ts',
]

let wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

let signal = async (listener: Deno.TcpListener) => {
  using conn = await listener.accept()
  let buf = new Uint8Array(1)
  let n = await conn.read(buf)
  if (n != 1 || buf[0] != 1) {
    throw new Error('server sent a bad ready signal')
  }
}

// Spawns the child with `--ready=<port>` appended and resolves once it has
// dialed that port back. The port rides argv so the address dies with the
// child; in the environment it would outlive this supervisor in every
// descendant shell.
export let launch = async (
  path = deno,
  run = args,
) => {
  using listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (listener.addr as Deno.NetAddr).port
  let timer: ReturnType<typeof setTimeout> | undefined
  let late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('server did not become ready in 30s')),
      30_000,
    )
  })
  let child = new Deno.Command(path, {
    args: [...run, `--ready=${port}`],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  try {
    await Promise.race([
      signal(listener),
      late,
      child.status.then((status) => {
        throw new Error(`server exited before ready (${status.code})`)
      }),
    ])
    return child
  } catch (e) {
    try {
      child.kill('SIGTERM')
    } catch {
      // It already said why it could not start.
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

let stopping = new WeakSet<Deno.ChildProcess>()
let watch = (child: Deno.ChildProcess) => {
  child.status.then((status) => {
    if (stopping.has(child)) return
    console.error(`server stopped unexpectedly (${status.code})`)
    Deno.exit(status.code || 1)
  })
  return child
}

let stop = async (child: Deno.ChildProcess) => {
  stopping.add(child)
  try {
    child.kill('SIGTERM')
  } catch {
    // A process that already left is drained.
  }
  await child.status
}

let swap = async (old: Deno.ChildProcess) => {
  try {
    let next = watch(await launch())
    await stop(old)
    return next
  } catch (e) {
    console.error('server handoff failed —', e)
    return old
  }
}

let supervise = async () => {
  let current = watch(await launch())
  let pending = false
  let swapping = false

  let swaps = async () => {
    swapping = true
    while (pending) {
      pending = false
      await wait(50)
      if (!pending) current = await swap(current)
    }
    swapping = false
  }

  for await (let event of Deno.watchFs(src)) {
    if (!event.paths.some(serverFile)) continue
    pending = true
    if (!swapping) swaps()
  }
}

if (import.meta.main) await supervise()
