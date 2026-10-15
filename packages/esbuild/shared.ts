// Browser packages compiled apart from app entries: toolkit packages, Preact
// and Signals, and each npm package more than one of a page's consumers would
// otherwise carry (./common.ts), trimmed to the exports of it they use
// (./used.ts). A dependency group's URL names all its emitted bytes and
// resources; package cycles share a splitting build so there is one instance
// and no cycle between content-addressed URLs. Completed groups are retained
// under a byte budget across compiler jobs.
import { parse } from 'es-module-lexer/js'
import { bundle, type Options, packaged, Stopped } from './bundle.ts'
import { type Common, common } from './common.ts'
import { packageOf } from './graph.ts'
import { homes } from './home.ts'
import type { Files } from './npm.ts'
import { type Catalog, located, type Seed } from './platform.ts'
import { phase, type Report } from './timing.ts'
import { used } from './used.ts'

let singletons = ['preact', '@preact/signals', '@preact/signals-core']

let production: Options = {
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
}

/** Shared modules by path, the URL of each specifier, and the tarball each
 * npm package home they name is filled from, by its SHA-256. */
type Shared = {
  files: Record<string, string>
  urls: Record<string, string>
  tarballs: Record<string, string>
}
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

// The module a shared npm specifier is built from: the exports of it that the
// page's consumers use, and no more, the way a bundled copy kept only those.
let picked = (spec: string, names: string[]) =>
  names.length
    ? `export { ${names.map((n) => JSON.stringify(n)).join(', ')} } ` +
      `from ${JSON.stringify(spec)}`
    : `import ${JSON.stringify(spec)}`

/** What a page shares beyond its toolkit packages, Preact and Signals: each
 * npm package's entry modules, by specifier, and the shared packages each
 * consumer's build imports. */
type Carried = {
  modules: Record<string, Record<string, string>>
  uses: Common['uses']
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
  timing?: Report,
): Promise<Carried> => {
  let toolkits = Object.keys(setup.platform)
  let npm = toolkits.some((name) =>
    Object.entries(catalog[name].dependencies).some(([dep, version]) =>
      version != 'platform' && !singletons.includes(dep)
    )
  )
  if (!npm) return { modules: {}, uses: {} }
  let consumers = {
    '': pages,
    ...Object.fromEntries(
      toolkits.map((name) => [name, Object.values(exports(fs, name))]),
    ),
  }
  let files = [...new Set(Object.values(consumers).flat())]
  let graph = phase(timing, 'carried')
  try {
    let { inputs } = await bundle(
      fs,
      Object.fromEntries(files.map((path, i) => [`entry-${i}`, path])),
      { define: production.define, graph: true },
    )
    let { entries, uses } = common(inputs!, consumers, new Set(stops))
    graph()
    let trimmed = phase(timing, 'used')
    let names
    try {
      names = await used(
        fs,
        files,
        Object.assign({}, ...Object.values(entries)),
        production,
      )
    } finally {
      trimmed()
    }
    let modules = Object.fromEntries(
      Object.entries(entries).map(([name, specs]) => [
        name,
        Object.fromEntries(
          Object.keys(specs).map((spec) => [spec, picked(spec, names[spec])]),
        ),
      ]),
    )
    return { modules, uses }
  } catch (e) {
    if (e instanceof Stopped) throw e
    return { modules: {}, uses: {} }
  } finally {
    graph()
  }
}

/** Compile browser toolkit packages, Preact, Signals and the npm packages more
 * than one of the pages' consumers imports, per source/dependency identity.
 * All returned paths live under the host's `__packages/` root. */
