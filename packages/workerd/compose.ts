// A Worker made from a config: the plugins it names, each contributing a
// `./worker` facet, composed into the module's default export and the
// classes the runtime constructs by name. Exported as `@yaks/workerd/compose`
// as well, which imports nothing of @yaks/api but its route matching: a
// Worker's entry evaluates this module on every cold start.
//
// A Worker resolves no module at run time, so the facets arrive already
// imported, by plugin (gen.ts writes that module from the config). Each facet
// is small and eager; what it answers with loads on its first call, so a cold
// isolate evaluates only the code of whatever woke it.
//
// Bindings arrive with each call rather than at import, so every factory is
// handed the Worker's env, and a plugin's options are read from it the way a
// host reads them (@yaks/host/config `revealed`): `{"binding": "AI"}` is the
// binding, `{"secret": "KEY"}` the secret. What is built from one env is kept
// for as long as that env object is.
import { type Route, routed } from '@yaks/api/routed'
import {
  type Config,
  given,
  holding,
  type Options,
  revealed,
  used,
} from '@yaks/host/config'
import { deferred, type Made } from './deferred.ts'
import type { Context, Env } from './worker.ts'

/** The boundary every invocation enters: the Worker's own handlers, and each
 * call of a class whose calls are {@link Deferred.entered}. It runs `run` and
 * answers what it answers; a tracker reports what escapes it. */
export type Entry = <T>(
  env: Env,
  name: string,
  run: () => Promise<T>,
  request?: Request,
) => Promise<T>

/** A class the runtime constructs by its name (a Durable Object, an
 * entrypoint), made at once and loaded on its first call. */
export type Deferred = {
  /** the runtime's class it extends: `DurableObject` or `WorkerEntrypoint`
   * from `cloudflare:workers`, or `Object` for one called only by `fetch`
   * and the runtime's own callbacks */
  base: new (...args: never[]) => object
  /** the methods it answers; each is the loaded object's own */
  methods: readonly string[]
  /** what makes the object, from the runtime's arguments: its state or
   * context, and the env */
  load: () => Promise<Made>
  /** whether each call enters {@link Entry} as `<Name> <method>` */
  entered?: boolean
}

/** A route a plugin adds to a Worker. Its answer may be `null`: the request
 * is not its after all (a hostname it does not serve, a door it does not
 * know), and the router asks the next route. */
export type WorkerRoute = Omit<Route, 'handle'> & {
  handle: (request: Request) => Response | null | Promise<Response | null>
}

/** What a plugin puts around the routes from its own on: it is handed each
 * request and `next`, which asks those routes, and answers what it decides.
 * A wrap may hand `next` another request, or answer without asking it. */
export type Wrap = (
  request: Request,
  next: (request: Request) => Promise<Response>,
) => Promise<Response>

/** A handler of the Worker's default export other than `fetch`: one letter
 * Email Routing handed it, or one batch a queue delivered. */
export type Handling = (given: never, ctx: Context) => Promise<void>

/** `<plugin>/worker` — what a plugin adds to a Worker. Every field is
 * optional. A factory is given the plugin's options, read from the env, and
 * the env itself, for code that is not yet given its bindings as options. */
export type WorkerFacet = {
  /** the classes it defines, by the name wrangler.toml binds */
  classes?: Record<string, Deferred>
  /** the paths it answers. The router asks each plugin in the config's
   * order, and a request takes the first route that matches it and answers. */
  routes?: (options: Options, env: Env) => WorkerRoute[]
  /** what it puts around its own routes and every later plugin's */
  wrap?: (options: Options, env: Env) => Wrap
  /** the letters handed to the Worker; at most one plugin answers them */
  email?: (options: Options, env: Env) => Handling
  /** the batches a queue delivers; at most one plugin answers them */
  queue?: (options: Options, env: Env) => Handling
  /** the boundary every invocation enters; at most one plugin gives it */
  entry?: () => Promise<Entry>
}

/** A Worker module: its default export, and its classes by name. */
export type Composed = {
  default: {
    fetch: (request: Request, env: Env, ctx?: Context) => Promise<Response>
    email?: (message: unknown, env: Env, ctx: Context) => Promise<void>
    queue?: (batch: unknown, env: Env, ctx: Context) => Promise<void>
  }
  classes: Record<string, new (...args: unknown[]) => object>
}

