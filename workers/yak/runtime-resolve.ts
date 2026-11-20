// Under Deno, `cloudflare:workers` resolves to ./runtime.ts at every import,
// including imports inside npm dependencies, where import maps do not apply:
// the OAuth provider identity.ts is built on asks for it. The in-process
// kernel (probe.ts) imports this, so it serves sign-in under any runner; the
// test runner preloads it too (bin/test-runtime.ts), for modules that import
// the name statically.
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (specifier, context, next) =>
    next(
      specifier == 'cloudflare:workers'
        ? new URL('./runtime.ts', import.meta.url).href
        : specifier,
      context,
    ),
})
