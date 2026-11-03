// The TypeScript project a Deno module graph describes, for TypeScript's
// native compiler (tsgo) to check. `deno info --json` is the resolver, so
// every specifier means what it means to Deno; the project says it where tsc
// can read it:
//
// - a bare specifier (an import map's, a workspace member's, a jsr or npm
//   one) is a `paths` entry naming the file Deno chose;
// - a jsr module is linked at `jsr/<host>/<path>`, so its relative imports
//   resolve as its URL's do;
// - npm packages are a `node_modules` linked into Deno's npm cache, a
//   dependency of another version nested under its dependent, so tsc
//   resolves what they import itself;
// - a relative import Deno sends elsewhere (a scope, a `@ts-types`) gets a
//   declaration where tsc looks, and a script without an extension a `.ts`
//   name, laid over the checkout through `rootDirs`;
// - a module Deno leaves to its host (`cloudflare:workers`) is declared with
//   every import `any`, as Deno types a dependency it cannot load, never as the
//   file a scope maps it to for some importer;
// - Deno's globals are `deno types`, written beside.
//
// TODO(D-135458 step 3): once packages resolve through package.json, tsc reads
// them itself and this goes.

/** A dependency of a module, as `deno info --json` reports it. */
export type Dep = {
  specifier: string
  code?: { specifier?: string }
  type?: { specifier?: string }
}

/** A module of the graph, as `deno info --json` reports it. */
export type Module = {
  specifier: string
  kind?: string
  local?: string
  mediaType?: string
  npmPackage?: string
  dependencies?: Dep[]
}

/** An npm package of the graph, as `deno info --json` reports it. */
export type Package = {
  name: string
  dependencies: string[]
  localPath: string
}

/** What `deno info --json` says of a graph. */
export type Info = {
  modules: Module[]
  redirects: Record<string, string>
  npmPackages: Record<string, Package>
}

/** A project, by paths relative to its directory: the files to write, the
 * links to make (to absolute targets), the npm packages to lay out as a
 * directory of links to their entries (for a nested `node_modules`), and its
 * tsconfig. */
export type Project = {
  files: Record<string, string>
  links: Record<string, string>
  spread: Record<string, string>
  config: { compilerOptions: Record<string, unknown>; files: string[] }
}

/// relative('/a/.types', '/a/b/c.ts') -> '../b/c.ts'
/// relative('/a/.types', '/a/.types/jsr/x.ts') -> './jsr/x.ts'
/** `to` from the directory `from`, as a tsconfig path. */
export let relative = (from: string, to: string) => {
  let a = from.split('/'), b = to.split('/')
  let i = 0
  while (i < a.length && a[i] == b[i]) i++
  return (a.length > i ? '../'.repeat(a.length - i) : './') +
    b.slice(i).join('/')
}

/// within('https://jsr.io/@std/csv/1.0.6/mod.ts') -> 'jsr/jsr.io/@std/csv/1.0.6/mod.ts'
/** Where a remote module lies in the project. */
export let within = (url: string) => `jsr/${url.replace(/^https?:\/\//, '')}`

/// tree({ a: { name: 'a', dependencies: ['b2'], localPath: '' }, b1: { name: 'b', dependencies: [], localPath: '' }, b2: { name: 'b', dependencies: [], localPath: '' } }, ['b1']) -> new Map([['b', 'b1'], ['a', 'a'], ['a/node_modules/b', 'b2']])
/**
 * The npm packages as `node_modules`: the package id at each directory. A name
 * the graph's modules import (`direct`) holds its own version at the top;
 * another package's dependency is the top's when the versions agree, and
 * nested under it when they do not.
 */
export let tree = (packages: Record<string, Package>, direct: string[]) => {
  let top = new Map<string, string>()
  for (let id of [...direct, ...Object.keys(packages)]) {
    let p = packages[id]
    if (p && !top.has(p.name)) top.set(p.name, id)
  }
  let at = new Map(top)
  let nest = (dir: string, id: string, above: string[]) => {
    for (let dep of packages[id]?.dependencies ?? []) {
      let name = packages[dep]?.name
      if (!name || top.get(name) == dep || above.includes(dep)) continue
      let path = `${dir}/node_modules/${name}`
      at.set(path, dep)
      nest(path, dep, [...above, dep])
    }
  }
  for (let [name, id] of top) nest(name, id, [id])
  return at
}

