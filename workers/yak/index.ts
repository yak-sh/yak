// The kernel Worker's entry: what only the runtime can load — the Durable
// Object classes each binding names, the Files, Site, Outbound and
// SandboxOutbound entrypoints, and the tracker around all of them — and
// nothing that decides where a request goes; that is the router (kernel.ts).
//
// Nothing here imports the code it runs (T-148770). Each class loads its own
// module when the runtime first calls it, and a module is evaluated when it is
// first imported: an isolate that wakes a Store evaluates the Store's code, one
// that answers a page from Site evaluates Site's, and neither the other's.
// The legacy module registry loads them (wrangler.toml, T-148980).
// The Store Durable Object (graph.ts) is its own module, and so are the Wire
// object (stream.ts), which holds a person's open agent stream, and the
// Builder (build.ts), which holds a space's build conversation.
import {
  DurableObject,
  RpcTarget,
  waitUntil,
  WorkerEntrypoint,
} from 'cloudflare:workers'
import type { Caller } from '@yaks/egress'
import type { entry as tracked } from './defects-runtime.ts'
import type { Env, Inbound } from './env.ts'
import type { builds as built } from './builds.ts'
import type { Lent } from './kernel.ts'
import { type Purged, purger } from './purge.ts'
import type { Asked, Heard } from './outlast.ts'
import type { Lexicon as Lexical } from './lexicon.ts'
import type { Conversion } from './arrival.ts'
import type { Inference, InferenceReceipt, Mark } from '@yaks/model'
import { deferred } from './deferred.ts'

// The tracker's boundary (defects-runtime.ts), loaded with the first call it
// wraps.
let entry = async <T>(
  ...args: Parameters<typeof tracked<T | Promise<T>>>
): Promise<T> => (await import('./defects-runtime.ts')).entry(...args)

let instrumented = async <C>(load: Promise<C>) =>
  (await import('./defects-runtime.ts')).instrument(await load)

// Agent entrypoints share the same isolated code evaluator, loaded with the
// first of them.
let agentEnv = async () => {
  let { evaluator } = await import('./code-runtime.ts')
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

// What each deferred object answers: its class's own methods, every one of
// which the tracker wraps (defects-runtime.ts `instrument`). index_test.ts
// holds each list to its class.
export let STORE = [
  'tick',
  'alarm',
  'fetch',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',
] as const
export let WIRE = [
  'log',
  'warm',
  'cool',
  'drop',
  'crossed',
  'released',
  'roster',
  'said',
  'listed',
  'keep',
  'attach',
  'tell',
  'fetch',
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
] as const
export let WORKSPACES = ['fork', 'retire', 'destroy'] as const
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
] as const

// The Store, at every address the binding names — the directory at
// `yak/platform` and every app's own beside it (T-33815). It carries the DO's
// own name, so wrangler's migration list never moves — the name is the one the
// fleet-shaped object it replaced wore, and that object is gone (T-33807).
//
// Each object is wrapped for tracker reporting (defects.ts): what one throws past its own
// catch, and what it reports itself, is a defect we hear about.
export let Store = deferred(
  Object,
  () => instrumented(import('./graph.ts').then((m) => m.Store)),
  STORE,
)
export let Wire = deferred(
  Object,
  () => instrumented(import('./stream.ts').then((m) => m.Wire)),
  WIRE,
)
export let Builder = deferred(
  Object,
  async () => {
    let [Built, agent] = await Promise.all([
      instrumented(import('./build.ts').then((m) => m.Builder)),
      agentEnv(),
    ])
    return class extends Built {
      constructor(ctx: ConstructorParameters<typeof Built>[0], env: Env) {
        super(ctx, agent(env))
      }
    }
  },
  BUILDER,
)
export let Workspaces = deferred(
  DurableObject,
  () => import('./workspaces.ts').then((m) => m.WorkspaceStore),
  WORKSPACES,
)

// The kernel's cached file entrypoint (cache.ts, wrangler.toml
// `[exports.Files]`). The default entrypoint below is
// the gateway: it runs on every request, because the cache key does not
// include the hostname and every space is a hostname — caching there would
// serve one space's bytes to another's visitors. This one is addressed by the
// app's eid and answers bytes, so it is safe to share and worth caching.
//
// It is reached only through the `FILES` service binding (env.ts). The routes
// in wrangler.toml name the default entrypoint, so nothing from the internet
// arrives here.
//
// Wrapped for tracker reporting like the objects above: an unexpected failure in this
// entrypoint reaches the same reporter as one in the gateway.
export class Files extends WorkerEntrypoint {
  // The runtime sets this; `declare` names its type without emitting a field
  // that would shadow what the base class already put there. env.ts keeps the
  // Cloudflare types out of this Worker, so the base's own generic is not
  // resolved here.
  declare env: Env

