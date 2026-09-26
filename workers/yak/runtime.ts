// `cloudflare:workers` under Deno, for the one module that asks for it there:
// the OAuth provider identity.ts is built on imports it for one `instanceof`,
// and the kernel in memory (probe.ts `kernel`) serves identity.ts. The root
// config points the name here within the provider alone (deno.json `scopes`);
// esbuild never reads that map, so a bundle always gets the runtime's own.
//
// What is here is what the provider asks of it: the entrypoint base class,
// and the one global it reads as it loads, the compatibility flags
// wrangler.toml gives the Worker, which is where it learns whether it may
// fetch a client's metadata document (identity.ts `cimd`).
import { parse } from '@std/toml'

type Flags = { compatibility_flags: string[] }
let { compatibility_flags } = parse(
  Deno.readTextFileSync(new URL('./wrangler.toml', import.meta.url)),
) as Flags
;(globalThis as { Cloudflare?: unknown }).Cloudflare ??= {
  compatibilityFlags: Object.fromEntries(
    compatibility_flags.map((flag) => [flag, true]),
  ),
}

export class WorkerEntrypoint<E = unknown> {
  ctx: unknown
  env: E
  constructor(ctx: unknown, env: E) {
    this.ctx = ctx
    this.env = env
  }
}
