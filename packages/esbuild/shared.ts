// Browser packages compiled apart from app entries: toolkit packages, Preact
// and Signals, and each npm package more than one of a page's consumers would
// otherwise carry (./common.ts). A dependency group's URL names all its
// emitted bytes and resources; package cycles share a splitting build so there
// is one instance and no cycle between content-addressed URLs. Completed
// groups are retained under a byte budget across compiler jobs.
import { parse } from 'es-module-lexer/js'
import { bundle, type Options, packaged, Stopped } from './bundle.ts'
import { type Common, common } from './common.ts'
import { packageOf } from './graph.ts'
import type { Files } from './npm.ts'
import { type Catalog, located, type Seed } from './platform.ts'

let singletons = ['preact', '@preact/signals', '@preact/signals-core']

let production: Options = {
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
}

type Shared = { files: Record<string, string>; urls: Record<string, string> }
type Cached = Shared & { reads: string[]; fingerprint: string }
let held = new Map<string, Cached>()
let bytes = 0
let LIMIT = 16 << 20
let size = (group: Shared) =>
  Object.values(group.files).reduce((sum, text) => sum + text.length * 2, 0)
let keep = (key: string, group: Cached) => {
  if (held.has(key)) {
    bytes -= size(held.get(key)!)
    held.delete(key)
  }
  let n = size(group)
  if (n > LIMIT) return
  while (bytes + n > LIMIT) {
    let oldest = held.keys().next().value!
    bytes -= size(held.get(oldest)!)
    held.delete(oldest)
  }
  held.set(key, group)
  bytes += n
}

let sorted = (value: Record<string, unknown>) =>
  Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
let digest = async (value: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ].map((n) => n.toString(16).padStart(2, '0')).join('')

// Tarjan's dependency order: dependencies precede their consumers, with each
// strongly connected component emitted as a single group.
let groups = (names: string[], deps: (name: string) => string[]) => {
  let next = 0
  let indices = new Map<string, number>(), low = new Map<string, number>()
  let stack: string[] = [], pending = new Set<string>(), out: string[][] = []
  let visit = (name: string) => {
    indices.set(name, next)
    low.set(name, next++)
    stack.push(name)
    pending.add(name)
    for (let dep of deps(name)) {
      if (!indices.has(dep)) {
        visit(dep)
        low.set(name, Math.min(low.get(name)!, low.get(dep)!))
      } else if (pending.has(dep)) {
        low.set(name, Math.min(low.get(name)!, indices.get(dep)!))
      }
    }
    if (low.get(name) != indices.get(name)) return
    let group: string[] = [], dep: string
    do {
      dep = stack.pop()!
      pending.delete(dep)
      group.push(dep)
    } while (dep != name)
    out.push(group.sort())
  }
  for (let name of names.sort()) if (!indices.has(name)) visit(name)
  return out
}

// Every concrete browser export is an entry of the same splitting build.
// This retains module identity even when consumers import different subpaths.
let exports = (fs: Files, name: string) => {
  let pkg = JSON.parse(fs.read(`node_modules/${name}/package.json`)!)
  let keys = typeof pkg.exports == 'object' && pkg.exports != null &&
      Object.keys(pkg.exports).some((key) => key.startsWith('.'))
    ? Object.keys(pkg.exports)
    : ['.']
  // Preact also exports SSR adapters whose optional renderer peer belongs to
  // server consumers. They cannot be entries of a browser build.
  if (name == 'preact') {
    keys = keys.filter((key) => !key.startsWith('./compat/server'))
  }
  let out: Record<string, string> = {}
  for (let key of keys.sort()) {
    if (key.includes('*')) {
      throw new Error(
        `${name}: shared browser exports must name concrete paths`,
      )
    }
    let spec = key == '.' ? name : name + key.slice(1)
    let path = packaged(fs, spec)
    if (path && !path.endsWith('.json')) out[spec] = path
  }
  return out
}

// What the pages share beyond the packages already shared, read from one
// build of every consumer's entries. Only a toolkit package depending on an
// npm package can carry one beside the pages, so the build runs only then. A
// build that fails shares nothing more: the failing entry's own build says why.
let carried = async (
  fs: Files,
  pages: string[],
  stops: string[],
  catalog: Catalog,
  setup: Seed,
): Promise<Common> => {
  let toolkits = Object.keys(setup.platform)
  let npm = toolkits.some((name) =>
    Object.entries(catalog[name].dependencies).some(([dep, version]) =>
      version != 'platform' && !singletons.includes(dep)
    )
  )
  if (!npm) return { entries: {}, uses: {} }
  let consumers = {
    '': pages,
    ...Object.fromEntries(
      toolkits.map((name) => [name, Object.values(exports(fs, name))]),
    ),
  }
  let files = [...new Set(Object.values(consumers).flat())]
  try {
    let { inputs } = await bundle(
      fs,
      Object.fromEntries(files.map((path, i) => [`entry-${i}`, path])),
      { define: production.define, graph: true },
    )
    return common(inputs!, consumers, new Set(stops))
  } catch (e) {
    if (e instanceof Stopped) throw e
    return { entries: {}, uses: {} }
  }
}

/** Compile browser toolkit packages, Preact, Signals and the npm packages more
 * than one of the pages' consumers imports, per source/dependency identity.
 * All returned paths live under the host's `__packages/` root. */
