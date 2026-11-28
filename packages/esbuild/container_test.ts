import { equal, test } from '@yaks/testing'
import { compiler, type Container, REPLACED } from './container.ts'

let host = (fetch: (req: Request) => Promise<Response>, running = false) => {
  let starts = 0, limits: number[] = [], monitored = 0
  let exit: unknown
  let container: Container = {
    get running() {
      return running
    },
    start({ enableInternet }) {
      equal(enableInternet, true)
      starts++
      running = true
    },
    setInactivityTimeout: (ms) => Promise.resolve(void limits.push(ms)),
    getTcpPort: (port) => {
      equal(port, 8080)
      return { fetch }
    },
    monitor: () => {
      monitored++
      if (running) {
        throw new Error('watching a running container holds it awake')
      }
      return exit == null ? Promise.resolve() : Promise.reject(exit)
    },
  }
  return {
    container,
    stop: (cause?: unknown) => {
      running = false
      exit = cause
    },
    seen: () => ({ starts, limits, monitored }),
  }
}

let job = (text = 'job') =>
  new Request('http://compiler/', { method: 'POST', body: text })

test('concurrent compiler jobs share startup and reuse a warm container', async () => {
  let probes = 0
  let machine = host(async (req) => {
    if (req.method == 'HEAD') {
      if (++probes == 1) throw new Error('port is starting')
      return new Response(null, { status: 405 })
    }
    return new Response(await req.text())
  })
  let now = 0
  let compile = compiler(machine.container, () => now, (ms) => {
    now += ms
    return Promise.resolve()
  })
  let [a, b] = await Promise.all([compile(job('a')), compile(job('b'))])
  let c = await compile(job('c'))
  equal(await Promise.all([a.text(), b.text(), c.text()]), ['a', 'b', 'c'])
  equal(machine.seen(), { starts: 1, limits: [120_000], monitored: 0 })
  equal(probes, 2)
  equal(a.headers.get('server-timing')?.includes('compiler_start'), true)
  equal(c.headers.get('server-timing')?.includes('compiler_start'), false)

  // A new object incarnation still finds and uses the warm container.
  let d = await compiler(machine.container)(job('d'))
  equal(await d.text(), 'd')
  equal(machine.seen(), {
    starts: 1,
    limits: [120_000, 120_000],
    monitored: 0,
  })
})

test('the compiler preserves its HTTP errors and distinguishes a stopped container from a killed one', async () => {
  let machine = host((req) => {
    if (req.method == 'HEAD') return Promise.resolve(new Response(null))
    return req.text().then((mode) => {
      if (mode == 'refusal') {
        return new Response('esbuild killed', { status: 507 })
      }
      if (mode == 'killed') machine.stop({ exitCode: 137 })
      if (mode == 'replaced') machine.stop()
      throw new Error('connection lost')
    })
  })
  let compile = compiler(machine.container)
  let refusal = await compile(job('refusal'))
  equal([refusal.status, await refusal.text(), machine.seen().monitored], [
    507,
    'esbuild killed',
    0,
  ])
  equal((await compile(job('connection'))).status, REPLACED)
  equal(machine.seen().monitored, 0)
  equal((await compile(job('replaced'))).status, REPLACED)
  equal((await compile(job('killed'))).status, 507)
  equal(machine.seen().monitored, 2)
})
