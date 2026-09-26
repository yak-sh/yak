// The lock: which version of each package a build installed, kept so the next
// build installs the same ones. It is npm's own `package-lock.json` (lockfile
// version 3), read and written for its top level only: each package at
// `packages["node_modules/<name>"].version`. @cloudflare/worker-bundler
// installs one version of each package name, flat, so a nested entry
// (`node_modules/a/node_modules/b`) that `npm install` wrote is not read.
//
// A build installs every locked version exactly, and a declared range only
// where the lock holds no version that satisfies it. Then the lock is written
// again from what the declared packages reach, so a package nothing needs any
// more leaves it. A published npm version never changes, so the same lock is
// the same code.
import { satisfies } from 'semver'

/** Package name to exact version. */
export type Pins = Record<string, string>

let TOP = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/

/** The versions a package-lock.json pins, by package name; none without one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(pins(JSON.stringify({ lockfileVersion: 3, packages: {
 *   '': { dependencies: { three: '^0.180.0' } },
 *   'node_modules/three': { version: '0.180.1' },
 *   'node_modules/a/node_modules/b': { version: '2.0.0' },
 * } })), { three: '0.180.1' })
 * ```
 */
export let pins = (text: string | null): Pins => {
  if (text == null) return {}
  let lock: { packages?: Record<string, { version?: unknown }> }
  try {
    lock = JSON.parse(text)
  } catch (e) {
    throw new Error(`package-lock.json is not JSON: ${(e as Error).message}`)
  }
  let out: Pins = {}
  for (let [key, entry] of Object.entries(lock?.packages ?? {})) {
    let name = key.match(TOP)?.[1]
    if (name && typeof entry?.version == 'string') out[name] = entry.version
  }
  return out
}

/** What to install: every pinned version, and each declared range the pins
 * do not satisfy.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   wanted({ three: '^0.180.0', hono: '^4' }, { three: '0.180.1', tslib: '2.8.1' }),
 *   { three: '0.180.1', tslib: '2.8.1', hono: '^4' },
 * )
 * assertEquals(wanted({ three: '^0.181.0' }, { three: '0.180.1' }), {
 *   three: '^0.181.0',
 * })
 * ```
 */
export let wanted = (ranges: Record<string, string>, pinned: Pins): Pins => {
  let out: Pins = { ...pinned }
  for (let [name, range] of Object.entries(ranges)) {
    let pin = pinned[name]
    if (!pin || !safely(pin, range)) out[name] = range
  }
  return out
}

// A range semver cannot read (a tag, a URL) never keeps a pin: the build
// resolves it again, which is what npm would do.
let safely = (version: string, range: string) => {
  try {
    return satisfies(version, range)
  } catch {
    return false
  }
}

/** The installed packages the declared ones reach, through each package's own
 * dependencies, with the version installed.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let deps: Record<string, string[]> = { a: ['b'], b: ['a'], c: [] }
 * assertEquals(
 *   reached(['a'], { a: '1.0.0', b: '2.0.0', c: '3.0.0' }, (n) => deps[n] ?? []),
 *   { a: '1.0.0', b: '2.0.0' },
 * )
 * ```
 */
export let reached = (
  roots: string[],
  installed: Pins,
  needs: (name: string) => string[],
): Pins => {
  let out: Pins = {}
  let visit = (name: string) => {
    if (name in out || !(name in installed)) return
    out[name] = installed[name]
    for (let dep of needs(name)) visit(dep)
  }
  for (let name of roots) visit(name)
  return out
}

/** A package-lock.json holding these versions under these declared ranges,
 * named as package.json names the app, if it does. */
export let lockfile = (
  name: string | undefined,
  ranges: Record<string, string>,
  versions: Pins,
) =>
  JSON.stringify(
    {
      name,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name, dependencies: ranges },
        ...Object.fromEntries(
          Object.keys(versions).sort().map((
            pkg,
          ) => [`node_modules/${pkg}`, { version: versions[pkg] }]),
        ),
      },
    },
    null,
    2,
  ) + '\n'

/** `name@version` as the installer says it, split at the version's `@`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(split('@hono/zod-validator@0.4.3'), ['@hono/zod-validator', '0.4.3'])
 * ```
 */
export let split = (said: string): [string, string] => {
  let at = said.lastIndexOf('@')
  return [said.slice(0, at), said.slice(at + 1)]
}
