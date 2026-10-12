// Runtime-only tracker reporting probe. Its queue has the same send interface
// as ERRORS and delivers to the run's capture door, never a public tracker.
import { DurableObject } from 'cloudflare:workers'
import type { Bundle } from '@yaks/graph'
import { caught } from './defects.ts'
import { entry, instrument } from './defects-runtime.ts'
import type { Env } from './env.ts'
import { doorOf } from './door.ts'
import { type State, Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'

type Bindings = Env & {
  CAPTURE_URL: string
  PROBE: ProbeNamespace
  STORECASE: ProbeNamespace
}
type ProbeNamespace = {
  getByName(name: string): {
    fetch(request: Request): Promise<Response>
    fail(): Promise<void>
  }
}
let bindings = (env: Bindings): Bindings => ({
  ...env,
  ERRORS: {
    async send(rows: Bundle[]) {
      let response = await fetch(`${env.CAPTURE_URL}/tracker-probe`, {
        method: 'POST',
        body: JSON.stringify(rows),
      })
      if (!response.ok) throw Error('tracker probe capture unavailable')
    },
  },
})
class ObjectProbe extends DurableObject {
  constructor(
    ctx: ConstructorParameters<typeof DurableObject>[0],
    env: Bindings,
  ) {
    super(ctx, env)
    caught(Error('object construction failure'), { request: 'constructor' })
  }
  fetch() {
    caught(Error('caught object failure'), { request: 'object fetch' })
    return Promise.resolve(new Response('answered', { status: 500 }))
  }
  fail() {
    throw Error('escaping RPC failure')
  }
}
// The runtime hands the constructor its own env; the queue is built before
// the reporting boundary constructs the object or runs one of its methods.
let Tracked = instrument(ObjectProbe)
export class Probe extends Tracked {
  constructor(
    ctx: ConstructorParameters<typeof DurableObject>[0],
    env: Bindings,
  ) {
    super(ctx, bindings(env))
  }
}

export class StoreCases extends DurableObject {
  constructor(private state: State, private env: Bindings) {
    super(
      state as unknown as ConstructorParameters<typeof DurableObject>[0],
      env,
    )
  }
  fetch(req: Request): Promise<Response> {
    return entry(bindings(this.env), 'store probe', async () => {
      let store = new Store(this.state)
      let door = doorOf((r) => store.fetch(r), 'ada/notes')
      await door('/vocab', { method: 'POST', body: '{}' }, KERNEL)
      if (new URL(req.url).pathname.includes('/alarm/')) {
        await store.alarm({ isRetry: true, retryCount: 1 })
        await store.alarm({ isRetry: true, retryCount: 2 })
        await store.alarm()
        return Response.json({ retried: true })
      }
      let statuses: number[] = []
      let eid = crypto.randomUUID()
      for (let path of ['/apply', '/apply?check=1', '/vocab']) {
        let sent = false
        let stream = new ReadableStream<Uint8Array>({
          pull: (c) => {
            if (!sent) {
              sent = true
              c.enqueue(new TextEncoder().encode(JSON.stringify([{
                entity: { eid },
                doc: { title: 'Interrupted upload' },
              }])))
            } else {
              c.error(
                new TypeError(
                  "Can't read from request stream because client disconnected.",
                ),
              )
            }
          },
        })
        let response = await door(
          path,
          { method: 'POST', body: stream },
          KERNEL,
        )
        statuses.push(response.status)
        await response.body?.cancel()
      }
      return Response.json({
        statuses,
        rows: await metaOf(door).query(`.entity.eid=${eid}`),
        writes: await (await door('/writes', {}, KERNEL)).json(),
      })
    })
  }
}
export default {
  fetch(req: Request, env: Bindings) {
    let id = new URL(req.url).pathname.split('/').pop()!
    if (/\/__defects\/(?:upload|alarm)\//.test(req.url)) {
      return env.STORECASE.getByName(id).fetch(req)
    }
    return entry(bindings(env), 'probe gateway', async () => {
      caught(Error('caught gateway failure'), { request_id: id })
      let object = env.PROBE.getByName(id)
      let response = await object.fetch(req)
      await response.body?.cancel()
      await object.fail().catch(() => {})
      return new Response('answered', { status: 500 })
    })
  },
}