/// entry({ './sub': { types: './s.d.ts', import: './s.js' } }, './sub', ['types', 'import']) -> './s.d.ts'
/// entry({ './*': { types: './d/*.d.ts', import: './d/*' } }, './a/b.js', ['import']) -> './d/a/b.js'
/// entry({ import: './i.js', require: './r.cjs' }, '.', ['require']) -> './r.cjs'
/// entry('./i.js', './x', ['import']) -> undefined
/** The target a package's `exports` gives `key` (`.` or `./sub`) under
 * `conditions`, as Node resolves it: the exact key, or the longest pattern
 * whose `*` matches, then the first condition the target names. */
export let entry = (
  exports: unknown,
  key: string,
  conditions: string[],
): string | undefined => {
  let map = typeof exports == 'object' && exports && !Array.isArray(exports) &&
      Object.keys(exports).some((k) => k.startsWith('.'))
    ? exports as Record<string, unknown>
    : { '.': exports }
  // What a pattern's `*` stands for in the key, if the pattern matches it.
  let star = (k: string) => {
    let [pre, post] = k.split('*')
    return post != undefined && key.length >= k.length &&
        key.startsWith(pre) && key.endsWith(post)
      ? key.slice(pre.length, key.length - post.length)
      : undefined
  }
  let [hit, part = ''] = key in map ? [key] : Object.keys(map)
    .filter((k) => star(k) != undefined)
    .sort((a, b) => b.indexOf('*') - a.indexOf('*'))
    .map((k) => [k, star(k)])[0] ?? []
  let pick = (t: unknown): string | undefined =>
    typeof t == 'string'
      ? t.replaceAll('*', part)
      : Array.isArray(t)
      ? t.map(pick).find(Boolean)
      : t && typeof t == 'object'
      ? Object.entries(t).filter(([c]) =>
        [...conditions, 'default'].includes(c)
      )
        .map(([, v]) => pick(v)).find(Boolean)
      : undefined
  return hit == undefined ? undefined : pick(map[hit])
}

/// npmFiles('/n/x', 'sub', { exports: { './sub': { types: './s.d.ts', import: './s.js' } } }) -> ['/n/x/s.d.ts', '/n/x/s']
/// npmFiles('/n/x', 'a/b.js', {}) -> ['/n/x/a/b']
/// npmFiles('/n/x', '', {}) -> ['/n/x']
/**
 * The files a package at `dir` may give for `sub`, for tsc to try in turn:
 * its `exports` entry for types, then for import, or the path itself. A
 * script is named without its `.js`, so tsc reads the declaration beside it
 * first.
 */
export let npmFiles = (
  dir: string,
  sub: string,
  manifest: Record<string, unknown>,
) => {
  let key = sub ? `./${sub}` : '.'
  let hits = manifest.exports
    ? [['types', 'deno', 'import'], ['deno', 'import']]
      .flatMap((conditions) => entry(manifest.exports, key, conditions) ?? [])
      .map((hit) => `${dir}/${hit.replace(/^\.\//, '')}`)
    : []
  return [...new Set(hits.length ? hits : [sub ? `${dir}/${sub}` : dir])]
    .map((path) => path.replace(/\.js$/, ''))
}

/**
 * The project at `dir` checking `roots`, files under `checkout`: Deno's
 * resolution of their graph (`info`), the manifest of each npm package by id,
 * and the compiler options Deno is configured with.
 */
