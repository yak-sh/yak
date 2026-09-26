// The kernel Worker's entry: the router (kernel.ts) as the runtime loads it.
// What is here is what only the runtime can load — the Durable Object classes
// each binding names, the Sandbox container, the Files and Outbound
// entrypoints, and Sentry around all of them — and nothing that decides where
// a request goes. The Store Durable Object (graph.ts) is its own module: a DO
// may live in a different Worker from the one that binds it, and so are the
// Wire object (stream.ts), which holds a person's open agent stream, and the
// Builder (build.ts), which holds a space's build conversation.
import { waitUntil, WorkerEntrypoint } from 'cloudflare:workers'
import { Sandbox as Workbench } from '@cloudflare/sandbox'
import type { Caller } from '@yaks/egress'
// @ts-types="./sentry.d.ts"
import {
  instrumentDurableObjectWithSentry,
  withSentry,
} from '@sentry/cloudflare'
import { Builder as Built } from './build.ts'
import { Store as Stored } from './graph.ts'
import { options } from './sentry.ts'
import { Wire as Wired } from './stream.ts'
import * as filePart from './files.ts'
import { builds } from './builds.ts'
import type { Env, Inbound } from './env.ts'
import { handler, type Lent } from './kernel.ts'
import { egress } from './sandbox.ts'
import { outbound } from './outbound.ts'

// The Store, at every address the binding names — the directory at
// `yak/platform` and every app's own beside it (T-33815). It carries the DO's
// own name, so wrangler's migration list never moves — the name is the one the
// fleet-shaped object it replaced wore, and that object is gone (T-33807).
//
// Each object is wrapped for Sentry (sentry.ts): what one throws past its own
// catch, and what it reports itself, is a defect we hear about.
export let Store = instrumentDurableObjectWithSentry(options, Stored)
export let Wire = instrumentDurableObjectWithSentry(options, Wired)
export let Builder = instrumentDurableObjectWithSentry(options, Built)

// The builder's workbench (sandbox.ts, T-34264): Cloudflare's own Sandbox
// Durable Object, whose container the deploy builds from
// workers/yak/sandbox/Dockerfile. This is the one place the package is named
// as a value — it imports `cloudflare:workers`, which only the runtime can
// load, and sandbox.ts types the binding instead so every test can reach the
// tools that use it.
//
// Its network is closed but for the registries a build installs from
// (sandbox.ts `egress`, T-37883): the container starts with no internet, and
// every HTTP and HTTPS request it makes is handed to `ContainerProxy`, which
// lets an allowed host through and answers 520 to the rest. The SDK puts the
// interception's certificate authority in the container's trust store itself.
// The class keeps the SDK's name, since the Durable Object binding and its
// migration are keyed by it.
export { ContainerProxy } from '@cloudflare/sandbox'
export class Sandbox extends Workbench<Env> {
  override enableInternet = false
  override interceptHttps = true
  constructor(...made: ConstructorParameters<typeof Workbench<Env>>) {
    super(...made)
    this.allowedHosts = egress(made[1])
  }
}

// The kernel's second entrypoint, and the only one with a cache in front of it
// (cache.ts, wrangler.toml `[exports.Files]`). The default entrypoint below is
// the gateway: it runs on every request, because the cache key does not
// include the hostname and every space is a hostname — caching there would
// serve one space's bytes to another's visitors. This one is addressed by the
// app's eid and answers bytes, so it is safe to share and worth caching.
//
// It is reached only through the `FILES` service binding (env.ts). The routes
// in wrangler.toml name the default entrypoint, so nothing from the internet
// arrives here.
//
// Wrapped for Sentry like the objects above: it is its own invocation, so a
// defect it reports itself (a cache purge that failed, cache.ts) has no client
// to reach otherwise.
class Filed extends WorkerEntrypoint {
  // The runtime sets this; `declare` names its type without emitting a field
  // that would shadow what the base class already put there. env.ts keeps the
  // Cloudflare types out of this Worker, so the base's own generic is not
  // resolved here.
  declare env: Env

  fetch(req: Request): Promise<Response> {
    return filePart.fetch(req, this.env)
  }
}
export let Files = withSentry(options, Filed)

// An app's worker calling out (outbound.ts): the namespace's outbound Worker,
// yak-out (outbound/), hands each fetch back here with the CALLER dispatch.ts
// said. Reached only through that service binding, as `Files` is through its
// own; the routes name the default entrypoint. It answers RPC and no fetch, so
// the cache (wrangler.toml `[cache]`) has nothing of it to hold.
class Sending extends WorkerEntrypoint {
  declare env: Env

  send(req: Request, caller: Caller): Promise<Response> {
    return outbound(req, this.env, caller)
  }
}
export let Outbound = withSentry(options, Sending)

// The Worker itself: the router's handler (kernel.ts), wrapped for Sentry
// (sentry.ts), so an exception that escapes the router's catch, or the letter
// door's, is a defect we hear about. The queue is Workers Builds telling us a
// build of this Worker failed (builds.ts).
let worker = withSentry(options, {
  ...handler,
  queue: builds,
})

// A letter can arrive with no context: the runtime's own letter door (the one
// `wrangler dev` and the probe post to) calls `email` over RPC, and an object
// export called that way is handed the env alone. The platform's email event
// carries one, so only that door lends the module's own `waitUntil`.
// TODO(T-37921): @sentry/cloudflare's email wrapper reads `ctx.waitUntil`
// unguarded (instrumentEmail.js `wrapEmailHandler`); drop the loan once it
// tolerates an absent context.
export default {
  ...worker,
  email: (message: Inbound, env: Env, ctx?: Lent) =>
    worker.email(message, env, ctx ?? { waitUntil }),
}
