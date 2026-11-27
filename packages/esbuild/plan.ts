// What a deploy must compile, read out of an app's files, or nothing.
//
// Two kinds of entry. The worker is the app's server source (the host says
// which file that is), compiled when a file it reaches is TypeScript or JSX,
// or when it imports a package: the runtime has no registry, so a package it
// imports is either compiled in or missing. A page script is each
// `<script type="module" src>` an HTML file loads, compiled when a file it
// reaches is TypeScript or JSX, or when it imports a package package.json
// names. A package package.json does not name is left to the browser, which
// resolves it through the page's import map; the deploy says so when the map
// does not name it. A module worker a page script starts (`new Worker(new
// URL('./grow.ts', import.meta.url))`) is a page script too, compiled by the
// same rule, except that no import map reaches it.
//
// File-only apps with no TypeScript or package.json plan nothing. A JavaScript
// worker can also ask the compiler to embed a text import.
import type { Catalog } from './platform.ts'
import type { Timing } from './timing.ts'
import {
  packageOf,
  type Reached,
  type Read,
  resolved,
  script,
  sources,
  type Strip,
  typed,
} from './graph.ts'
import { dependencies, Unplanned } from './dependencies.ts'

export { dependencies, Unplanned }

/** An app's files, as the host holds them. */
export type App = {
  /** Every file the app wrote, by its path from the app's root. */
  paths: string[]
  read: Read
  /** The server source, when the app has one. */
  main?: string
  /** Its compatibility flags (`nodejs_compat` changes how it compiles). */
  flags?: string[]
  /** The folder its pages are served from, when not its root (a build's
   * `dist`): only HTML inside it is a page whose scripts are compiled. */
  served?: string
  /** How its TypeScript and JSX are read as JavaScript (`./strip`), asked
   * only of an app that has some. */
  strip: Strip
}

/** What the compiler is handed: the text of every file a build reads, and
 * which entries to build. */
export type Ask = {
  files: Record<string, string>
  worker?: {
    entry: string
    flags: string[]
    /** What it imports that is not compiled in (a `.wasm`, a `.txt`): the
     * host uploads each beside the compiled module, by its own path. */
    carry: string[]
  }
  /** The page scripts to compile, and the module workers they start. */
  pages: string[]
  /** The pages one HTML page loads together, where it loads two or more:
   * they share one pack of shared modules (./shared.ts `pack`). */
  together?: string[][]
}

/** What the compiler answers. Any `errors` mean nothing it made may be used;
 * each is a line an agent can act on. */
export type Answer = {
  /** Compiler wall-clock milliseconds, when timing was requested. */
  timing?: Timing
  /** The compiled worker: one ES module, uploaded under `main`. */
  worker?: { main: string; code: string }
  /** Each compiled page script, by the entry's own path. */
  pages: Record<string, string>
  /** Runtime package resources, under a reserved package-relative namespace. */
  assets: Record<string, string>
  /** Content-addressed browser modules and resources, shared across apps. */
  shared?: Record<string, string>
  /** The registry tarball that fills each npm package home the compiled code
   * names, by the SHA-256 that names the home (./home.ts). */
  tarballs?: Record<string, string>
  /** package-lock.json as the build left it, when the app has a package.json. */
  lock?: string
  /** What the lock holds, as `name@version`. */
  installed: string[]
  notes: string[]
  errors: string[]
}

/** The plan: what to ask, what to say, and each entry's own source paths. */
export type Plan = {
  ask: Ask
  notes: string[]
  inputs: { worker?: string[]; pages: Record<string, string[]> }
  /** Every existing source read to decide this plan, including plain JS. */
  reads: string[]
}

// What esbuild reads as source. Anything else a worker imports is a module of
// its own kind (`.wasm`, `.txt`, bytes) that the runtime links as it is.
let COMPILED = /\.(?:js|mjs|cjs|ts|tsx|jsx|mts|cts|json|css)$/

let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** Each toolkit package of a catalog: its source digest, and the toolkit
 * packages it depends on. A host keeps this beside the catalog, small enough
 * to read wherever it asks whether a compile's toolkit is still current. */
export type Toolkits = Record<string, { version: string; uses: string[] }>

/** A catalog's {@link Toolkits}.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   toolkits({
 *     '@yaks/a': {
 *       files: {},
 *       dependencies: { '@yaks/b': 'platform', preact: '10.29.7' },
 *       version: 'sha256:a',
 *     },
 *   }),
 *   { '@yaks/a': { version: 'sha256:a', uses: ['@yaks/b'] } },
 * )
 * ```
 */
