// An npm package's home: the one place its files are served from, named by
// the SHA-256 of the registry tarball they come out of, so every app and every
// compile that pins the same release shares it. A compile never carries a
// package's files: a package module's `import.meta.url` names its own file in
// the home (./compile.ts, ./shared.ts), and the answer says which tarball
// fills each home it names (`Answer.tarballs`). A host fills a home a file at a
// time, the first time a page asks for one, with ./unpack.ts.
import { packageOf } from './graph.ts'

/** Where packages come from. */
export let REGISTRY = 'https://registry.npmjs.org'

/** Bytes as lowercase hex. */
export let hex = (bytes: Uint8Array) =>
  [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('')

/** The SHA-256 of some bytes, as lowercase hex. */
export let sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))

/** The home a tarball's files are served from, under the host's
 * `__packages/` root.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(homeOf('ab'.repeat(32)), `__packages/${'ab'.repeat(32)}/`)
 * ```
 */
export let homeOf = (sha256: string) => `__packages/${sha256}/`

/** Where an installed package came from: its registry tarball, and the
 * SHA-256 of that tarball's bytes, which names the package's home. */
export type Tarball = { url: string; sha256: string }

/**
 * A build's `moved` (./bundle.ts) for npm packages: a package module that
 * reads its own URL is served from its file in its package's home on
 * `origin`. `tarballs` gathers the tarball each home it named is filled
 * from, by its SHA-256. A package `tarball` does not know, a toolkit package,
 * is left as it is.
 */
export let homes = (
  tarball: (name: string) => Tarball | undefined,
  origin: string,
) => {
  let tarballs: Record<string, string> = {}
  let moved = (path: string) => {
    let rest = path.slice('node_modules/'.length)
    let name = packageOf(rest)
    let from = name ? tarball(name) : undefined
    if (!name || !from) return
    tarballs[from.sha256] = from.url
    return JSON.stringify(
      `${origin}/${homeOf(from.sha256)}${rest.slice(name.length + 1)}`,
    )
  }
  return { moved, tarballs }
}
