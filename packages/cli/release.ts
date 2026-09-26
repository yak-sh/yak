// A release of this toolkit on JSR, as Deno resolves it. Every @yaks package
// publishes together at one version, and Deno 2.9 waits a day before it
// resolves any version newer than that (its minimum dependency age). On the
// day a release publishes, a resolver under that default finds none of the
// release's other packages, so it takes the one before or refuses outright.
// Whatever resolves a release — the installer (./install.ts), @yaks/web's
// bundler — does so under `exempt`, which lifts the wait for this scope alone:
// every other dependency keeps Deno's window.

/** The scope every package of this release publishes in. */
export let SCOPE = 'yaks'

/** The JSR scope a module was published in, or null for one that was not.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(scopeOf(new URL('https://jsr.io/@yaks/web/0.2.2/main.tsx')), 'yaks')
 * assertEquals(scopeOf(new URL('file:///src/packages/web/main.tsx')), null)
 * ```
 */
export let scopeOf = (url: URL): string | null =>
  url.hostname == 'jsr.io'
    ? url.pathname.match(/^\/@([^/]+)\//)?.[1] ?? null
    : null

/** The part of a Deno config that says which versions it will resolve. */
export type Resolving = {
  minimumDependencyAge: { age: string; exclude: string[] }
}

/** A Deno config keeping the default minimum dependency age for everything but
 * the packages of `scope` named.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(exempt('yaks', ['cli', 'doc']), {
 *   minimumDependencyAge: {
 *     age: 'P1D',
 *     exclude: ['jsr:@yaks/cli', 'jsr:@yaks/doc'],
 *   },
 * })
 * ```
 */
export let exempt = (scope: string, names: string[]): Resolving => ({
  minimumDependencyAge: {
    age: 'P1D',
    exclude: names.map((name) => `jsr:@${scope}/${name}`),
  },
})

type Listing = { items: { name: string }[]; total: number }

/** Every package in a JSR scope, by name, as jsr.io's API lists them. */
export let packages = async (
  scope: string,
  get: typeof fetch = fetch,
): Promise<string[]> => {
  let names: string[] = []
  for (let page = 1;; page++) {
    let r = await get(
      `https://api.jsr.io/scopes/${scope}/packages?limit=100&page=${page}`,
    )
    if (!r.ok) throw new Error(`jsr.io lists no @${scope}: ${r.status}`)
    let { items, total } = await r.json() as Listing
    names.push(...items.map((item) => item.name))
    if (!items.length || names.length >= total) return names
  }
}

/** The config a resolver of `scope`'s release runs under. */
export let released = async (
  scope: string,
  get: typeof fetch = fetch,
): Promise<Resolving> => exempt(scope, await packages(scope, get))
