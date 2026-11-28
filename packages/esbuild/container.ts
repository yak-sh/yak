import { timed } from './timing.ts'

/** The job can be retried on a different container. */
export let REPLACED = 503
let OUTGREW = 507
let WARM = 120_000
let PORT = 8080
let READY = 20_000
let POLL = 300

/** The native container operations the compiler needs. */
export type Container = {
  readonly running: boolean
  start(options: { enableInternet: boolean }): void
  setInactivityTimeout(ms: number): Promise<void>
  getTcpPort(port: number): { fetch(request: Request): Promise<Response> }
  monitor(): Promise<void>
}

let pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
let message = (e: unknown) => e instanceof Error ? e.message : String(e)

let exitCode = async (container: Container) => {
  try {
    await container.monitor()
  } catch (error) {
    return typeof error == 'number'
      ? error
      : (error as { exitCode?: number } | null)?.exitCode
  }
}

// An exit lookup is useful only after a broken request and a stopped
// container. Monitoring a running container pins its Durable Object.
let failure = async (container: Container, error: unknown) => {
  if (!container.running && await exitCode(container) == 137) {
    return new Response(
      `the compiler's container was killed: ${message(error)}`,
      {
        status: OUTGREW,
      },
    )
  }
  return new Response(message(error), { status: REPLACED })
}

/** Keep the compiler warm with the runtime's idle timeout. Only a caller
 * starting or using the compiler holds its Durable Object awake. */
export let compiler = (container: Container, now = Date.now, wait = pause) => {
  let prepared = false
  let opening: Promise<number | undefined> | undefined

  let port = () => container.getTcpPort(PORT)
  let listening = async () => {
    let until = now() + READY
    let running = container.running
    for (;;) {
      try {
        // Any HTTP response confirms the port is ready. The compiler only
        // accepts POST, so this probe never starts a job.
        let response = await port().fetch(
          new Request('http://compiler/', {
            method: 'HEAD',
            signal: AbortSignal.timeout(POLL * 3),
          }),
        )
        await response.body?.cancel()
        return
      } catch (error) {
        // Allocation can still be pending on the first probe. Once we saw
        // the container running, an exit ends this startup attempt.
        let alive = container.running
        if ((running && !alive) || now() >= until) throw error
        running = alive
        await wait(POLL)
      }
    }
  }
  let open = async () => {
    let cold = !container.running
    if (cold) container.start({ enableInternet: true })
    await container.setInactivityTimeout(WARM)
    await listening()
    prepared = true
    return cold ? now() : undefined
  }
  let ready = () => {
    if (opening) return opening
    if (prepared && container.running) return
    return opening = open().finally(() => opening = undefined)
  }

  return async (request: Request): Promise<Response> => {
    let began = now()
    let started, answer
    try {
      started = await ready()
      answer = await port().fetch(request)
    } catch (error) {
      prepared = false
      if (request.signal.aborted) throw error
      return await failure(container, error)
    }
    return timed(answer, {
      container: now() - began,
      ...started == null ? {} : { start: Math.max(0, started - began) },
    })
  }
}
