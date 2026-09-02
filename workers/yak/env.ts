// The kernel's bindings (wrangler.toml), typed structurally — the slice each
// binding is asked for, mirroring @cloudflare/workers-types — so `deno check`
// reads the Worker without the package and nothing under src/ learns a
// Cloudflare name.
import type { R2 } from '../../src/blobs_r2.ts'
import type { Namespace } from './store.ts'

export type Env = {
  STORE: Namespace
  ASSETS: { fetch(req: Request): Promise<Response> }
  BLOBS: R2
  // The session-signing secret; unset, no session verifies (token.ts).
  SESSION_SECRET?: string
}
