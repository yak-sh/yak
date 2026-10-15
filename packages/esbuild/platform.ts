// Compiler-owned toolkit sources, seeded as npm-shaped packages. Only declared
// toolkit roots and their catalog dependency closure enter a build; their source
// digests describe what was compiled, never a version to ask the registry for.
import { intersects, Range } from 'semver'
import { parse } from 'es-module-lexer/js'
import { script } from './graph.ts'
import { dependencies } from './plan.ts'

/** A compiler's toolkit package: paths relative to its package root, including
 * package.json, normalized source imports, runtime dependencies and source SHA. */
export type Toolkit = {
  files: Record<string, string>
  dependencies: Record<string, string>
  /** Runtime text files, relative to the package root. */
  resources?: Record<string, string>
  version: string
}

/** Supplied by the compiler's wrapper, never by an app. */
export type Catalog = Record<string, Toolkit>

export type Seed = {
  assets: Record<string, string>
  files: Record<string, string>
  /** npm roots, including toolkit externals whose transitives the installer
   * would otherwise skip when it finds a preseeded toolkit package. */
  dependencies: Record<string, string>
  /** Toolkit package to the exact source digest used by this compiler. */
  platform: Record<string, string>
}

/** Runtime resources stay outside the app's own paths. */
export let ASSETS = '__packages/'

let toolkit = (name: string) => name.startsWith('@yaks/')
let safe = (path: string) =>
  !!path && !path.startsWith('/') &&
  !path.split('/').some((p) => !p || p == '.' || p == '..') &&
  !/[\\?#%]/.test(path)

// The lexer identifies import.meta outside comments, strings and regexps.
let urlProp =
  /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*\.(?:\s|\/\*[\s\S]*?\*\/)*url\b/

/** Preserve a package module's URL when its source is bundled into an entry.
 * Page paths resolve against the browser's entry URL. A server entry supplies
 * its absolute logical module URL, since workerd names modules without an origin. */
export let located = (
  files: Record<string, string>,
  entry: string | URL,
  baseFor?: (path: string) => string,
) => {
  let out: Record<string, string> = {}
  let path = typeof entry == 'string' ? entry : entry.pathname.slice(1)
  let up = '../'.repeat(path.split('/').length - 1)
  for (let [path, source] of Object.entries(files)) {
    if (!path.startsWith('node_modules/@yaks/') || !script(path)) continue
    let base = baseFor?.(path) ??
      up + ASSETS + path.slice('node_modules/'.length)
    out[path] = moved(
      source,
      () =>
        typeof entry == 'string'
          ? urlOf(base)
          : JSON.stringify(new URL(base, entry).href),
    )
  }
  return out
}

/** The expression for `base`, a path from the module that is running. */
export let urlOf = (base: string) =>
  `new URL(${JSON.stringify(base)}, import.meta.url).href`

/** A module's source with each `import.meta.url` read replaced by `value()`,
 * an expression for the address the module is served from. `value` is asked
 * only of a module that reads its URL, and none leaves the module as it is. */
export let moved = (source: string, value: () => string | undefined) => {
  let to: string | undefined
  for (let imp of parse(source)[0].toReversed()) {
    if (imp.d != -2) continue
    let tail = urlProp.exec(source.slice(imp.e))
    if (!tail) continue
    to ??= value()
    if (to == null) return source
    source = source.slice(0, imp.s) + to +
      source.slice(imp.e + tail[0].length)
  }
  return source
}

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
  for (let path of Object.keys(files)) {
    if (/^(?:\.\/)*node_modules(?:\/|$)/.test(path)) {
      throw new Error(
        `${path}: node_modules is the compiler's reserved package namespace`,
      )
    }
  }
  let out: Seed = {
    files: { ...files },
    assets: {},
    dependencies: {},
    platform: {},
  }
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
      if (!safe(path)) {
        throw new Error(
          `${name}: platform catalog path ${path} is not package-relative`,
        )
      }
      out.files[`node_modules/${name}/${path}`] = source
    }
    for (let [path, text] of Object.entries(pkg.resources ?? {})) {
      if (!safe(path)) {
        throw new Error(`${name}: resource ${path} is not package-relative`)
      }
      out.assets[`${ASSETS}${name}/${path}`] = text
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
