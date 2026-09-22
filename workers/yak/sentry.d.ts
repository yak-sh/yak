// The two wrappers index.ts takes from @sentry/cloudflare, typed here instead
// of by the package: its own declarations reference @cloudflare/workers-types,
// whose globals would redefine `Response` and friends for every file the
// repo-wide check reads (conform.ts). index.ts names this file with
// `@ts-types`; the bundle still runs the package itself.
type Options = (env: never) => object

export declare let withSentry: <H>(options: Options, handler: H) => H

export declare let instrumentDurableObjectWithSentry: <C>(
  options: Options,
  object: C,
) => C
