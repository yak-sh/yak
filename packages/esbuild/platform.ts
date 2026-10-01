// Compiler-owned toolkit sources, seeded as npm-shaped packages. Only declared
// toolkit roots and their catalog dependency closure enter a build; their source
// digests describe what was compiled, never a version to ask the registry for.
import { intersects, Range } from 'semver'
import { dependencies } from './plan.ts'

/** A compiler's toolkit package: paths relative to its package root, including
 * package.json, normalized source imports, runtime dependencies and source SHA. */
export type Toolkit = {
  files: Record<string, string>
  dependencies: Record<string, string>
  version: string
}

/** Supplied by the compiler's wrapper, never by an app. */
export type Catalog = Record<string, Toolkit>

export type Seed = {
  files: Record<string, string>
  /** npm roots, including toolkit externals whose transitives the installer
   * would otherwise skip when it finds a preseeded toolkit package. */
  dependencies: Record<string, string>
  /** Toolkit package to the exact source digest used by this compiler. */
  platform: Record<string, string>
}

let toolkit = (name: string) => name.startsWith('@yaks/')

// A flat install must satisfy every consumer, not whichever was visited last.
type Bound = { value: string }

let together = (name: string, a: string, b: string) => {
  if (a == b) return a
  try {
    if (intersects(a, b)) {
      let choices = new Range(a).set.flatMap((left: Bound[]) =>
        new Range(b).set.map((right: Bound[]) =>
          [...left, ...right].map((c) => c.value).filter(Boolean).join(' ')
        )
      )
      return choices.join(' || ')
    }
  } catch {
    // Different tags and URLs cannot express a shared version constraint.
  }
  throw new Error(
    `package.json: ${name} has incompatible versions ${a} and ${b}`,
  )
}

/** Seed declared platform packages and their dependency closure without I/O.
 * @yaks packages must use "platform"; none is fetched from a registry. */
export let seed = (files: Record<string, string>, catalog: Catalog): Seed => {
  let out: Seed = { files: { ...files }, dependencies: {}, platform: {} }
  let visit = (name: string, version: string) => {
    if (!toolkit(name)) {
      if (version == 'platform') {
        throw new Error(`${name}: only @yaks toolkit packages use "platform"`)
      }
      let prior = out.dependencies[name]
      out.dependencies[name] = prior ? together(name, prior, version) : version
      return
    }
    if (version != 'platform') {
      throw new Error(
        `${name}: use "platform", not ${version}, in dependencies`,
      )
    }
    if (name in out.platform) return
    let pkg = catalog[name]
    if (!pkg) {
      throw new Error(`${name}: missing from this compiler's platform catalog`)
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(pkg.version)) {
      throw new Error(
        `${name}: platform catalog version must be a source SHA256`,
      )
    }
    if (!('package.json' in pkg.files)) {
      throw new Error(`${name}: platform catalog is missing package.json`)
    }
    out.platform[name] = pkg.version
    for (let [path, source] of Object.entries(pkg.files)) {
      if (path.startsWith('/') || path.split('/').some((p) => p == '..')) {
        throw new Error(
          `${name}: platform catalog path ${path} is not package-relative`,
        )
      }
      out.files[`node_modules/${name}/${path}`] = source
    }
    for (let [dep, range] of Object.entries(pkg.dependencies)) visit(dep, range)
  }
  for (
    let [name, range] of Object.entries(
      dependencies(files['package.json'] ?? null),
    )
  ) {
    visit(name, range)
  }
  return out
}
