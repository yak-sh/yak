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
// An app with no TypeScript and no package.json plans nothing, without a
// file read, and its deploy is the one it always was.
import {
  packageOf,
  type Read,
  resolved,
  script,
  sources,
  typed,
} from './graph.ts'

/** A plan that cannot be made, in a sentence the agent can act on. */
export class Unplanned extends Error {
  override name = 'Unplanned'
}

/** An app's files, as the host holds them. */
export type App = {
  /** Every file the app wrote, by its path from the app's root. */
  paths: string[]
  read: Read
  /** The server source, when the app has one. */
  main?: string
  /** Its compatibility flags (`nodejs_compat` changes how it compiles). */
  flags?: string[]
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
}

/** What the compiler answers. Any `errors` mean nothing it made may be used;
 * each is a line an agent can act on. */
export type Answer = {
  /** The compiled worker: one ES module, uploaded under `main`. */
  worker?: { main: string; code: string }
  /** Each compiled page script, by the entry's own path. */
  pages: Record<string, string>
  /** package-lock.json as the build left it, when the app has a package.json. */
  lock?: string
  /** What the lock holds, as `name@version`. */
  installed: string[]
  notes: string[]
  errors: string[]
}

/** The plan: what to ask, and what to say beside the answer. */
export type Plan = { ask: Ask; notes: string[] }

// What esbuild reads as source. Anything else a worker imports is a module of
// its own kind (`.wasm`, `.txt`, bytes) that the runtime links as it is.
let COMPILED = /\.(?:js|mjs|cjs|ts|tsx|jsx|mts|cts|json|css)$/

let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** The packages package.json declares, name to version range; none without
 * one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(dependencies('{"dependencies": {"three": "^0.180.0"}}'), {
 *   three: '^0.180.0',
 * })
 * assertEquals(dependencies(null), {})
 * ```
 */
export let dependencies = (text: string | null): Record<string, string> => {
  if (text == null) return {}
  let pkg: { dependencies?: unknown }
  try {
    pkg = JSON.parse(text)
  } catch (e) {
    throw new Unplanned(`package.json is not JSON: ${(e as Error).message}`)
  }
  let deps = pkg?.dependencies ?? {}
  if (
    typeof deps != 'object' || deps == null || Array.isArray(deps) ||
    Object.values(deps).some((v) => typeof v != 'string')
  ) {
    throw new Unplanned(
      'package.json: dependencies is an object of package name to version, ' +
        'e.g. {"dependencies": {"three": "^0.180.0"}}',
    )
  }
  return deps as Record<string, string>
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
  // Without TypeScript there is nothing to compile but packages, and a
  // package is installed only when package.json names it. So an app with
  // neither is not read at all, and its deploy costs what it always did.
  if (!app.paths.includes('package.json') && !app.paths.some(typed)) {
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
  let send = (reached: Map<string, Uint8Array>) => {
    for (let [path, bytes] of reached) {
      if (COMPILED.test(path)) files[path] = decode(bytes)
    }
  }
  let worker: Ask['worker']
  if (app.main && has.has(app.main)) {
    let { files: reached, named: specs } = await sources(readApp, app.main)
    let packages = specs.filter((s) => packageOf(s))
    if ([...reached.keys()].some(typed) || packages.length) {
      send(reached)
      worker = {
        entry: app.main,
        flags: app.flags ?? [],
        carry: [...reached.keys()].filter((p) => !COMPILED.test(p)),
      }
    }
  }

  // Each module script the pages load, with the import map of every page
  // that loads it. A worker a script starts joins as the walk finds it, with
  // no import map at all, since none reaches a worker.
  let loads = new Map<string, string[][]>()
  let started = new Set<string>()
  for (let page of app.paths.filter((p) => /\.html?$/i.test(p))) {
    let html = await text(page) ?? ''
    for (let entry of loaded(page, html)) {
      loads.set(entry, [...loads.get(entry) ?? [], mapped(html)])
    }
  }
  let pages: string[] = []
  for (let [entry, maps] of loads) {
    if (!has.has(entry) || !script(entry)) continue
    let { files: reached, named: specs, started: starts } = await sources(
      readApp,
      entry,
    )
    let wanted = specs.filter((s) => named.has(packageOf(s) ?? ''))
    let compiled = [...reached.keys()].some(typed) || wanted.length > 0
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
    send(reached)
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
    for (let css of [...reached.keys()].filter((p) => p.endsWith('.css'))) {
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
  return { ask: { files, worker, pages }, notes }
}