  fetch(req: Request): Promise<Response> {
    return entry(
      this.env,
      'Files fetch',
      async () => (await import('./files.ts')).fetch(req, this.env),
      req,
    )
  }
}

// Only the gateway reaches this entrypoint, and only with canonical apex
// paths and no caller credentials. Its cache holds the public listing pages;
// the review and identity doors remain on the uncached default entrypoint.
//
// `purge` is how a page leaves that cache (purge.ts): an RPC, which the cache
// never answers, and the only place a purge of Site's own cache can be made,
// since a purge reaches just the entrypoint that calls it. The Purger below
// calls it through the SITE binding, for every write that changes a page.
export class Site extends WorkerEntrypoint {
  declare env: Env
  declare ctx: { cache?: Purging }

  fetch(req: Request): Promise<Response> {
    return entry(
      this.env,
      'Site fetch',
      async () => (await import('./site.ts')).fetch(req, this.env),
      req,
    )
  }

  purge(tags: string[]): Promise<Purged> {
    return entry(this.env, 'Site purge', async () => {
      // Site is only ever bound where its cache is on (wrangler.toml), so a
      // purge with no cache to reach is a failure to hear about.
      if (!this.ctx.cache) {
        return {
          success: false,
          errors: [{ code: 0, message: 'Site has no cache to purge' }],
        }
      }
      let { success, errors } = await this.ctx.cache.purge({ tags })
      return {
        success,
        errors: errors.map(({ code, message }) => ({ code, message })),
      }
    })
  }
}

// What the runtime lends an entrypoint whose cache is on (wrangler.toml).
type Purging = { purge(o: { tags: string[] }): Promise<Purged> }

// The one object every purge goes through (purge.ts `purge`): Cloudflare keeps
// one purge budget for the whole account, so it is spent in one place, and
// the tags owed while a purge waits for its token ride with it. Site's
// `purge` is called as a method of the binding, never through `call` or
// `apply`: an RPC stub answers every property as a method of the far side.
export class Purger extends DurableObject<Env> {
  declare env: Env
  #purge = purger({ purge: (tags) => this.env.SITE!.purge!(tags) })

  purge(tags: string[], spread = false): Promise<void> {
    return this.#purge(tags, spread)
  }
}

// A call that outlasts its caller (outlast.ts, outlast-object.ts): one object per
// caller, tool and target, which finishes the call after the door answered
// that it is still running.
export class Outlast extends DurableObject<Env> {
  declare env: Env
  #call?: Promise<(asked: Asked) => Promise<Heard>>

  call(asked: Asked): Promise<Heard> {
    this.#call ??= import('./outlast-object.ts').then((m) =>
      m.outlast(this.ctx.storage, this.env)
    )
    return entry(
      this.env,
      'Outlast call',
      async () => (await this.#call!)(asked),
    )
  }
}

