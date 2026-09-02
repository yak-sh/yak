// The kernel's bindings (wrangler.toml), typed structurally — the slice each
// binding is asked for, mirroring @cloudflare/workers-types — so `deno check`
// reads the Worker without the package and nothing under src/ learns a
// Cloudflare name.
//
// Each part of the kernel is a module exporting a plain `fetch(req, env)`
// (identity.ts, mcp.ts, directory.ts, apps.ts), and the router (index.ts)
// composes them by calling those handlers. The optional service bindings
// below are the seam for moving a part into its own Worker: declare the
// binding in wrangler.toml and the router calls it instead of the module,
// with no other change. A part never reaches another except through its
// handler, and none keeps state another reads.
import type { R2 } from '../../src/blobs_r2.ts'
import type { Namespace } from './store.ts'

export type Fetcher = { fetch(req: Request): Promise<Response> }

export type Env = {
  STORE: Namespace
  ASSETS: Fetcher
  BLOBS: R2
  // The session-signing secret; unset, no session verifies (token.ts).
  SESSION_SECRET?: string
  // A part split into its own Worker, when it has been; absent, in-process.
  IDENTITY?: Fetcher
  MCP?: Fetcher
  DIRECTORY?: Fetcher
  APPS?: Fetcher
}

// One part's handler shape: a request and its env, nothing else.
export type Handler = (req: Request, env: Env) => Promise<Response>

// The part as a Fetcher: the service binding when it exists, else the module
// called in-process with this env.
export let bound = (binding: Fetcher | undefined, handle: Handler, env: Env) =>
  binding ?? { fetch: (req: Request) => handle(req, env) }
