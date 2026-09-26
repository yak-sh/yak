// A release of this toolkit on JSR, as Deno resolves it. Every @yaks package
// publishes together at one version, and Deno 2.9 waits a day before it
// resolves any version newer than that (its minimum dependency age). On the
// day a release publishes, a resolver under that default finds none of the
// release's other packages, so it takes the one before or refuses outright.
// Whatever resolves a release — the installer (./install.ts), @yaks/web's
// bundler — does so under `released`, which lifts the wait for the release's
// own packages alone: every other dependency keeps Deno's window.
//
// Which packages those are is ./release.json, which bin/release.ts writes in
// the release's own commit. jsr.io's scope listing cannot say it: its CDN
// serves the listing up to a day old, so a package publishing for the first
// time is missing from it on exactly the day it has to be exempt.

import names from './release.json' with { type: 'json' }

/** The part of a Deno config that says which versions it will resolve. */
export type Resolving = {
  minimumDependencyAge: { age: string; exclude: string[] }
}

/** A Deno config keeping the default minimum dependency age for everything but
 * the JSR packages named.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(exempt(['@yaks/cli', '@yaks/doc']), {
 *   minimumDependencyAge: {
 *     age: 'P1D',
 *     exclude: ['jsr:@yaks/cli', 'jsr:@yaks/doc'],
 *   },
 * })
 * ```
 */
export let exempt = (names: string[]): Resolving => ({
  minimumDependencyAge: {
    age: 'P1D',
    exclude: names.map((name) => `jsr:${name}`),
  },
})

/** The config a resolver of this release runs under. */
export let released: Resolving = exempt(names)
