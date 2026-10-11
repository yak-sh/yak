// Runtime retention for tracker delivery and its bounded repeat windows.
import { waitUntil } from 'cloudflare:workers'
import { within } from './defects.ts'
import { origin } from '@yaks/tracker/report'
import type { Env } from './env.ts'

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

export let entry = <T>(
  env: Partial<Env>,
  request: string,
  run: () => T,
  http?: Request,
): T =>
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
    },
  )

/** Construction, lifecycle callbacks and RPC methods share the same reporting
 * boundary. A callback installed by construction retains its invocation scope. */
export let instrument = <C>(Original: C): C => {
  let Base = Original as unknown as new (...args: unknown[]) => object
  let bindings = new WeakMap<object, Partial<Env>>()
  class Tracked extends Base {}
  for (let method of Object.getOwnPropertyNames(Base.prototype)) {
    if (method == 'constructor') continue
    let run = Object.getOwnPropertyDescriptor(Base.prototype, method)?.value
    if (typeof run != 'function') continue
    Object.defineProperty(Tracked.prototype, method, {
      value(this: object, ...args: unknown[]) {
        return entry(
          bindings.get(this) ?? {},
          `${Base.name} ${method}`,
          () => Reflect.apply(run, this, args),
          args.find((arg): arg is Request => arg instanceof Request),
        )
      },
    })
  }
  return new Proxy(Tracked, {
    construct(target, args, newTarget) {
      let env = args[1] as Partial<Env> ?? {}
      return entry(env, `${Base.name} constructor`, () => {
        let object = Reflect.construct(target, args, newTarget)
        bindings.set(object, env)
        return object
      })
    },
  }) as unknown as C
}