let builds = async (
  fs: Files,
  setup: Seed,
  catalog: Catalog,
  origin: string,
  pages: string[] = [],
  options: { timing?: Report } = {},
): Promise<Shared> => {
  let names = Object.keys(setup.platform)
  for (let name of singletons) {
    if (fs.read(`node_modules/${name}/package.json`) != null) names.push(name)
  }
  let npm = await carried(fs, pages, names, catalog, setup, options.timing)
  names.push(...Object.keys(npm.modules))
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
  let result: Shared = { files: {}, urls: {}, tarballs: {} }
  for (let group of groups(names, deps)) {
    let own = new Set(group)
    // Each entry by specifier, and the entry modules written here, by path.
    let entries: Record<string, string> = {}
    let picks: Record<string, string> = {}
    for (let name of group) {
      if (!npm.modules[name]) Object.assign(entries, exports(fs, name))
      for (let [spec, source] of Object.entries(npm.modules[name] ?? {})) {
        entries[spec] = `__picked/${spec}.js`
        picks[entries[spec]] = source
      }
    }
    let resources: Record<string, string> = {}
    let sources: Record<string, string> = {}
    for (let name of group) {
      for (let [path, source] of Object.entries(catalog[name]?.files ?? {})) {
        sources[`node_modules/${name}/${path}`] = source
      }
      for (
        let [path, text] of Object.entries(catalog[name]?.resources ?? {})
      ) {
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
      sorted(picks),
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
        return picks[path] ??
          (path.startsWith('node_modules/') &&
              !path.split('/').includes('..')
            ? rewritten[path] ?? fs.read(path)
            : null)
      },
    }
    let fingerprint = (paths: string[]) =>
      digest(paths.map((path) => [
        path,
        files.read(path),
      ]))
    let caching = phase(options.timing, 'cache')
    let cached = held.get(key)
    let hit
    try {
      hit = cached && cached.fingerprint == await fingerprint(cached.reads)
    } finally {
      caching()
    }
    options.timing?.(hit ? 'hits' : 'misses', 1)
    if (cached && hit) {
      held.delete(key)
      held.set(key, cached)
      Object.assign(result.files, cached.files)
      Object.assign(result.urls, cached.urls)
      Object.assign(result.tarballs, cached.tarballs)
      continue
    }
    reads.clear()
    let specs = Object.keys(entries).sort()
    let points = Object.fromEntries(specs.map((spec, i) => [
      `entry-${i}`,
      entries[spec],
    ]))
    // An npm package module is served from its package's home.
    let home = homes((name) => fs.tarball(name), origin)
    let built = await bundle(files, points, {
      ...production,
      moved: home.moved,
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
          imp.n?.startsWith('.') &&
          !(imp.n.replace(/^\.\//, '') in built.files)
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
    let outputs: Record<string, string> = {
      ...built.files,
      ...resources,
      // Distinct packages with identical code still own distinct module state.
      'modules.json': JSON.stringify(
        Object.fromEntries(specs.map((spec, i) => [
          spec,
          `entry-${i}.js`,
        ])),
      ),
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
      tarballs: home.tarballs,
    }
    let paths = [...reads].sort()
    keep(key, {
      ...compiled,
      reads: paths,
      fingerprint: await fingerprint(paths),
    })
    Object.assign(result.files, compiled.files)
    Object.assign(result.urls, compiled.urls)
    Object.assign(result.tarballs, compiled.tarballs)
  }
  return result
}

/** Compile shared groups. `groups` excludes carried/used, and includes the
 * `cache` subset; the callback also reports group cache hit/miss counts. */
export let shared = async (
  fs: Files,
  setup: Seed,
  catalog: Catalog,
  origin: string,
  pages: string[] = [],
  options: { timing?: Report } = {},
): Promise<Shared> => {
  if (!options.timing) return await builds(fs, setup, catalog, origin, pages)
  let at = performance.now(), discovery = 0
  try {
    return await builds(fs, setup, catalog, origin, pages, {
      timing: (name, value) => {
        if (name == 'carried' || name == 'used') discovery += value
        options.timing!(name, value)
      },
    })
  } finally {
    options.timing('groups', Math.max(0, performance.now() - at - discovery))
  }
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
