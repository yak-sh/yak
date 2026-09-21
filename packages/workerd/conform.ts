/// <reference types="npm:@cloudflare/workers-types@^4" />
// The Cloudflare type check (not published — see deno.json). Every Workers type
// this package uses is declared structurally, so that the published source
// imports nothing and `deno check` passes with no Cloudflare package installed.
// This file is where those hand-written types are checked against the runtime's
// own: it is type-checked with `@cloudflare/workers-types` in scope, so a
// binding here is the binding wrangler declares and `ResponseInit` is the one
// that carries a `webSocket`.
//
// Nothing here runs. Each line is an assignment the type-checker either accepts
// or rejects, and that is the whole assertion.
//
// It is checked on its own (`deno task check:workers`) and excluded from the
// repo-wide check, because those runtime types are global: with them in scope,
// `Response.json()` returns `unknown` and every other file in the repo would be
// type-checked against a Worker it does not run in.

import { forward, type Namespace, type Worker, worker } from './mod.ts'
import { type Accepting, workerUpgrade } from './upgrade.ts'

// A Durable Object namespace binding is the router's `Namespace`, and its stubs
// are what `forward` sends a request to.
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