export let project = (
  info: Info,
  checkout: string,
  dir: string,
  roots: string[],
  manifests: Record<string, Record<string, unknown>>,
  options: Record<string, unknown> = {},
): Project => {
  let base = `file://${checkout}/`
  let modules = new Map(info.modules.map((m) => [m.specifier, m]))
  let at = (s: string) => {
    let npm = s.replace(/^npm:(?!\/)/, 'npm:/')
    return info.redirects[npm] ?? info.redirects[s] ?? npm
  }
  let placed = tree(info.npmPackages, [
    ...new Set(info.modules.flatMap((m) => m.npmPackage ?? [])),
  ])
  let home = new Map([...placed].map(([path, id]) => [id, path]))
  let files: Record<string, string> = {}
  let links: Record<string, string> = {}
  let spread: Record<string, string> = {}
  let paths: Record<string, string[]> = {}
  let external = new Set<string>()
  let node = false

  // The files tsc may read, in turn, for a module Deno resolved.
  let candidates = (url: string): string[] => {
    let m = modules.get(url)
    if (url.startsWith('file://')) return [url.slice('file://'.length)]
    if (/^https?:/.test(url)) return [`${dir}/${within(url)}`]
    if (m?.npmPackage) {
      let { name } = info.npmPackages[m.npmPackage]
      let sub = url.slice(`npm:/${name}@`.length).replace(/^[^/]*\/?/, '')
      let pkg = `${dir}/node_modules/${home.get(m.npmPackage)}`
      return npmFiles(pkg, sub, manifests[m.npmPackage] ?? {})
    }
    if (m?.kind == 'node') node = true
    return []
  }

  for (let m of info.modules) {
    let remote = /^https?:/.test(m.specifier)
    if (remote && m.local) links[within(m.specifier)] = m.local
    if (m.kind == 'external') external.add(m.specifier)
    let script = /^(TypeScript|JavaScript|TSX|JSX)$/.test(m.mediaType ?? '') &&
      m.specifier.startsWith(base) && !/\.[mc]?[jt]sx?$/.test(m.specifier)
    if (script) {
      links[`overlay/${m.specifier.slice(base.length)}.ts`] = m.local!
    }
    for (let d of m.dependencies ?? []) {
      let url = d.type?.specifier ?? d.code?.specifier
      let tos = url ? candidates(at(url)) : []
      if (!tos.length) continue
      if (!/^\.\.?\//.test(d.specifier)) {
        paths[d.specifier] ??= tos.map((to) => relative(dir, to))
        continue
      }
      // A relative import that Deno resolves away from its neighbour.
      let [to] = tos
      let near = new URL(d.specifier, m.specifier).href
      let [seen] = candidates(near)
      if (!seen || seen == to || !(remote || near.startsWith(base))) continue
      let stub = remote
        ? within(near)
        : `overlay/${near.slice(base.length).replace(/\.[mc]?js$/, '.d.ts')}`
      let from = `${dir}/${stub}`.replace(/\/[^/]*$/, '')
      files[stub] = `export * from ${JSON.stringify(relative(from, to))}\n`
      delete links[stub]
    }
  }
  for (let s of external) delete paths[s]
  let parents = new Set(
    [...placed.keys()].map((p) =>
      p.replace(/\/node_modules\/(@[^/]+\/)?[^/]+$/, '')
    ),
  )
  for (let [path, id] of placed) {
    let to = parents.has(path) ? spread : links
    to[`node_modules/${path}`] = info.npmPackages[id].localPath
  }
  files['externals.d.ts'] = [...external]
    .map((s) => `declare module ${JSON.stringify(s)}\n`).join('')
  return {
    files,
    links,
    spread,
    config: {
      compilerOptions: {
        ...options,
        noEmit: true,
        target: 'esnext',
        module: 'esnext',
        moduleResolution: 'bundler',
        moduleDetection: 'force',
        allowJs: true,
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        esModuleInterop: true,
        preserveSymlinks: true,
        skipLibCheck: true,
        strict: true,
        noImplicitOverride: true,
        types: node ? ['node'] : [],
        typeRoots: ['./node_modules/@types'],
        rootDirs: [relative(dir, checkout), './overlay'],
        paths,
      },
      files: [
        './deno.d.ts',
        './externals.d.ts',
        ...roots.map((r) => relative(dir, `${checkout}/${r}`)),
      ],
    },
  }
}
