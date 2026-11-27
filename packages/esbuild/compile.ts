// The compile itself: npm packages installed at the pinned versions
// (./npm.ts) alongside compiler-owned toolkit sources, then esbuild bundling
// the worker and each page script (./bundle.ts). esbuild is native, a process
// of its own beside this one, so the compile runs wherever a process can start
// one: under Deno, and for yaks.app in a container. `default` is that
// container's server: it takes a {@link Job} and answers an {@link Answer}.
//
// It is handed app files and the toolkit catalog, and caches shared browser
// modules across jobs. It holds no binding, secret or store; the npm registry
// is the one thing it reaches.
//
// What is left of an output's imports once esbuild is done is checked here,
// because a build leaves any import it cannot resolve as an import rather
// than failing: in a worker that is a module the upload refuses, and in a
// page it is a request the browser makes for nothing.
import { parse } from 'es-module-lexer/js'
import { isBuiltin } from 'node:module'
import { posix } from 'node:path'
import { bundle, type Options, Stopped } from './bundle.ts'
import { packageOf, relative, resolved, twins } from './graph.ts'
import { lockfile, type Pins, pins, reached, split, wanted } from './lock.ts'
import * as npm from './npm.ts'
import { type Answer, type Ask, dependencies } from './plan.ts'
import { said } from './said.ts'
import { external, flat, pack, shared, unexported } from './shared.ts'
import { header, phase, type Report, type Timing } from './timing.ts'
import { homes } from './home.ts'
import { type Catalog, located, type Seed, seed } from './platform.ts'
export type { Catalog, Toolkit } from './platform.ts'
export { Stopped } from './bundle.ts'

/** What a host posts to the compiler's server: the app's ask, and beside it
 * the toolkit catalog, which the host supplies and an app never does. */
export type Job = {
  ask: Ask
  catalog: Catalog
  origin?: string
  /** The host can store and serve content-addressed browser modules. */
  shared?: boolean
}

/** The module a compiled worker is uploaded as: its source's path, as
 * JavaScript.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(compiledName('src/worker.ts'), 'src/worker.js')
 * assertEquals(compiledName('worker.mjs'), 'worker.mjs')
 * ```
 */
export let compiledName = (entry: string): string =>
  entry.replace(/\.(?:ts|tsx|jsx|mts|cts|cjs)$/, '.js')

/** The specifiers still imported by a compiled module. */
let imports = (code: string) =>
  parse(code)[0].map((i) => i.n).filter((n): n is string => !!n)

// A package the lock can be read from: its own package.json's dependencies.
let needs = (fs: npm.Files) => (name: string) => {
  try {
    let pkg = JSON.parse(fs.read(`node_modules/${name}/package.json`) ?? '{}')
    return Object.keys(pkg.dependencies ?? {})
  } catch {
    return []
  }
}

/** Install what package.json asks at what the lock pins, and say the lock
 * that results. Throws what the installer could not do. */
let install = async (
  fs: npm.Files,
  ask: Ask,
  setup: Seed,
  catalog: Catalog,
  get?: typeof fetch,
  report?: Report,
) => {
  let pkg = ask.files['package.json'] ?? null
  let ranges = dependencies(pkg)
  let want = wanted(
    setup.dependencies,
    pins(ask.files['package-lock.json'] ?? null),
  )
  let { installed, warnings } = await npm.install(
    fs,
    want,
    get,
    npm.REGISTRY,
    report && ((ms) => report('registry', ms)),
  )
  if (warnings.length) {
    throw new Error(warnings.map((w) => `npm: ${w}`).join('\n'))
  }
  let all: Pins = {
    ...Object.fromEntries(installed.map(split)),
    ...setup.platform,
  }
  let needed = needs(fs)
  let kept = reached(
    Object.keys(ranges),
    all,
    (name) =>
      name in setup.platform
        ? Object.keys(catalog[name].dependencies)
        : needed(name),
  )
  let name = pkg == null ? undefined : JSON.parse(pkg).name
  return {
    installed: Object.entries(kept).map(([n, v]) => `${n}@${v}`).sort(),
    lock: pkg == null ? undefined : lockfile(name, ranges, kept),
  }
}

// A `.js` import meaning a TypeScript file that was sent: esbuild's own
// resolver reads that convention, and ./bundle.ts, which resolves the
// extension it is given, does not.
let twin = (ask: Ask, at: string, spec: string) => {
  let typed = twins(at).find((t) => t in ask.files)
  return typed
    ? `imports ${spec}, which is ${typed}: write the import with the ` +
      `file's own extension, or with none`
    : null
}

// Why a worker's leftover import will not link, or null when it will.
let unlinked = (ask: Ask, main: string) => (spec: string) => {
  let { flags, carry } = ask.worker!
  if (spec.startsWith('cloudflare:') || spec.startsWith('node:')) return null
  if (flags.includes('nodejs_compat') && isBuiltin(spec)) return null
  let name = packageOf(spec)
  if (name) {
    return `imports ${spec}, which is not installed: name ${name} in ` +
      'package.json dependencies'
  }
  if (!relative(spec)) return `imports ${spec}, which no worker can load`
  let at = resolved(main, spec)
  if (carry.includes(at)) return null
  return twin(ask, at, spec) ?? `imports ${spec}, which names no file`
}

