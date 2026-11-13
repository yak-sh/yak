// The kernel's `./worker` facet (config.ts `worker`, @yaks/workerd
// `compose`): the classes wrangler.toml binds, the kernel's routes and the
// pipeline around them, the letter door, the build queue and the tracker's
// boundary. It is code still in workers/yak, named by path until each part
// moves to its package.
//
// Nothing here imports the code it runs (T-148770). Each class loads its own
// module when the runtime first calls it, and a module is evaluated when it is
// first imported: an isolate that wakes a Store evaluates the Store's code, one
// that answers a page from Site evaluates Site's, and neither the other's.
// The legacy module registry loads them (wrangler.toml, T-148980).
import {
  DurableObject,
  RpcTarget,
  waitUntil,
  WorkerEntrypoint,
} from 'cloudflare:workers'
import type { Deferred, WorkerFacet } from '@yaks/workerd'
import type { Caller } from '@yaks/egress'
import type { Inference, InferenceReceipt, Mark } from '@yaks/model'
import type { Env, Inbound } from '../env.ts'
import type { Lent } from '../kernel.ts'
import type { Purged } from '../purge.ts'
import type { Asked } from '../outlast.ts'
import type { Conversion } from '../arrival.ts'
import type { builds } from '../builds.ts'

// Agent entrypoints share the same isolated code evaluator, loaded with the
// first of them.
let agentEnv = async () => {
  let { evaluator } = await import('../code-runtime.ts')
  return (env: Env): Env => ({
    ...env,
    ...(env.LOADER
      ? {
        CODE_MODE: evaluator(env.LOADER, (bridge) =>
          new class extends RpcTarget {
            call(set: string, name: string, args: string) {
              return bridge.call(set, name, args)
            }
            read(id: string) {
              return bridge.read(id)
            }
          }()),
      }
      : {}),
  })
}

let instrumented = async <C>(load: Promise<C>) =>
  (await import('../defects-runtime.ts')).instrument(await load)

// A class's object, made the way the runtime constructs it.
type Class = new (...args: never[]) => object
let made = (C: Class) => (...args: never[]) => new C(...args)

// What each deferred object answers: its class's own methods, every one of
// which the tracker wraps (defects-runtime.ts `instrument`, @yaks/tracker/instrument). index_test.ts
// holds each list to its class.
export let STORE = [
  'tick',
  'alarm',
  'fetch',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',
  // @yaks/durable-object `Durable`'s own.
  'specify',
  'open',
  'accept',
  'enter',
  'behind',
] as const
export let WIRE = [
  'log',
  'warm',
  'cool',
  'drop',
  'crossed',
  'roster',
  'said',
  'replies',
  'owe',
  'listed',
  'keep',
  'attach',
  'tell',
  'fetch',
  // @yaks/durable-object `Durable`'s own.
  'alarm',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',
  'specify',
  'open',
  'accept',
  'enter',
  'behind',
] as const
export let BUILDER = [
  'said',
  'wipe',
  'joined',
  'say',
  'fetch',
  'alarm',
  'webSocketMessage',
  'webSocketClose',
  // @yaks/durable-object `Durable`'s own.
  'webSocketError',
  'specify',
  'open',
  'accept',
  'enter',
  'behind',
] as const
export let WORKSPACES = [
  'fork',
  'retire',
  'destroy',
  // @yaks/durable-object `Durable`'s own.
  'fetch',
  'alarm',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',
  'specify',
  'open',
  'accept',
  'enter',
  'behind',
] as const
export let PUBLIC_DIRECTORY = [
  'valid',
  'publish',
  'publishes',
  'read',
  'begin',
  'revision',
  'finish',
  'settle',
  'put',
  'get',
  // @yaks/durable-object `Durable`'s own.
  'fetch',
  'alarm',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',
  'specify',
  'open',
  'accept',
  'enter',
  'behind',
] as const

// An entrypoint or object whose every call enters the tracker's boundary as
// `<Name> <method>`, answered by what `make` returns from its context and env.
let entered = (
  base: Class,
  methods: readonly string[],
  make: (ctx: never, env: Env) => object | Promise<object>,
): Deferred => ({
  base,
  methods,
  entered: true,
  load: () => Promise.resolve(make as never),
})

// What the runtime lends an entrypoint whose cache is on (wrangler.toml).
type Purging = { purge(o: { tags: string[] }): Promise<Purged> }

let hosting = async (env: Env) => (await import('../inference.ts')).hosting(env)