export let shared = async (
  fs: Files,
  setup: Seed,
  catalog: Catalog,
  origin: string,
  pages: string[] = [],
): Promise<Shared> => {
  let names = Object.keys(setup.platform)
  for (let name of singletons) {
    if (fs.read(`node_modules/${name}/package.json`) != null) names.push(name)
  }
  let npm = await carried(fs, pages, names, catalog, setup)
  names.push(...Object.keys(npm.entries))
  let has = new Set(names)
  let deps = (name: string) => {
    let pkg = JSON.parse(fs.read(`node_modules/${name}/package.json`)!)
    return [
      ...new Set([
        ...Object.keys({
          ...pkg.dependencies,
          ...pkg.peerDependencies,
          ...catalog[name]?.dependencies,
        }),
        ...npm.uses[name] ?? [],
      ]),
    ].filter((dep) => has.has(dep)).sort()
  }
  let result: Shared = { files: {}, urls: {} }
  for (let group of groups(names, deps)) {
    let own = new Set(group)
    let entries: Record<string, string> = {}
    for (let name of group) {
      Object.assign(entries, npm.entries[name] ?? exports(fs, name))
    }
    let resources: Record<string, string> = {}
    let sources: Record<string, string> = {}
    for (let name of group) {
      for (let [path, source] of Object.entries(catalog[name]?.files ?? {})) {
        sources[`node_modules/${name}/${path}`] = source
      }
      for (let [path, text] of Object.entries(catalog[name]?.resources ?? {})) {
        resources[`resources/${name}/${path}`] = text
      }
    }
    // npm pins are scoped to this group's dependency closure: an unrelated
    // app dependency does not change the toolkit's URL or its cache identity.
    let pins: Record<string, string> = {}
    let visit = (name: string) => {
      if (has.has(name) && !own.has(name) || name in pins) return
      let text = fs.read(`node_modules/${name}/package.json`)
      if (!text) return
      pins[name] = text
      let pkg = JSON.parse(text)
      for (let dep of Object.keys(pkg.dependencies ?? {})) visit(dep)
    }
    for (let name of group) visit(name)
    let dependencies: Record<string, string> = {}
    for (let name of group) {
      for (let dep of deps(name)) {
        if (own.has(dep)) continue
        for (let [spec, url] of Object.entries(result.urls)) {
          if (packageOf(spec) == dep) dependencies[spec] = url
        }
      }
    }
    let key = await digest([
      sorted(entries),
      sorted(sources),
      sorted(resources),
      sorted(pins),
      sorted(dependencies),
      origin,
    ])
    let rewritten = located(
      sources,
      'module.js',
      (path) => `./resources/${path.slice('node_modules/'.length)}`,
    )
    let reads = new Set<string>()
    let files = {
      read: (path: string) => {
        reads.add(path)
        return path.startsWith('node_modules/') &&
            !path.split('/').includes('..')
          ? rewritten[path] ?? fs.read(path)
          : null
      },
    }
    let fingerprint = (paths: string[]) =>
      digest(paths.map((path) => [
        path,
        files.read(path),
      ]))
    let cached = held.get(key)
    if (cached && cached.fingerprint == await fingerprint(cached.reads)) {
      held.delete(key)
      held.set(key, cached)
      Object.assign(result.files, cached.files)
      Object.assign(result.urls, cached.urls)
      continue
    }
    reads.clear()
    let specs = Object.keys(entries).sort()
    let points = Object.fromEntries(specs.map((spec, i) => [
      `entry-${i}`,
      entries[spec],
    ]))
    let built = await bundle(files, points, {
      ...production,
      external: (spec) => {
        let name = packageOf(spec)
        if (!name || !name.startsWith('@yaks/') && !has.has(name)) return
        if (own.has(name)) {
          if (packaged(fs, spec)) return
          throw new Error(
            `${spec}: missing browser export in the platform catalog`,
          )
        }
        let url = result.urls[spec]
        if (url) return url
        throw new Error(
          `${spec}: missing browser package or export in the platform catalog`,
        )
      },
    })
    for (let [path, text] of Object.entries(built.files)) {
      if (!path.endsWith('.js')) continue
      for (let imp of parse(text)[0]) {
        if (
          imp.n?.startsWith('.') && !(imp.n.replace(/^\.\//, '') in built.files)
        ) {
          throw new Error(
            `${group.join(', ')} imports ${imp.n}, which names no emitted file`,
          )
        }
        if (imp.n?.startsWith('/')) {
          throw new Error(
            `${group.join(', ')} imports ${imp.n}, which names no emitted file`,
          )
        }
        if (imp.n && packageOf(imp.n)) {
          throw new Error(
            `${group.join(', ')} imports ${imp.n}, which is not installed`,
          )
        }
      }
    }
    let outputs = {
      ...built.files,
      ...resources,
      // Distinct packages with identical code still own distinct module state.
      'modules.json': JSON.stringify(Object.fromEntries(specs.map((spec, i) => [
        spec,
        `entry-${i}.js`,
      ]))),
    }
    let hash = await digest(sorted(outputs))
    let prefix = `__packages/${hash}/`
    let compiled: Shared = {
      files: Object.fromEntries(
        Object.entries(outputs).map(([path, text]) => [
          prefix + path,
          text,
        ]),
      ),
      urls: Object.fromEntries(specs.map((spec, i) => [
        spec,
        `${origin}/${prefix}entry-${i}.js`,
      ])),
    }
    let paths = [...reads].sort()
    keep(key, {
      ...compiled,
      reads: paths,
      fingerprint: await fingerprint(paths),
    })
    Object.assign(result.files, compiled.files)
    Object.assign(result.urls, compiled.urls)
  }
  return result
}

/** Replace a browser package import, refusing a toolkit import that cannot be
 * served. Ordinary npm imports remain part of the app's entry. */
export let external = (urls: Shared['urls']): Options['external'] => (spec) => {
  let url = urls[spec]
  if (url) return url
  if (spec.startsWith('@yaks/') || singletons.includes(packageOf(spec) ?? '')) {
    throw new Error(
      `${spec}: missing browser package or export in the platform catalog; ` +
        'declare the package in package.json dependencies',
    )
  }
}