// A page's leftover import is the browser's to fetch, the way every page
// fetches ./api/client.js, unless it meant a file that was compiled in.
let unfetched = (ask: Ask, entry: string) => (spec: string) =>
  relative(spec) ? twin(ask, resolved(entry, spec), spec) : null

/// browserless('import"node:fs";import"https://o/a.js";import("node:os")') -> ['node:fs']
/** The modules a page imports statically that no browser has: Node's
 * built-ins, which a module written for the toolkit's other hosts can reach.
 * A browser links a page's whole static graph before it runs a line of it, so
 * one such import anywhere in the graph stops the page (yak.sh v50, whose
 * @yaks/cli/terminal reached node:fs). `code` is the page as served, with
 * every shared module it reaches named ({@link flat}); a dynamic import is
 * fetched only when it runs, so the code that asks for it decides. */
export let browserless = (code: string): string[] => [
  ...new Set(
    parse(code)[0].flatMap((i) =>
      i.d == -1 && i.n?.startsWith('node:') ? [i.n] : []
    ),
  ),
]

// Why a page will not link in a browser for a Node built-in it reaches, naming
// the page or the shared modules (by the specifier the page imports them by)
// that import it; empty when it reaches none.
let nodeOnly = (
  entry: string,
  code: string,
  page: string,
  shared: Record<string, string> = {},
  urls: Record<string, string>,
  origin: string,
): string[] => {
  let node = browserless(page)
  if (!node.length) return []
  let names = new Map(Object.entries(urls).map(([spec, url]) => [url, spec]))
  let reached = new Set(parse(page)[0].map((i) => i.n))
  let from = [
    ...browserless(code).length ? [entry] : [],
    ...Object.entries(shared)
      .filter(([path, text]) =>
        reached.has(`${origin}/${path}`) && browserless(text).length
      )
      .map(([path]) => names.get(`${origin}/${path}`) ?? path),
  ]
  return [
    `imports ${node.join(', ')} through ${from.join(', ')}, and no browser ` +
    'has it: a module the page loads is written for a server',
  ]
}

/// realms(['a', 'b', 'c', 'w'], [['a', 'b'], ['b', 'c', 'x']]) -> [['a', 'b', 'c'], ['w']]
/// realms(['a', 'w'], undefined) -> [['a'], ['w']]
/** The pages that share one pack: those an HTML page loads together, joined
 * through a page two HTML pages load. */
export let realms = (pages: string[], together: string[][] = []) => {
  let of = new Map(pages.map((page) => [page, new Set([page])]))
  for (let group of together) {
    let joined = new Set(group.flatMap((page) => [...of.get(page) ?? []]))
    for (let page of joined) of.set(page, joined)
  }
  return [...new Set(of.values())].map((realm) => [...realm])
}

let checked = (
  entry: string,
  code: string,
  why: (spec: string) => string | null,
) =>
  imports(code).map(why).filter((w): w is string => !!w).map((w) =>
    `${entry} ${w}`
  )

/** Compile what an ask names. Never throws for the app's own mistakes: those
 * are the answer's `errors`. Throws {@link Stopped} when esbuild's process
 * ends under a build, which is the compiler's room and not the app's code.
 * The host supplies its toolkit catalog separately from the app's ask, and
 * `get` is how the npm registry is fetched. */
