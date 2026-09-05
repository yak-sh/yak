/// <reference types="npm:@cloudflare/workers-types@^4" />
// The Cloudflare gate (not published — see deno.json). Every Workers type this
// package names is written structurally, so that the shipped source imports
// nothing and `deno check` reads it with no Cloudflare package installed. This
// file is where those hand-written shapes are held against the runtime's own:
// it is checked with `@cloudflare/workers-types` in scope, so a binding here is
// the binding wrangler declares and `ResponseInit` is the one that carries a
// `webSocket`.
//
// Nothing runs. Each line is an assignment the type-checker either allows or
// refuses, which is the whole assertion.
//
// It is checked on its own (`deno task check:workers`) and excluded from the
// repo-wide one, because those runtime types are global: in scope, a
// `Response.json()` answers `unknown` and every other file in the repo would be
// checked against a Worker it does not run in.

import { forward, type Namespace, type Worker, worker } from './mod.ts'
import { type Accepting, workerUpgrade } from './upgrade.ts'

// A Durable Object namespace binding is the switchboard's `Namespace`, and its
// stubs are what `forward` hands a request to.
export let namespace = (real: DurableObjectNamespace): Namespace => real
export let hop = (
  real: DurableObjectNamespace,
  request: Request,
): Promise<Response> => forward(real, 'shop', request)

// Either half of a `WebSocketPair` is a socket this package can accept and
// serve — which is what `workerUpgrade` does with the one it keeps.
export let half = (): Accepting => new WebSocketPair()[1]
export let upgraded = (request: Request): Response =>
  workerUpgrade(request).response

// A Worker built here is a Worker Cloudflare will run: the module export it
// expects, over the bindings wrangler declared.
type Env = { GRAPHS: DurableObjectNamespace }
export let exported = (w: Worker<Env>): ExportedHandler<Env> => w
export let built: ExportedHandler<Env> = worker<Env>({
  api: () => ({ graph: null as never }),
})