export let toolkits = (catalog: Catalog): Toolkits =>
  Object.fromEntries(
    Object.entries(catalog).map(([name, pkg]) => [name, {
      version: pkg.version,
      uses: Object.keys(pkg.dependencies).filter((dep) =>
        dep.startsWith('@yaks/')
      ),
    }]),
  )

/** The compiler's own entry among the toolkit's digests, where a host keeps
 * one: the source of this package, which makes what pages compile to, as a
 * toolkit package's source makes what they import. */
export let COMPILER: string = '@yaks/esbuild'

/** The source digest of each toolkit package a package.json reaches, through
 * the toolkit's own dependencies, as a compile seeds them, and of the
 * compiler: what that compile was made of. A package the toolkit does not
 * have is left out.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let kit = {
 *   '@yaks/a': { version: 'sha256:a', uses: ['@yaks/b'] },
 *   '@yaks/b': { version: 'sha256:b', uses: [] },
 *   '@yaks/c': { version: 'sha256:c', uses: [] },
 * }
 * let pkg = '{"dependencies": {"@yaks/a": "platform", "three": "1"}}'
 * assertEquals(toolkitOf(pkg, kit), {
 *   '@yaks/a': 'sha256:a',
 *   '@yaks/b': 'sha256:b',
 * })
 * assertEquals(toolkitOf(null, kit), {})
 * assertEquals(
 *   toolkitOf(null, { '@yaks/esbuild': { version: 'sha256:e', uses: [] } }),
 *   { '@yaks/esbuild': 'sha256:e' },
 * )
 * ```
 */
export let toolkitOf = (
  pkg: string | null,
  kit: Toolkits,
): Record<string, string> => {
  let out: Record<string, string> = kit[COMPILER]
    ? { [COMPILER]: kit[COMPILER].version }
    : {}
  let visit = (name: string) => {
    if (name in out || !kit[name]) return
    out[name] = kit[name].version
    kit[name].uses.forEach(visit)
  }
  Object.keys(dependencies(pkg)).forEach(visit)
  return out
}

let TAG = /<script\b[^>]*>/gi
let SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i
let MODULE = /\btype\s*=\s*(?:"module"|'module'|module\b)/i

/** The module scripts an HTML file loads from the app's own files, by path.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   loaded('games/index.html', `<script type="module" src="./main.ts?v=2">` +
 *     `</script><script src="old.js"></script>` +
 *     `<script type=module src="https://esm.sh/x"></script>`),
 *   ['games/main.ts'],
 * )
 * ```
 */