export let compile = async (
  ask: Ask,
  catalog: Catalog = {},
  origin = 'https://yaks.app',
  options: { shared?: boolean; get?: typeof fetch; timing?: boolean } = {},
): Promise<Answer> => {
  let timing: Timing | undefined = options.timing
    ? {
      install: 0,
      registry: 0,
      worker: 0,
      carried: 0,
      used: 0,
      groups: 0,
      cache: 0,
      pages: 0,
      total: 0,
      hits: 0,
      misses: 0,
    }
    : undefined
  let report: Report | undefined = timing
    ? (name, ms) => {
      timing![name] += ms
    }
    : undefined
  let total = phase(report, 'total')
  let done = (answer: Answer) => {
    total()
    return answer
  }
  origin = origin.replace(/\/$/, '')
  let tarballs: Record<string, string> = {}
  let answer: Answer = {
    ...(timing ? { timing } : {}),
    pages: {},
    assets: {},
    tarballs,
    installed: [],
    notes: [],
    errors: [],
  }
  let fs: npm.Files
  let setup: Seed
  let installing = phase(report, 'install')
  try {
    setup = seed(ask.files, catalog)
    answer.notes.push(...setup.notes)
    answer.assets = options.shared === false || ask.worker || !ask.pages.length
      ? setup.assets
      : {}
    fs = new npm.Files(setup.files)
    Object.assign(
      answer,
      await install(fs, ask, setup, catalog, options.get, report),
    )
  } catch (e) {
    installing()
    return done({ ...answer, errors: said(e) })
  } finally {
    installing()
  }
  let locate = (entry: string | URL) => {
    for (let [path, source] of Object.entries(located(setup.files, entry))) {
      fs.write(path, source)
    }
  }
  // One entry built, its package URLs located against `at` and its leftover
  // imports judged by `why`; null when it failed, and the failure is among
  // the answer's errors.
  let built = async (
    entry: string,
    at: string | URL,
    options: Options,
    why: (spec: string) => string | null,
  ) => {
    try {
      locate(at)
      let { code, warnings } = await bundle(fs, entry, options)
      answer.errors.push(...checked(entry, code, why))
      answer.notes.push(...warnings.map((w) => `${entry}: ${w}`))
      return code
    } catch (e) {
      if (e instanceof Stopped) throw e
      answer.errors.push(...said(e))
      return null
    }
  }
  if (ask.worker) {
    let finish = phase(report, 'worker')
    try {
      let { entry, flags, carry } = ask.worker
      let main = compiledName(entry)
      let separate = new Set(carry)
      let code = await built(
        entry,
        // A workerd module name is not a URL. Its file URL is a logical
        // identity, not a hosted asset address; a page keeps its browser's URL.
        new URL(main, 'file:///'),
        {
          node: flags.includes('nodejs_compat'),
          external: (spec, importer, attributes) => {
            if (attributes.type == 'text' || !relative(spec)) return
            let path = resolved(importer, spec)
            if (!separate.has(path)) return
            let moved = posix.relative(posix.dirname(main), path)
            return relative(moved) ? moved : './' + moved
          },
        },
        unlinked(ask, main),
      )
      if (code != null) answer.worker = { main, code }
    } finally {
      finish()
    }
  }
  let urls: Record<string, string> = {}
  if (ask.pages.length && options.shared !== false) {
    try {
      let modules = await shared(fs, setup, catalog, origin, ask.pages, {
        timing: report,
      })
      answer.shared = modules.files
      Object.assign(tarballs, modules.tarballs)
      urls = modules.urls
    } catch (e) {
      if (e instanceof Stopped) throw e
      return done({ ...answer, errors: [...answer.errors, ...said(e)] })
    }
  }
  // A page's npm package module is served from its package's home.
  let pages = phase(report, 'pages')
  let codes: Record<string, string> = {}
  try {
    let home = homes((name) => fs.tarball(name), origin)
    for (let entry of ask.pages) {
      let code = await built(entry, entry, {
        minify: true,
        moved: home.moved,
        ...options.shared !== false ? { external: external(urls) } : {},
        // What a package written for bundlers asks of its environment.
        define: { 'process.env.NODE_ENV': '"production"' },
      }, unfetched(ask, entry))
      if (code == null) continue
      let missing = unexported(code, answer.shared ?? {}, origin, urls)
      let page = flat(code, answer.shared ?? {}, origin)
      missing.push(...nodeOnly(entry, code, page, answer.shared, urls, origin))
      if (missing.length) {
        answer.errors.push(...missing.map((line) => `${entry}: ${line}`))
      } else codes[entry] = code
    }
    Object.assign(tarballs, home.tarballs)
    // Scripts an HTML page loads together import one pack, so a module two
    // of them import is one instance; another script, a module worker
    // included, gets its own, and evaluates only what it imports.
    for (let realm of realms(Object.keys(codes), ask.together)) {
      let packed = await pack(
        Object.fromEntries(realm.map((entry) => [entry, codes[entry]])),
        answer.shared ?? {},
        origin,
      )
      if (answer.shared) Object.assign(answer.shared, packed.files)
      Object.assign(answer.pages, packed.pages)
    }
  } catch (e) {
    if (e instanceof Stopped) throw e
    answer.errors.push(...said(e))
  } finally {
    pages()
  }
  return done(answer)
}

/** The compiler's server: a {@link Job} in, its {@link Answer} out, and 507
 * when esbuild's process ended under the build, killed for memory or stopped
 * with its host. */
export default {
  fetch: async (req: Request): Promise<Response> => {
    if (req.method != 'POST') return new Response('POST a job', { status: 405 })
    let began = performance.now()
    let { ask, catalog, origin, shared } = await req.json() as Job
    let parsed = performance.now() - began
    try {
      let answer = await compile(ask, catalog, origin, {
        shared: shared === true,
        timing: true,
      })
      let at = performance.now()
      let body = JSON.stringify(answer)
      let serialized = performance.now() - at
      return new Response(body, {
        headers: {
          'content-type': 'application/json',
          'server-timing': [
            header(answer.timing!),
            `compiler_parse;dur=${parsed.toFixed(3)}`,
            `compiler_serialize;dur=${serialized.toFixed(3)}`,
            `compiler_request;dur=${(performance.now() - began).toFixed(3)}`,
          ].join(', '),
        },
      })
    } catch (e) {
      if (e instanceof Stopped) return new Response(e.message, { status: 507 })
      throw e
    }
  },
}