// Memoized per env object, retried after a failure.
let per = <T>(make: (env: Env) => T) => {
  let held = new WeakMap<Env, T>()
  return (env: Env) => {
    if (!held.has(env)) held.set(env, make(env))
    return held.get(env)!
  }
}

// The one facet field at most one plugin may give.
let single = <K extends keyof WorkerFacet>(
  named: [string, WorkerFacet][],
  key: K,
): [string, NonNullable<WorkerFacet[K]>] | undefined => {
  let giving = named.filter(([, f]) => f[key])
  if (giving.length > 1) {
    throw new Error(
      `${giving.map(([p]) => p).join(' and ')} both give a Worker its ${key}`,
    )
  }
  let [one] = giving
  return one && [one[0], one[1][key]!]
}

/**
 * The Worker `config` names, from each plugin's `./worker` facet in `facets`.
 *
 * ```ts
 * import { compose } from '@yaks/workerd'
 * import { equal } from '@yaks/testing'
 *
 * let yak = compose({ plugins: ['hello'] }, {
 *   hello: {
 *     routes: () => [{
 *       method: 'GET',
 *       path: '/',
 *       handle: () => new Response('hello'),
 *     }],
 *   },
 * })
 * let res = await yak.default.fetch(new Request('https://x.test/'), {})
 * equal(await res.text(), 'hello')
 * ```
 */
export let compose = (
  config: Config,
  facets: Record<string, WorkerFacet>,
): Composed => {
  let plugs = config.plugins ?? []
  let named = plugs.map((plug): [string, WorkerFacet] => {
    let facet = facets[used(plug)]
    if (!facet) throw new Error(`no ./worker facet for ${used(plug)}`)
    return [used(plug), facet]
  })
  let options = (plugin: string, env: Env) =>
    revealed(
      given(plugs.find((p) => used(p) == plugin)!),
      holding(env),
    ) as Options

  let giving = single(named, 'entry')
  let loading: Promise<Entry> | undefined
  let entry: Entry = async (env, name, run, request) => {
    if (!giving) return await run()
    let enter = await (loading ??= giving[1]().catch((e) => {
      loading = undefined
      throw e
    }))
    return await enter(env, name, run, request)
  }

  let classes: Composed['classes'] = {}
  for (let [plugin, facet] of named) {
    for (let [name, c] of Object.entries(facet.classes ?? {})) {
      if (classes[name]) throw new Error(`${plugin} defines ${name} again`)
      classes[name] = deferred(
        c.base,
        c.load,
        c.methods,
        c.entered
          ? (args, method, call, given) =>
            entry(
              args[1] as Env,
              `${name} ${method}`,
              call,
              given.find((g): g is Request => g instanceof Request),
            )
          : undefined,
      )
    }
  }

  // Each plugin's routes and wrap, from the last plugin's to the first, so
  // that a request asks the plugins in the config's order and a wrap is
  // around its own routes and every later plugin's.
  let answer = per((env) =>
    named.reduceRight<(request: Request) => Promise<Response>>(
      (next, [plugin, f]) => {
        let routes = f.routes?.(options(plugin, env), env) ?? []
        let ask = async (request: Request) => {
          let path = new URL(request.url).pathname
          for (let route of routes) {
            if (!routed(route as Route, request.method, path)) continue
            let answered = await route.handle(request)
            if (answered) return answered
          }
          return await next(request)
        }
        let wrap = f.wrap?.(options(plugin, env), env)
        return wrap ? (request) => wrap(request, ask) : ask
      },
      () => Promise.resolve(new Response('Not found', { status: 404 })),
    )
  )
  let fetch = (request: Request, env: Env) =>
    entry(env, 'gateway fetch', () => answer(env)(request), request)

  let handling = (key: 'email' | 'queue') => {
    let one = single(named, key)
    if (!one) return undefined
    let [plugin, make] = one
    let made = per((env) => make(options(plugin, env), env))
    return (given: unknown, env: Env, ctx: Context) =>
      entry(env, `gateway ${key}`, () => made(env)(given as never, ctx))
  }
  let email = handling('email'), queue = handling('queue')

  return {
    default: { fetch, ...email && { email }, ...queue && { queue } },
    classes,
  }
}