export let classes: Record<string, Deferred> = {
  // The Store, at every address the binding names — the directory at
  // `yak/platform` and every app's own beside it (T-33815). It carries the
  // DO's own name, so wrangler's migration list never moves (T-33807). Each
  // object is wrapped for tracker reporting (defects.ts): what one throws
  // past its own catch, and what it reports itself, is a defect we hear about.
  Store: {
    base: Object,
    methods: STORE,
    load: async () =>
      made(await instrumented(import('../graph.ts').then((m) => m.Store))),
  },
  Wire: {
    base: Object,
    methods: WIRE,
    load: async () =>
      made(await instrumented(import('../stream.ts').then((m) => m.Wire))),
  },
  Builder: {
    base: Object,
    methods: BUILDER,
    load: async () => {
      let [Built, agent] = await Promise.all([
        instrumented(import('../build.ts').then((m) => m.Builder)),
        agentEnv(),
      ])
      return (ctx: ConstructorParameters<typeof Built>[0], env: Env) =>
        new Built(ctx, agent(env))
    },
  },
  Workspaces: {
    base: DurableObject,
    methods: WORKSPACES,
    load: async () =>
      made(
        await instrumented(
          import('../workspaces.ts').then((m) => m.WorkspaceStore),
        ),
      ),
  },
  // Independent of yak/platform: only a missed directory deadline reads here
  // (public-directory.ts).
  PublicDirectory: {
    base: DurableObject,
    methods: PUBLIC_DIRECTORY,
    load: async () =>
      made(
        await instrumented(
          import('../public-directory.ts').then((m) => m.PublicDirectoryStore),
        ),
      ),
  },
  // The one object every purge goes through (purge.ts `purge`): Cloudflare
  // keeps one purge budget for the whole account, so it is spent in one
  // place, and the tags owed while a purge waits for its token ride with it.
  // Site's `purge` is called as a method of the binding, never through `call`
  // or `apply`: an RPC stub answers every property as a method of the far
  // side.
  Purger: {
    base: DurableObject,
    methods: ['purge'],
    load: async () => {
      let { purger } = await import('../purge.ts')
      return (_ctx: unknown, env: Env) => {
        let purge = purger({ purge: (tags) => env.SITE!.purge!(tags) })
        return {
          purge: (tags: string[], spread = false) => purge(tags, spread),
        }
      }
    },
  },
  // A call that outlasts its caller (outlast.ts, outlast-object.ts): one
  // object per caller, tool and target, which finishes the call after the
  // door answered that it is still running.
  Outlast: entered(DurableObject, ['call'], async (ctx: never, env) => {
    let call = (await import('../outlast-object.ts')).outlast(
      (ctx as { storage: never }).storage,
      env,
    )
    return { call: (asked: Asked) => call(asked) }
  }),
  // Every app store's lexicon (lexicon.ts): which stores a search could find
  // anything in, asked instead of the stores themselves.
  Lexicon: entered(
    DurableObject,
    ['admit', 'grow', 'put', 'forget'],
    async (ctx: { storage: never }) =>
      (await import('../lexicon.ts')).lexicon(ctx.storage),
  ),
  // The kernel's cached file entrypoint (cache.ts, wrangler.toml
  // `[exports.Files]`). The default entrypoint is the gateway: it runs on
  // every request, because the cache key does not include the hostname and
  // every space is a hostname. This one is addressed by the app's eid and
  // answers bytes, so it is safe to share and worth caching. It is reached
  // only through the `FILES` service binding (env.ts).
  Files: entered(WorkerEntrypoint, ['fetch'], (_ctx, env) => ({
    fetch: async (req: Request) =>
      (await import('../files.ts')).fetch(req, env),
  })),
  // Only the gateway reaches this entrypoint, and only with canonical apex
  // paths and no caller credentials. Its cache holds the public listing
  // pages. `purge` is how a page leaves that cache (purge.ts): an RPC, which
  // the cache never answers, and the only place a purge of Site's own cache
  // can be made, since a purge reaches just the entrypoint that calls it.
  Site: entered(
    WorkerEntrypoint,
    ['fetch', 'purge'],
    (ctx: { cache?: Purging }, env) => ({
      fetch: async (req: Request) =>
        (await import('../site.ts')).fetch(req, env),
      purge: async (tags: string[]): Promise<Purged> => {
        // Site is only ever bound where its cache is on (wrangler.toml), so
        // a purge with no cache to reach is a failure to hear about.
        if (!ctx.cache) {
          return {
            success: false,
            errors: [{ code: 0, message: 'Site has no cache to purge' }],
          }
        }
        let { success, errors } = await ctx.cache.purge({ tags })
        return {
          success,
          errors: errors.map(({ code, message }) => ({ code, message })),
        }
      },
    }),
  ),
  // What yak-front (front/) owes for a page it answered from the edge: the
  // app was used, and its store starts for the page's scripts. Each call
  // answers once its work is sent and held: an invocation ends with its
  // call, and work begun after it returned was cut off with it (T-150366).
  Uses: entered(WorkerEntrypoint, ['used', 'wake'], async (_ctx, env) => {
    let { scheduleUse, wake } = await import('../used.ts')
    return {
      used: (eid: string) => scheduleUse(env, eid, waitUntil),
      wake: (store: string) => wake(env, store, waitUntil),
    }
  }),
  // What yak-front owes an ad network for a page it answered from the edge:
  // the conversion it saw (ads.ts).
  Ads: entered(WorkerEntrypoint, ['told'], async (_ctx, env) => {
    let { told } = await import('../ads.ts')
    return { told: (c: Conversion) => told(env, c) }
  }),
  // An app's worker calling out (outbound.ts): the namespace's outbound
  // Worker, yak-out (outbound/), hands each fetch back here with the CALLER
  // dispatch.ts said. It answers RPC and no fetch.
  Outbound: entered(WorkerEntrypoint, ['send'], async (_ctx, env) => {
    let { outbound } = await import('../outbound.ts')
    return {
      send: (req: Request, caller: Caller) => outbound(req, env, caller),
    }
  }),
  // A sandbox container's calls to this platform and its spaces, handed here
  // by yak-sandbox (sandbox/index.ts), which holds the container but not the
  // secret its placeholder is swapped with (sandbox.ts `swapped`).
  SandboxOutbound: entered(WorkerEntrypoint, ['send'], async (_ctx, env) => {
    let { swapped } = await import('../sandbox.ts')
    return {
      send: (req: Request, container: string) => swapped(env, container, req),
    }
  }),
  // No public route reaches this entrypoint. Each executor callback is
  // vouched again against the ask and its immutable private request before
  // doing work.
  ModelHost: entered(
    WorkerEntrypoint,
    ['submitted', 'claim', 'checkpoint', 'grants', 'delivered', 'report'],
    async (_ctx, env) => {
      let host = await hosting(env)
      return {
        submitted: (job: Inference) => host.submitted(job),
        claim: (job: Inference) => host.claim(job),
        checkpoint: (job: Inference, mark: Mark) => host.checkpoint(job, mark),
        grants: (job: Inference) => host.grants(job),
        delivered: (job: Inference) => host.delivered(job),
        report: (
          job: Inference,
          failure: NonNullable<InferenceReceipt['failure']>,
        ) => host.report(job, failure),
      }
    },
  ),
}

