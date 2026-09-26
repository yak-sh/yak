// The compile itself, over @cloudflare/worker-bundler: npm packages installed
// at the pinned versions, then esbuild (as WebAssembly) bundling the worker
// and each page script. It runs only inside workerd, so a host runs it in a
// Worker of its own and posts it a {@link Ask}; `default` is that Worker's
// fetch, answering an {@link Answer}.
//
// It is handed everything it reads and holds nothing: no binding, no secret,
// no store. The npm registry is the one thing it reaches.
//
// What is left of an output's imports once esbuild is done is checked here,
// because @cloudflare/worker-bundler leaves any import it cannot resolve as
// an import rather than failing: in a worker that is a module the upload
// refuses, and in a page it is a request the browser makes for nothing.
import {
  createWorker,
  InMemoryFileSystem,
  installDependencies,
} from '@cloudflare/worker-bundler'
import { parse } from 'es-module-lexer/js'
import { isBuiltin } from 'node:module'
import { packageOf, relative, resolved, twins } from './graph.ts'
import { lockfile, type Pins, pins, reached, split, wanted } from './lock.ts'
import { type Answer, type Ask, dependencies } from './plan.ts'
import { said } from './said.ts'

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
let needs = (fs: InMemoryFileSystem) => (name: string) => {
  try {
    let pkg = JSON.parse(fs.read(`node_modules/${name}/package.json`) ?? '{}')
    return Object.keys(pkg.dependencies ?? {})
  } catch {
    return []
  }
}

/** Install what package.json asks at what the lock pins, and say the lock
 * that results. Throws what the installer could not do. */
let install = async (fs: InMemoryFileSystem, ask: Ask) => {
  let pkg = ask.files['package.json'] ?? null
  let ranges = dependencies(pkg)
  let want = wanted(ranges, pins(ask.files['package-lock.json'] ?? null))
  fs.write('package.json', JSON.stringify({ dependencies: want }))
  let { installed, warnings } = Object.keys(want).length
    ? await installDependencies(fs)
    : { installed: [], warnings: [] }
  if (warnings.length) {
    // The installer's hint names an option of its own that an app cannot set.
    let lines = warnings.map((w) =>
      `npm: ${w.replace(/ or set the `registry` option[^)]*/, '')}`
    )
    throw new Error(lines.join('\n'))
  }
  let all: Pins = Object.fromEntries(installed.map(split))
  let kept = reached(Object.keys(ranges), all, needs(fs))
  let name = pkg == null ? undefined : JSON.parse(pkg).name
  return {
    installed: Object.entries(kept).map(([n, v]) => `${n}@${v}`).sort(),
    lock: pkg == null ? undefined : lockfile(name, ranges, kept),
  }
}

// A `.js` import meaning a TypeScript file that was sent: esbuild reads that
// convention, and worker-bundler, which resolves the extension it is given,
// does not.
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
 * are the answer's `errors`. */
export let compile = async (ask: Ask): Promise<Answer> => {
  let answer: Answer = { pages: {}, installed: [], notes: [], errors: [] }
  let fs = new InMemoryFileSystem(ask.files)
  try {
    Object.assign(answer, await install(fs, ask))
  } catch (e) {
    return { ...answer, errors: said(e) }
  }
  if (ask.worker) {
    let { entry, flags } = ask.worker
    let main = compiledName(entry)
    // What worker-bundler reads nodejs_compat from; a page compiles without it.
    fs.write('wrangler.json', JSON.stringify({ compatibility_flags: flags }))
    try {
      let out = await createWorker({ files: fs, entryPoint: entry })
      let code = String(out.modules[out.mainModule])
      answer.errors.push(...checked(entry, code, unlinked(ask, main)))
      answer.worker = { main, code }
      answer.notes.push(...(out.warnings ?? []).map((w) => `${entry}: ${w}`))
    } catch (e) {
      answer.errors.push(...said(e))
    }
    fs.delete('wrangler.json')
  }
  for (let entry of ask.pages) {
    try {
      let out = await createWorker({
        files: fs,
        entryPoint: entry,
        minify: true,
        // What a package written for bundlers asks of its environment.
        define: { 'process.env.NODE_ENV': '"production"' },
      })
      let code = String(out.modules[out.mainModule])
      answer.errors.push(...checked(entry, code, unfetched(ask, entry)))
      answer.pages[entry] = code
      answer.notes.push(...(out.warnings ?? []).map((w) => `${entry}: ${w}`))
    } catch (e) {
      answer.errors.push(...said(e))
    }
  }
  return answer
}

export default {
  fetch: async (req: Request): Promise<Response> =>
    req.method == 'POST'
      ? Response.json(await compile(await req.json() as Ask))
      : new Response('POST an ask', { status: 405 }),
}
