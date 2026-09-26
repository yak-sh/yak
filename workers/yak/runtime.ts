// `cloudflare:workers` under Deno: the runtime's own module, stood in for so
// that what imports it loads outside workerd. The OAuth provider identity.ts
// is built on imports it for one `instanceof`, and the kernel in memory
// (probe.ts `kernel`) serves identity.ts. The root import map points the name
// here for Deno alone; esbuild never reads that map, so a bundle always gets
// the runtime's own.
//
// What is here is what those modules ask of it: the entrypoint base classes,
// and `waitUntil`, which under Deno has no invocation to extend and lets the
// work run. There is no `cache`, so cache.ts `purge` answers as it does under
// `wrangler dev`. And the one global the provider reads as it loads: the
// compatibility flags wrangler.toml gives the Worker, which is where it learns
// whether it may fetch a client's metadata document (identity.ts `cimd`).
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

export let waitUntil = (work: Promise<unknown>) => void work.catch(() => {})