// The kernel (kernel.ts `kernel`): its hostname pipeline around the apex's
// routes and a space's, and the letter door, loaded on the first request.
// Each env is given the agents' code evaluator once.
let agented = new WeakMap<object, Env>()
let kernel = async (env: Env) => {
  let [k, agent] = await Promise.all([import('../kernel.ts'), agentEnv()])
  if (!agented.has(env)) agented.set(env, agent(env))
  return { k, env: agented.get(env)! }
}

export let wrap: WorkerFacet['wrap'] = (_options, env) => async (req, next) => {
  let { k, env: e } = await kernel(env as Env)
  return k.wrap(req, e, next)
}

export let routes: WorkerFacet['routes'] = (_options, env) =>
  (['atApex', 'atSpace'] as const).map((part) => ({
    method: '*',
    path: '*',
    handle: async (req: Request) => {
      let { k, env: e } = await kernel(env as Env)
      return k[part](req, e)
    },
  }))

export let email: WorkerFacet['email'] =
  (_options, env) => async (message: Inbound, ctx: Lent) => {
    let { k, env: e } = await kernel(env as Env)
    return k.email(message, e, ctx)
  }

// Workers Builds telling us a build of this Worker failed (builds.ts).
export let queue: WorkerFacet['queue'] =
  (_options, env) => async (batch: Parameters<typeof builds>[0]) =>
    (await import('../builds.ts')).builds(batch, env as Env)

export let entry: WorkerFacet['entry'] = async () =>
  (await import('../defects-runtime.ts')).entry