// Every app store's lexicon (lexicon.ts): which stores a search could find
// anything in, asked instead of the stores themselves.
export class Lexicon extends DurableObject<Env> implements Lexical {
  declare env: Env
  #lexicon?: Promise<Lexical>
  get #held() {
    return this.#lexicon ??= import('./lexicon.ts').then((m) =>
      m.lexicon(this.ctx.storage)
    )
  }

  admit(asked: { store: string; fields: string }[], words: string) {
    return entry(
      this.env,
      'Lexicon admit',
      async () => (await this.#held).admit(asked, words),
    )
  }
  grow(store: string, fields: string, words: string[]) {
    return entry(
      this.env,
      'Lexicon grow',
      async () => (await this.#held).grow(store, fields, words),
    )
  }
  put(store: string, fields: string, words: string[]) {
    return entry(
      this.env,
      'Lexicon put',
      async () => (await this.#held).put(store, fields, words),
    )
  }
  forget(store: string) {
    return entry(
      this.env,
      'Lexicon forget',
      async () => (await this.#held).forget(store),
    )
  }
}

// What yak-front (front/) owes for a page it answered from the edge: the app was
// used, and its store starts for the page's scripts. That Worker holds no door
// onto a store, so it hands both here, behind the response it has already
// sent. RPC, which the cache never answers. Each call answers once its work is
// sent and held: an invocation ends with its call, and work begun after it
// returned was cut off with it, a third of the page views' wakes (T-150366).
export class Uses extends WorkerEntrypoint {
  declare env: Env

  used(eid: string): Promise<void> {
    return entry(
      this.env,
      'Uses used',
      async () =>
        (await import('./used.ts')).scheduleUse(this.env, eid, waitUntil),
    )
  }

  wake(store: string): Promise<void> {
    return entry(
      this.env,
      'Uses wake',
      async () => (await import('./used.ts')).wake(this.env, store, waitUntil),
    )
  }
}

// What yak-front owes an ad network for a page it answered from the edge: the
// conversion it saw (ads.ts), told behind the response it has already sent.
export class Ads extends WorkerEntrypoint {
  declare env: Env

  told(c: Conversion): Promise<void> {
    return entry(
      this.env,
      'Ads told',
      async () => (await import('./ads.ts')).told(this.env, c),
    )
  }
}

// An app's worker calling out (outbound.ts): the namespace's outbound Worker,
// yak-out (outbound/), hands each fetch back here with the CALLER dispatch.ts
// said. Reached only through that service binding, as `Files` is through its
// own; the routes name the default entrypoint. It answers RPC and no fetch, so
// the cache (wrangler.toml `[cache]`) has nothing of it to hold.
export class Outbound extends WorkerEntrypoint {
  declare env: Env

  send(req: Request, caller: Caller): Promise<Response> {
    return entry(
      this.env,
      'Outbound send',
      async () =>
        (await import('./outbound.ts')).outbound(req, this.env, caller),
      req,
    )
  }
}

// A sandbox container's calls to this platform and its spaces, handed here by
// yak-sandbox (sandbox/index.ts), which holds the container but not the secret
// its placeholder is swapped with (sandbox.ts `swapped`). No route reaches it.
export class SandboxOutbound extends WorkerEntrypoint {
  declare env: Env

  send(req: Request, container: string): Promise<Response> {
    return entry(
      this.env,
      'SandboxOutbound send',
      async () =>
        (await import('./sandbox.ts')).swapped(this.env, container, req),
      req,
    )
  }
}

let hosting = async (env: Env) => (await import('./inference.ts')).hosting(env)

// No public route reaches this entrypoint. Each executor callback is vouched
// again against the ask and its immutable private request before doing work.
export class ModelHost extends WorkerEntrypoint {
  declare env: Env
  submitted(job: Inference) {
    return entry(
      this.env,
      'ModelHost submitted',
      async () => (await hosting(this.env)).submitted(job),
    )
  }
  claim(job: Inference) {
    return entry(
      this.env,
      'ModelHost claim',
      async () => (await hosting(this.env)).claim(job),
    )
  }
  checkpoint(job: Inference, mark: Mark) {
    return entry(
      this.env,
      'ModelHost checkpoint',
      async () => (await hosting(this.env)).checkpoint(job, mark),
    )
  }
  grants(job: Inference) {
    return entry(
      this.env,
      'ModelHost grants',
      async () => (await hosting(this.env)).grants(job),
    )
  }
  delivered(job: Inference) {
    return entry(
      this.env,
      'ModelHost delivered',
      async () => (await hosting(this.env)).delivered(job),
    )
  }
  report(job: Inference, failure: NonNullable<InferenceReceipt['failure']>) {
    return entry(
      this.env,
      'ModelHost report',
      async () => (await hosting(this.env)).report(job, failure),
    )
  }
}

// The Worker itself: the router's handler (kernel.ts), wrapped for the tracker
// (defects.ts), so an exception that escapes the router's catch, or the letter
// door's, is a defect we hear about. The queue is Workers Builds telling us a
// build of this Worker failed (builds.ts).
let handler = async () => (await import('./kernel.ts')).handler

export default {
  fetch: (req: Request, env: Env) =>
    entry(env, 'gateway fetch', async () => {
      let [route, agent] = await Promise.all([handler(), agentEnv()])
      return route.fetch(req, agent(env))
    }, req),
  email: (message: Inbound, env: Env, ctx?: Lent) =>
    entry(
      env,
      'email',
      async () => (await handler()).email(message, env, ctx ?? { waitUntil }),
    ),
  queue: (batch: Parameters<typeof built>[0], env: Env) =>
    entry(
      env,
      'build queue',
      async () => (await import('./builds.ts')).builds(batch, env),
    ),
}

// Independent of yak/platform: only a missed directory deadline reads here
// (public-directory.ts).
export let PublicDirectory = deferred(
  DurableObject,
  () =>
    instrumented(
      import('./public-directory.ts').then((m) => m.PublicDirectoryStore),
    ),
  PUBLIC_DIRECTORY,
)
