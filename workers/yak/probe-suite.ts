// The suite owns the shared Node host, not an individual Deno test module.
// Its stdin is a lifetime lease: runner death closes it and reaps workerd too.
import { ready } from './wrangler.ts'
import { until } from '../../src/testing.ts'
import { fileURLToPath } from 'node:url'

export let probeSuite = async () => {
  await ready()
  let log = Deno.makeTempFileSync({ prefix: 'yak-probe-host-' })
  let child = new Deno.Command('setsid', {
    args: [
      'sh',
      '-c',
      'exec node "$1" >"$0" 2>&1',
      log,
      fileURLToPath(new URL('./probe-host.mjs', import.meta.url)),
    ],
    stdin: 'piped',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  let exited = false
  void child.status.then(() => {
    exited = true
  })
  let stopping: Promise<void> | undefined
  let stop = () =>
    stopping ??= (async () => {
      try {
        await child.stdin.close().catch(() => {})
        await until(() => exited, {
          timeout: 15_000,
          poll: 25,
          label: 'the probe host and its runtimes to stop',
        })
      } catch (error) {
        // The host normally disposes Miniflare on stdin EOF. Bound even a
        // broken dispose, and kill its whole session, not just Node.
        await new Deno.Command('kill', {
          args: ['-KILL', `-${child.pid}`],
        }).output()
        throw error
      } finally {
        await child.status
        Deno.removeSync(log)
      }
    })()
  try {
    let address = await until(() => {
      let text = Deno.readTextFileSync(log)
      if (exited) throw new Error(text)
      return /Ready on (http:\/\/127\.0\.0\.1:\d+)/.exec(text)?.[1] ?? ''
    }, { timeout: 60_000, poll: 25, label: () => Deno.readTextFileSync(log) })
    let jobs = Deno.env.get('DENO_JOBS') ?? String(Math.max(
      1,
      Math.min(
        // Four modules saturate the single kernel without multiplying the
        // Deno parent's heaps. DENO_JOBS remains an explicit override.
        4,
        navigator.hardwareConcurrency,
        Math.floor(Deno.systemMemoryInfo().available / (600 * 1024 * 1024)),
      ),
    ))
    return { env: { YAK_PROBE_HOST: address, DENO_JOBS: jobs }, stop }
  } catch (error) {
    await stop()
    throw error
  }
}
