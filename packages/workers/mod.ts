/**
 * @yaks/workers — the Cloudflare Workers adapter that serves
 * {@link https://jsr.io/@yaks/api | @yaks/api} from a Worker.
 *
 * `@yaks/api` is written to web-standard `Request`/`Response` types and knows
 * nothing about any host. This package is the thin seam that binds it to the
 * Workers runtime: it reads the Worker `env` to reach a graph's storage — a
 * Durable Object namespace (`@yaks/durable-object`) or a D1 binding
 * (`@yaks/d1`) — performs the Workers-native WebSocket upgrade for the `/ws`
 * route, and exports the `fetch` entrypoint a Worker requires.
 *
 * It holds only what is Cloudflare-specific; the routing and the graph logic
 * stay in the portable packages, so the same API also runs under Deno or Node
 * behind a different, equally thin adapter.
 *
 * @module
 */

import type { Handler } from '@yaks/api'

/** The Worker bindings this adapter reads to reach a graph's storage. */
export type Env = Record<string, unknown>

/** A Cloudflare Worker's default export: its `fetch` entrypoint. */
export type Worker = {
  /** handle one request, given the Worker's bindings */
  fetch: (request: Request, env: Env) => Response | Promise<Response>
}

/**
 * Build the Worker export for a graph: resolve storage from `env`, front it
 * with {@link https://jsr.io/@yaks/api | @yaks/api}, and wire the
 * Workers-native socket upgrade. The implementation lands with the package;
 * this is the shape it satisfies.
 */
export type worker = (api: (env: Env) => Handler) => Worker
