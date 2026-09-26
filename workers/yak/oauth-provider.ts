// @cloudflare/workers-oauth-provider as Deno loads it (deno.json maps the name
// here): the very file the bundle is built from, typed by its npm package.
// Loaded from npm, Deno runs it through its Node loader, which refuses the
// `cloudflare:workers` it imports; loaded as a file, the import map reaches
// that import too, and runtime.ts answers it. esbuild resolves the name from
// node_modules itself and never reads this.
// @ts-types="npm:@cloudflare/workers-oauth-provider@0.10.3"
export * from './node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js'
