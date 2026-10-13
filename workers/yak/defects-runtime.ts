// Runtime retention for tracker delivery and its bounded repeat windows.
import { waitUntil } from 'cloudflare:workers'
import { within } from './defects.ts'
import { origin } from '@yaks/tracker/report'
import type { Env } from './env.ts'
import { learn } from './running.ts'
import { type Own, replaced } from '@yaks/durable-object'

let clock = {
  now: Date.now,
  after: (ms: number, run: () => Promise<void>) => {
    let resolve: () => void
    let pending = new Promise<void>((done) => resolve = done)
    let firing = false
    let timer = setTimeout(() => {
      firing = true
      void run().finally(resolve)
    }, ms)
    waitUntil(pending)
    return () => {
      clearTimeout(timer)
      if (!firing) resolve()
    }
  },
}

// A Durable Object's state, when the invocation is one of its own.
let own = (state: unknown): state is { storage: Own } =>
  typeof (state as { storage?: Own } | undefined)?.storage?.transactionSync ==
    'function'

// Every invocation enters here, the Worker's and each object's, so this is
// also where an isolate learns which deploy it runs (running.ts). An object's
// invocation can ask whether the runtime has since moved it off this instance
// (@yaks/durable-object `replaced`).
export let entry = <T>(
  env: Partial<Env>,
  request: string,
  run: () => T,
  http?: Request,
  state?: unknown,
): T => (
  learn(env.CF_VERSION_METADATA),
    within(
      env,
      { request },
      run,
      clock,
      {
        retain: waitUntil,
        origin: origin(
          env.WORKER_NAME ?? 'yak',
          env.CF_VERSION_METADATA?.id,
          request,
          http,
        ),
        replaced: own(state) ? () => replaced(state.storage) : undefined,
      },
    )
)

/** Construction, lifecycle callbacks and RPC methods share the same reporting
 * boundary. A callback installed by construction retains its invocation scope. */
export let instrument = <C>(Original: C): C => {
  let Base = Original as unknown as new (...args: unknown[]) => object
  // Each object's own constructor arguments: its state and its env.
  let made = new WeakMap<object, { state: unknown; env: Partial<Env> }>()
  class Tracked extends Base {}
  for (let method of Object.getOwnPropertyNames(Base.prototype)) {
    if (method == 'constructor') continue
    let run = Object.getOwnPropertyDescriptor(Base.prototype, method)?.value
    if (typeof run != 'function') continue
    Object.defineProperty(Tracked.prototype, method, {
      value(this: object, ...args: unknown[]) {
        return entry(
          made.get(this)?.env ?? {},
          `${Base.name} ${method}`,
          () => Reflect.apply(run, this, args),
          args.find((arg): arg is Request => arg instanceof Request),
          made.get(this)?.state,
        )
      },
    })
  }
  return new Proxy(Tracked, {
    construct(target, args, newTarget) {
      let [state, env = {}] = args as [unknown, Partial<Env>?]
      return entry(
        env,
        `${Base.name} constructor`,
        () => {
          let object = Reflect.construct(target, args, newTarget)
          made.set(object, { state, env })
          return object
        },
        undefined,
        state,
      )
    },
  }) as unknown as C
}
