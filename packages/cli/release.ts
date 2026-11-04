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

import { fileURLToPath } from 'node:url'
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

/** The Deno config a `deno` process this CLI starts runs under: a checkout's
 * own deno.json, or, for a CLI served from JSR, `released` written into the
 * directory `dir` makes, so the child resolves the same release its parent
 * did.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let dir = () => Deno.makeTempDir()
 * assertEquals(await launching(dir, 'file:///repo/packages/cli/release.ts'), '/repo/deno.json')
 * let config = await launching(dir, 'https://jsr.io/@yaks/cli/1.2.3/release.ts')
 * assertEquals(JSON.parse(await Deno.readTextFile(config)), released)
 * ```
 */
export let launching = async (
  dir: () => Promise<string>,
  source: string = import.meta.url,
): Promise<string> => {
  let here = new URL(source)
  if (here.protocol == 'file:') {
    return fileURLToPath(new URL('../../deno.json', here))
  }
  let config = `${await dir()}/deno.json`
  await Deno.writeTextFile(config, JSON.stringify(released))
  return config
}
