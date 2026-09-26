// What a deploy must compile, read out of an app's files, or nothing.
//
// Two kinds of entry. The worker is the app's server source (the host says
// which file that is), compiled when a file it reaches is TypeScript or JSX,
// or when it imports a package: the runtime has no registry, so a package it
// imports is either compiled in or missing. A page script is each
// `<script type="module" src>` an HTML file loads, compiled when a file it
// reaches is TypeScript or JSX, or when it imports a package package.json
// names. A package package.json does not name is left to the browser, where
// an import map may name it; the deploy says so rather than guessing.
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
  let text = async (path: string) => {
    let bytes = has.has(path) ? await app.read(path) : null
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
  let readApp: Read = (path) =>
    has.has(path) ? app.read(path) : Promise.resolve(null)

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

  let pages: string[] = []
  let htmls = app.paths.filter((p) => /\.html?$/i.test(p))
  for (let page of htmls) {
    for (let entry of loaded(page, await text(page) ?? '')) {
      if (pages.includes(entry) || !has.has(entry) || !script(entry)) continue
      let { files: reached, named: specs } = await sources(readApp, entry)
      let packages = specs.map(packageOf).filter((p): p is string => !!p)
      let wanted = packages.filter((p) => named.has(p))
      if (![...reached.keys()].some(typed) && !wanted.length) continue
      pages.push(entry)
      send(reached)
      for (let p of new Set(packages.filter((p) => !named.has(p)))) {
        notes.push(
          `${entry} imports ${p}, which package.json does not name: it is ` +
            'left to the browser, so the page needs an import map for it',
        )
      }
      for (let css of [...reached.keys()].filter((p) => p.endsWith('.css'))) {
        notes.push(
          `${entry} imports ${css}, and a compiled page script leaves CSS ` +
            `out: link it from the page instead`,
        )
      }
    }
  }

  if (!worker && !pages.length) return null
  if (pkg != null) files['package.json'] = pkg
  let lock = await text('package-lock.json')
  if (lock != null) files['package-lock.json'] = lock
  return { ask: { files, worker, pages }, notes }
}
