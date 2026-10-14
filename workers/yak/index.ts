// The kernel Worker's entry: the router (kernel.ts) as the runtime loads it.
// What is here is what only the runtime can load — the Durable Object classes
// each binding names, the Sandbox container, the Files, Site and Outbound
// entrypoints, and the tracker around all of them — and nothing that decides where
// a request goes. The Store Durable Object (graph.ts) is its own module: a DO
// may live in a different Worker from the one that binds it, and so are the
// Wire object (stream.ts), which holds a person's open agent stream, and the
// Builder (build.ts), which holds a space's build conversation.
import { waitUntil, WorkerEntrypoint } from 'cloudflare:workers'
import type { Caller } from '@yaks/egress'
import { Builder as Built } from './build.ts'
import { Store as Stored } from './graph.ts'
import { entry, instrument } from './defects-runtime.ts'
import { Wire as Wired } from './stream.ts'
import * as filePart from './files.ts'
import { builds } from './builds.ts'
import type { Env, Inbound } from './env.ts'
import { handler, type Lent } from './kernel.ts'
import { egress } from './sandbox.ts'
export { WorkspaceStore as Workspaces } from './workspaces.ts'
import { outbound } from './outbound.ts'
import * as sitePart from './site.ts'
import { hosting } from './inference.ts'
import type { Inference, InferenceReceipt, Mark } from '@yaks/model'

// The Store, at every address the binding names — the directory at
// `yak/platform` and every app's own beside it (T-33815). It carries the DO's
// own name, so wrangler's migration list never moves — the name is the one the
// fleet-shaped object it replaced wore, and that object is gone (T-33807).
//
// Each object is wrapped for tracker reporting (defects.ts): what one throws past its own
// catch, and what it reports itself, is a defect we hear about.
export let Store = instrument(Stored)
export let Wire = instrument(Wired)
export let Builder = instrument(Built)

// The builder's workbench (sandbox.ts, T-34264): Cloudflare's own Sandbox
// Durable Object, whose container uses the stable toolchain image named in
// wrangler.toml. The live Worker supplies its CLI. This is the one place the package is named
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
//
// The SDK is awaited, not imported (T-37974). Its RPC library makes an Error
// as it loads, and an Error made while the bundle's top-level code is on the
// stack has V8 collect source positions for that whole function: a second
// parse of the 3 MB script, about 80 ms of every isolate's start. Awaited, it
// loads in a microtask with none of the bundle's top level beneath it.
let sdk = await import('@cloudflare/sandbox')
export let ContainerProxy = sdk.ContainerProxy
export class Sandbox extends sdk.Sandbox<Env> {
  override enableInternet = false
  override interceptHttps = true
  constructor(...made: ConstructorParameters<typeof sdk.Sandbox<Env>>) {
    super(...made)
    this.allowedHosts = egress(made[1])
  }
}

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
      () => filePart.fetch(req, this.env),
      req,
    )
  }
}

// Only the gateway reaches this entrypoint, and only with canonical apex
// paths and no caller credentials. Its cache holds the public listing pages;
// the review and identity doors remain on the uncached default entrypoint.
export class Site extends WorkerEntrypoint {
  declare env: Env

  fetch(req: Request): Promise<Response> {
    return entry(
      this.env,
      'Site fetch',
      () => sitePart.fetch(req, this.env),
      req,
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
      () => outbound(req, this.env, caller),
      req,
    )
  }
}

// No public route reaches this entrypoint. Each executor callback is vouched
// again against the ask and its immutable private request before doing work.
export class ModelHost extends WorkerEntrypoint {
  declare env: Env
  submitted(job: Inference) {
    return entry(
      this.env,
      'ModelHost submitted',
      () => hosting(this.env).submitted(job),
    )
  }
  claim(job: Inference) {
    return entry(
      this.env,
      'ModelHost claim',
      () => hosting(this.env).claim(job),
    )
  }
  checkpoint(job: Inference, mark: Mark) {
    return entry(
      this.env,
      'ModelHost checkpoint',
      () => hosting(this.env).checkpoint(job, mark),
    )
  }
  grants(job: Inference) {
    return entry(
      this.env,
      'ModelHost grants',
      () => hosting(this.env).grants(job),
    )
  }
  delivered(job: Inference) {
    return entry(
      this.env,
      'ModelHost delivered',
      () => hosting(this.env).delivered(job),
    )
  }
  report(job: Inference, failure: NonNullable<InferenceReceipt['failure']>) {
    return entry(
      this.env,
      'ModelHost report',
      () => hosting(this.env).report(job, failure),
    )
  }
}

// The Worker itself: the router's handler (kernel.ts), wrapped for the tracker
// (defects.ts), so an exception that escapes the router's catch, or the letter
// door's, is a defect we hear about. The queue is Workers Builds telling us a
// build of this Worker failed (builds.ts).
export default {
  fetch: (req: Request, env: Env) =>
    entry(env, 'gateway fetch', () => handler.fetch(req, env), req),
  email: (message: Inbound, env: Env, ctx?: Lent) =>
    entry(
      env,
      'email',
      () => handler.email(message, env, ctx ?? { waitUntil }),
    ),
  queue: (batch: Parameters<typeof builds>[0], env: Env) =>
    entry(env, 'build queue', () => builds(batch, env)),
}