export let loaded = (page: string, html: string): string[] =>
  [...html.matchAll(TAG)]
    .filter(([tag]) => MODULE.test(tag))
    .map(([tag]) => tag.match(SRC))
    .map((m) => m && (m[1] ?? m[2] ?? m[3]).replace(/[?#].*$/, ''))
    .filter((src): src is string =>
      !!src && !src.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(src)
    )
    .map((src) => resolved(page, src.startsWith('.') ? src : `./${src}`))

let MAP =
  /<script\b[^>]*\btype\s*=\s*(?:"importmap"|'importmap'|importmap\b)[^>]*>([\s\S]*?)<\/script/gi

// The keys of an import map's `imports`; none when it is not JSON, which the
// browser refuses too.
let keys = (json: string): string[] => {
  try {
    let imports = JSON.parse(json)?.imports
    return imports && typeof imports == 'object' ? Object.keys(imports) : []
  } catch {
    return []
  }
}

/** What an HTML file's import maps name: every key of their `imports`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   mapped(`<script type=importmap>{"imports": {"three": "https://esm.sh/` +
 *     `three", "lit/": "https://esm.sh/lit/"}}</script>`),
 *   ['three', 'lit/'],
 * )
 * ```
 */
export let mapped = (html: string): string[] =>
  [...html.matchAll(MAP)].flatMap(([, json]) => keys(json))

// Whether an import map's keys resolve a specifier: a key names it, or ends
// in `/` and begins it.
let covers = (map: string[], spec: string) =>
  map.some((key) => key == spec || key.endsWith('/') && spec.startsWith(key))

/**
 * What a deploy of this app compiles, or null when nothing needs compiling.
 * Throws {@link Unplanned} when package.json cannot be read.
 */
export let plan = async (app: App): Promise<Plan | null> => {
  let main = app.main && app.paths.includes(app.main) ? app.main : undefined
  // Skip file-only apps that have no inputs to the compiler.
  if (!main && !app.paths.includes('package.json') && !app.paths.some(typed)) {
    return null
  }
  let has = new Set(app.paths)
  // The worker and each page walk their own graph, often through the same
  // modules. Keep one reading of each file for this deploy.
  let reads = new Map<string, ReturnType<Read>>()
  let readApp: Read = (path) => {
    if (!has.has(path)) return Promise.resolve(null)
    let pending = reads.get(path)
    if (pending) return pending
    pending = app.read(path)
    reads.set(path, pending)
    return pending
  }
  let text = async (path: string) => {
    let bytes = await readApp(path)
    return bytes && decode(bytes)
  }
  let pkg = await text('package.json')
  let named = new Set(Object.keys(dependencies(pkg)))
  let files: Record<string, string> = {}
  let notes: string[] = []
  let inputs: Plan['inputs'] = { pages: {} }
  let send = ({ files: reached, texts }: Reached) => {
    let paths = [...reached.keys()].filter((p) =>
      COMPILED.test(p) || texts.has(p)
    )
    for (let path of paths) files[path] = decode(reached.get(path)!)
    return paths
  }
  let walk = sources(app.strip)
  let worker: Ask['worker']
  if (main) {
    let graph = await walk(readApp, main)
    let { files: reached, named: specs, texts, linked } = graph
    let packages = specs.filter((s) => packageOf(s))
    if ([...reached.keys()].some(typed) || packages.length || texts.size) {
      inputs.worker = send(graph)
      worker = {
        entry: main,
        flags: app.flags ?? [],
        carry: [...reached.keys()].filter((p) =>
          !COMPILED.test(p) && (!texts.has(p) || linked.has(p))
        ),
      }
    }
  }

  // Each module script the pages load, with the import map of every page
  // that loads it. A worker a script starts joins as the walk finds it, with
  // no import map at all, since none reaches a worker.
  let loads = new Map<string, string[][]>()
  let started = new Set<string>()
  let served = app.served ? `${app.served}/` : ''
  let pagesOf = app.paths.filter((p) =>
    /\.html?$/i.test(p) && p.startsWith(served)
  )
  let documents: string[][] = []
  for (let page of pagesOf) {
    let html = await text(page) ?? ''
    let entries = loaded(page, html)
    documents.push(entries)
    for (let entry of entries) {
      loads.set(entry, [...loads.get(entry) ?? [], mapped(html)])
    }
  }
  let pages: string[] = []
  for (let [entry, maps] of loads) {
    if (!has.has(entry) || !script(entry)) continue
    let graph = await walk(readApp, entry)
    let { files: reached, named: specs, started: starts, texts } = graph
    let wanted = specs.filter((s) => named.has(packageOf(s) ?? ''))
    let compiled = [...reached.keys()].some(typed) || wanted.length > 0 ||
      texts.size > 0
    // esbuild leaves `import.meta.url` as written, so in a compiled script
    // it is the entry's address, and a worker's path resolves against the
    // entry; in a script served as written, against the file that names it.
    for (let [from, spec] of starts) {
      let path = resolved(compiled ? entry : from, spec)
      if (loads.has(path)) continue
      started.add(path)
      loads.set(path, [[]])
    }
    if (!compiled) continue
    pages.push(entry)
    inputs.pages[entry] = send(graph)
    // A package the compile leaves in is the browser's to resolve, and only
    // an import map on every page that loads the script resolves it.
    for (let spec of specs) {
      let name = packageOf(spec)
      if (!name || named.has(name) || maps.every((m) => covers(m, spec))) {
        continue
      }
      notes.push(
        `${entry} imports ${spec}, which ` +
          (started.has(entry)
            ? 'package.json does not name, and no import map reaches a ' +
              'module worker, so the browser cannot load it'
            : "neither package.json nor the page's import map names, so the " +
              'browser cannot load it'),
      )
    }
    for (
      let css of [...reached.keys()].filter((p) =>
        p.endsWith('.css') && !texts.has(p)
      )
    ) {
      notes.push(
        `${entry} imports ${css}, and a compiled page script leaves CSS ` +
          `out: link it from the page instead`,
      )
    }
  }

  if (!worker && !pages.length) return null
  if (pkg != null) files['package.json'] = pkg
  let lock = await text('package-lock.json')
  if (lock != null) files['package-lock.json'] = lock
  let together = documents
    .map((entries) => [...new Set(entries.filter((e) => pages.includes(e)))])
    .filter((entries) => entries.length > 1)
  return {
    ask: { files, worker, pages, ...together.length ? { together } : {} },
    notes,
    inputs,
    reads: [...reads.keys()],
  }
}
