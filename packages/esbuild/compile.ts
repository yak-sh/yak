// The compile itself: npm packages installed at the pinned versions
// (./npm.ts) alongside compiler-owned toolkit sources, then esbuild bundling
// the worker and each page script (./bundle.ts). esbuild is native, a process
// of its own beside this one, so the compile runs wherever a process can start
// one: under Deno, and for yaks.app in a container. `default` is that
// container's server: it takes a {@link Job} and answers an {@link Answer}.
//
// It is handed everything it reads and holds nothing: no binding, no secret,
// no store. The npm registry is the one thing it reaches.
//
// What is left of an output's imports once esbuild is done is checked here,
// because a build leaves any import it cannot resolve as an import rather
// than failing: in a worker that is a module the upload refuses, and in a
// page it is a request the browser makes for nothing.
import { parse } from 'es-module-lexer/js'
import { isBuiltin } from 'node:module'
import { bundle, type Options, Stopped } from './bundle.ts'
import { packageOf, relative, resolved, twins } from './graph.ts'
import { lockfile, type Pins, pins, reached, split, wanted } from './lock.ts'
import * as npm from './npm.ts'
import { type Answer, type Ask, dependencies } from './plan.ts'
import { said } from './said.ts'
import { type Catalog, located, type Seed, seed } from './platform.ts'
export type { Catalog, Toolkit } from './platform.ts'
export { Stopped } from './bundle.ts'

/** What a host posts to the compiler's server: the app's ask, and beside it
 * the toolkit catalog, which the host supplies and an app never does. */
export type Job = { ask: Ask; catalog: Catalog }

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
) => {
  let pkg = ask.files['package.json'] ?? null
  let ranges = dependencies(pkg)
  let want = wanted(
    setup.dependencies,
    pins(ask.files['package-lock.json'] ?? null),
  )
  let { installed, warnings } = await npm.install(fs, want)
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
 * The host supplies its toolkit catalog separately from the app's ask. */
export let compile = async (
  ask: Ask,
  catalog: Catalog = {},
): Promise<Answer> => {
  let answer: Answer = {
    pages: {},
    assets: {},
    installed: [],
    notes: [],
    errors: [],
  }
  let fs: npm.Files
  let setup: Seed
  try {
    setup = seed(ask.files, catalog)
    answer.assets = setup.assets
    fs = new npm.Files(setup.files)
    Object.assign(answer, await install(fs, ask, setup, catalog))
  } catch (e) {
    return { ...answer, errors: said(e) }
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
    let { entry, flags } = ask.worker
    let main = compiledName(entry)
    let code = await built(
      entry,
      // A workerd module name is not a URL. Its file URL is a logical
      // identity, not a hosted asset address; a page keeps its browser's URL.
      new URL(main, 'file:///'),
      { node: flags.includes('nodejs_compat') },
      unlinked(ask, main),
    )
    if (code != null) answer.worker = { main, code }
  }
  for (let entry of ask.pages) {
    let code = await built(entry, entry, {
      minify: true,
      // What a package written for bundlers asks of its environment.
      define: { 'process.env.NODE_ENV': '"production"' },
    }, unfetched(ask, entry))
    if (code != null) answer.pages[entry] = code
  }
  return answer
}

/** The compiler's server: a {@link Job} in, its {@link Answer} out, and 507
 * when esbuild's process ended under the build, almost always for memory. */
export default {
  fetch: async (req: Request): Promise<Response> => {
    if (req.method != 'POST') return new Response('POST a job', { status: 405 })
    let { ask, catalog } = await req.json() as Job
    try {
      return Response.json(await compile(ask, catalog))
    } catch (e) {
      if (e instanceof Stopped) return new Response(e.message, { status: 507 })
      throw e
    }
  },
}
