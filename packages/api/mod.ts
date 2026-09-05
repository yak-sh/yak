/**
 * @yaks/api — the transport in front of a yaks graph, as a plain request
 * handler that runs in any JavaScript environment.
 *
 * Given a {@link https://jsr.io/@yaks/graph | @yaks/graph} {@link Storage},
 * this package answers the three routes a client needs and nothing more:
 *
 * - **POST `/apply`** — a change in, the applied result out;
 * - **GET `/query`** — a query in, matching bundles out;
 * - **`/ws`** — a WebSocket that streams committed changes so open clients
 *   converge.
 *
 * It is written to the web-standard `Request`/`Response` types, so it hosts
 * unchanged on Deno, Node, or a Cloudflare Worker — the environment adapter is
 * a thin wrapper (see `@yaks/workers`). It holds no environment specifics and
 * no routing framework: it IS the route table.
 *
 * @module
 */

import type { Storage } from '@yaks/graph'

/** A web-standard request handler: a `Request` in, a `Response` out. */
export type Handler = (request: Request) => Response | Promise<Response>

/** How a WebSocket upgrade is performed in the host environment. */
export type Upgrade = (
  request: Request,
) => { socket: WebSocket; response: Response }

/** Options for a handler: the store it fronts, and the host's socket upgrade. */
export type Options = {
  /** the graph this API reads and writes */
  store: Storage
  /** the environment's WebSocket upgrade, for the `/ws` route */
  upgrade?: Upgrade
}

/**
 * Build the request handler for a graph. The returned {@link Handler} routes
 * `/apply`, `/query`, and `/ws`. The implementation lands with the package;
 * this is the shape it satisfies.
 */
export type api = (options: Options) => Handler
