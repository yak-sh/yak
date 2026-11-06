import * as disk from '@yaks/file/io'
// A release of this toolkit on JSR, as Deno resolves it. A release publishes
// the @yaks packages that changed, each at the release's version, and keeps
// every other one at the version JSR already has; ./release.json names them
// all, at those versions, in the release's own commit (bin/release.ts). A
// plugin this CLI loads by name is loaded at that version (./config.ts
// `located`), so a release is one coherent set however few of it moved.
//
// Deno 2.9 waits a day before it resolves any version newer than that (its
// minimum dependency age). On the day a release publishes, a resolver under
// that default finds none of the release's other packages, so it takes the
// one before or refuses outright. Whatever resolves a release — the installer
// (./install.ts), @yaks/web's bundler — does so under `released`, which lifts
// the wait for the release's own packages alone: every other dependency keeps
// Deno's window. jsr.io's scope listing cannot say which those are: its CDN
// serves the listing up to a day old, so a package publishing for the first
// time is missing from it on exactly the day it has to be exempt.

import { fileURLToPath } from 'node:url'
import at from './release.json' with { type: 'json' }
import subpaths from './exports.json' with { type: 'json' }

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

/** The version of each @yaks package this release is made of. */
export let pinned: Readonly<Record<string, string>> = at

/** The subpaths each package of this release exports (`.`, `./vocab`, …),
 * which bin/publish.ts writes into ./exports.json as it publishes: a module
 * from JSR resolves any subpath of a package and finds one missing only by
 * loading it. A checkout's is empty, since its import map knows. */
export let shipped: Readonly<Record<string, readonly string[]>> = subpaths

/** The unstable features a release runs with: this repository's deno.json's.
 * `lazy-dynamic-imports` is the one a person waits on: without it Deno loads
 * every module a literal `import()` reaches before the program starts
 * (./yak.ts `local`), and a `yak serve` from JSR listens 0.4 s later. */
export let UNSTABLE = ['net', 'lazy-dynamic-imports', 'no-legacy-abort']

/** The config a resolver of this release runs under. */
export let released: Resolving & { unstable: string[] } = {
  ...exempt(Object.keys(pinned)),
  unstable: UNSTABLE,
}

/** The Deno config a `deno` process this CLI starts runs under: a checkout's
 * own deno.json, or, for a CLI served from JSR, `released` written into the
 * directory `dir` makes, so the child resolves the same release its parent
 * did.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import * as disk from '@yaks/file/io'
 * let dir = () => disk.makeTempDir()
 * assertEquals(await launching(dir, 'file:///repo/packages/cli/release.ts'), '/repo/deno.json')
 * let config = await launching(dir, 'https://jsr.io/@yaks/cli/1.2.3/release.ts')
 * assertEquals(JSON.parse(await disk.readTextFile(config)), released)
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
  await disk.writeTextFile(config, JSON.stringify(released))
  return config
}
