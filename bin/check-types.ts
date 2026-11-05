// `deno task check:types [--all] [paths…]`: the types of source and of the
// code in its doc comments, checked by TypeScript's native compiler (tsgo) in
// the project Deno's resolution describes (./tsconfig.ts). With no paths it
// checks what the branch and working changes reach: each changed module, the
// rest of its package that imports one, and each module importing one
// (`types`), as `deno task test` does on every run with no paths. The
// consumers past those are main's CI's: `deno task check` runs `--all`, every
// module, after the push. Raycast is a Node/React host
// with its own tsconfig, checked by check:raycast, so it is not among DIRS.
// The full CI run also checks the release's public types through Deno's
// publisher: package-local compiler options and the public-type transform
// cannot be checked by the source program alone. Selected local runs keep
// using the source program; publication checking runs after the push.
//
// Two platforms, two programs, checked at once. Deno's holds the modules with
// Deno's globals. The Workers program holds each `conform.ts` a `workers.json`
// lies beside, under Cloudflare's own Workers types (check-platform.ts merges
// those configs): what a change reaches from there, it checks as the runtime
// types it, `cloudflare:workers` included, which Deno's program can only call
// `any`. Those types are globals, so they never share a program with Deno's.
//
// Each run's project lies in `.types/` with its process id; the links into
// Deno's caches there are shared. Each platform keeps incremental build info:
// the compiler reuses unchanged work and validates source versions, options
// and resolutions itself. Checks hold no lock and compile against private
// copies, publishing their next build info atomically.
import { dirname } from 'node:path'
import config from '../deno.json' with { type: 'json' }
import { remembered, type Survey, survey } from '@yaks/testing/deps'
import { exported, fences, typed } from '@yaks/testing/examples'
import { changes, git, member } from './test-changes.ts'
import { type Info, type Project, project, relative } from './tsconfig.ts'
import { platformConfig } from './check-platform.ts'
import { incremental } from './check-incremental.ts'
import { compiler } from './check-compiler.ts'

/** Where the checked modules live. */
export const DIRS = ['apps', 'bench', 'bin', 'packages', 'plugins', 'workers']

/** What a generator makes, gitignored, and the modules importing it: the
 * kernel's tests import the workspace source catalog, and the public client
 * the browser assets. */
export const MADE: Record<string, string[]> = {
  'bin/compiler-packages.ts': ['packages.json', 'toolkit.json']
    .map((name) => `workers/yak/public/_compiler/${name}`),
  'workers/yak/client-assets.ts': ['_draft.js', '_outbox.js', '_wire.js']
    .map((name) => `workers/yak/public/${name}`),
}

/** The compiler, pinned. */
export const TSC = 'npm:typescript@7.0.2/tsc'

/** The checkout, and the project directory in it. */
let CHECKOUT = dirname(dirname(new URL(import.meta.url).pathname))
let DIR = `${CHECKOUT}/.types`

// The config's excludes, each compiled once: `matchesGlob` compiles its glob
// on every call, and every module in the checkout is asked of each.
let EXCLUDES = config.exclude.map((p) =>
  new RegExp(
    `^${
      p.split(/(\*\*\/|\*)/).map((part) =>
        part == '**/'
          ? '(?:[^/]*/)*'
          : part == '*'
          ? '[^/]*'
          : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      ).join('')
    }(?:/|$)`,
  )
)

/// excluded('workers/yak/conform.ts') -> true
/// excluded('workers/yak/fixtures/a.ts') -> true
/// excluded('packages/web/.wrangler') -> true
/// excluded('packages/sql/.README.md.12.345.example.ts') -> true
/// excluded('workers/yak/conformed.ts') -> false
/// excluded('packages/sql/render.ts') -> false
/** Whether the config excludes a path: one it names or matches, or one under
 * it. */
export let excluded = (path: string) => EXCLUDES.some((x) => x.test(path))

/// checked('packages/sql/render.ts') -> true
/// checked('raycast/src/index.tsx') -> false
/// checked('workers/yak/conform.ts') -> false
/// checked('packages/sql/README.md') -> false
/** Whether a path is a module the check checks. */
export let checked = (path: string) =>
  /\.[mc]?[jt]sx?$/.test(path) &&
  DIRS.some((d) => path.startsWith(`${d}/`)) && !excluded(path)

/** Every module the check checks. */
let every = async () =>
  (await git(['ls-files', '-co', '--exclude-standard', ...DIRS]))
    .split('\n').filter(checked)

/** A platform's program: where its project lies, the Deno configuration
 * resolving it (the checkout's when none), its compiler options, its globals
 * by file name, whether its types declare the modules Deno leaves to the host,
 * and whether its roots' doc comment examples are checked. */
type Platform = {
  dir: string
  config?: string
  options: Record<string, unknown>
  globals: () => Promise<Record<string, string>>
  hosted: boolean
  examples: boolean
}

let deno = (): Platform => {
  let { lib, ...options } = config.compilerOptions
  return {
    dir: DIR,
    options: {
      ...options,
      lib: [...lib.filter((l) => !l.startsWith('deno.')), 'esnext'],
    },
    globals: async () => ({ 'deno.d.ts': (await output(['types'])).out }),
    hosted: false,
    examples: true,
  }
}

/** The Workers program, and the modules it checks: its globals arrive by
 * each entry's `/// <reference types>`. */
let workers = async () => {
  let { config, entries } = await platformConfig(
    new URL(`file://${CHECKOUT}/`),
    'workers',
  )
  let dir = `${DIR}/workers`
  put(`${dir}/config.json`, JSON.stringify(config))
  let platform: Platform = {
    dir,
    config: `${dir}/config.json`,
    options: config.compilerOptions,
    globals: () => Promise.resolve({}),
    hosted: true,
    examples: false,
  }
  return {
    platform,
    entries: entries.map((e) => e.slice(`file://${CHECKOUT}/`.length)),
  }
}

/** One command's resolution snapshot, including source roots and hosted entries. */
export let sourceSurvey = async (
  paths: string[],
): Promise<Survey | undefined> => {
  let [all, { entries }] = await Promise.all([every(), workers()])
  return await survey([...paths, ...all, ...entries])
}

/** Of `all`, the modules whose types `changed` can change: each changed, each
 * importing one, and each of a changed one's package (`owner`) importing one
 * however far, past a module loading a whole platform, where `distance` stops.
 * A type leaves a package only by what it exports, which an importer checks. */
export let scope = (
  s: Survey,
  all: string[],
  changed: string[],
  owner: (path: string) => string | undefined = member,
) => {
  let far = s.distance(changed)
  let homes = new Set(changed.map(owner).filter(Boolean))
  return all.filter((f) =>
    far(f) <= 1 || homes.has(owner(f)) && s.reaches([f], changed)
  )
}

/** The modules a change reaches: those changed, the rest of their package
 * that imports one, each module importing one, and the Workers entries
 * reaching one. */
let reached = async (
  changed: string[],
  hosted: string[],
  snapshot?: Promise<Survey | undefined>,
) => {
  let all = await every()
  let s = snapshot ? await snapshot : await survey([...all, ...hosted])
  if (!s) {
    throw new Error(
      'Cannot say what the change reaches: dependency graph unavailable. ' +
        '`deno task check:types --all` checks every module.',
    )
  }
  let roots = scope(s, all, changed)
  let entries = hosted.filter((e) => s.reaches([e], changed))
  let imports = (roots: string[]) =>
    Object.entries(MADE)
      .filter(([, out]) => s.reaches(roots, out))
      .map(([generator]) => generator)
  return {
    roots,
    entries,
    made: imports([...roots, ...entries]),
    hostedMade: imports(entries),
  }
}

/// beside('a/b.ts', 3, 'tsx') -> `a/.b.ts.t3.${Deno.pid}.example.tsx`
/** Where a page's example at `line` is written while it is checked: hidden
 * beside the page, so its imports resolve as the page's do, named so the test
 * runner sweeps one a dead process left (@yaks/testing's `written`). */
export let beside = (page: string, line: number, lang: string) =>
  page.replace(/[^/]*$/, (base) => `.${base}.t${line}.${Deno.pid}.example.`) +
  (/^(tsx|jsx)$/.test(lang)
    ? lang
    : /^(js|javascript|mjs)$/.test(lang)
    ? 'js'
    : 'ts')

/// paged('a/.b.ts.t3.42.example.ts') -> 'a/b.ts'
/// paged('a/b.ts') -> 'a/b.ts'
/** The page an example written `beside` it belongs to. */
export let paged = (path: string) =>
  path.replace(/(^|\/)\.([^/]+)\.t\d+\.\d+\.example\.[jt]sx?$/, '$1$2')

/// reported('a.ts(1,2): error TS1: no\n  because\n.types/jsr/j.ts(3,4): error TS2: x\n') -> ['a.ts(1,2): error TS1: no\n  because']
/// reported('error TS5023: Unknown compiler option') -> ['error TS5023: Unknown compiler option']
/// reported("b.ts(1,1): error TS2726: Cannot find lib definition for 'deno.ns'.\n") -> []
/// reported("b.ts(1,1): error TS7016: Could not find a declaration file for module 'x'. '/c/.types/node_modules/x/i.js' implicitly has an 'any' type.") -> []
/// reported('a/.b.ts.t3.42.example.ts(4,1): error TS2: x\n') -> ['a/b.ts(4,1): error TS2: x']
/// reported('.types/workers/node_modules/x/i.d.ts(1,1): error TS2: x\n') -> []
/**
 * The diagnostics tsc printed (`--pretty false`) that are the checkout's: not
 * those in Deno's modules or packages, which Deno does not report either, and
 * not the `/// <reference lib="deno.ns" />` tsc cannot find, since the
 * project holds Deno's types itself. An example's is reported at its page.
 */
export let reported = (output: string) =>
  output.split(/\n(?=\S)/).map((d) => d.trimEnd()).filter((d) =>
    /error TS\d+/.test(d) &&
    !/^(\.types\/([^/]+\/)?(jsr|node_modules)\/|\.types\/deno\.d\.ts|\.\.\/|\/)/
      .test(d) &&
    !/error TS2726: Cannot find lib definition for 'deno\./.test(d) &&
    !/error TS7016: .*\/\.types\/([^/]+\/)?node_modules\//.test(d)
  ).map((d) => d.replace(/^[^(]+/, paged))

/** Runs `deno` with these arguments, and says whether it succeeded. */
export type Run = (args: string[]) => Promise<boolean>

let spawn: Run = async (args) =>
  (await new Deno.Command(Deno.execPath(), { args }).spawn().status).success

let output = async (args: string[], env?: Record<string, string>) => {
  let { success, stdout, stderr, signal } = await new Deno.Command(
    Deno.execPath(),
    {
      args,
      env,
      cwd: CHECKOUT,
      stdout: 'piped',
      stderr: 'piped',
    },
  ).output()
  if (signal) throw new Error(`deno ${args.join(' ')} stopped by ${signal}`)
  let text = new TextDecoder()
  return { success, out: text.decode(stdout), err: text.decode(stderr) }
}

let compile = compiler(output, Deno.env.toObject())

/** Writes each example of `roots` beside its page, and names them. */
let examples = async (roots: string[]) =>
  (await Promise.all(roots.map(async (page) => {
    let source = await Deno.readTextFile(`${CHECKOUT}/${page}`)
    let names = exported(source)
    return await Promise.all(
      fences(source, page).filter((f) => !f.skip).map(async (f) => {
        let path = beside(page, f.line, f.lang)
        await Deno.writeTextFile(`${CHECKOUT}/${path}`, typed(page, f, names))
        return path
      }),
    )
  }))).flat()

/** Writes a file unless it already holds `text`, through a rename, so a
 * parallel run never reads half of it. */
let put = (path: string, text: string) => {
  try {
    if (Deno.readTextFileSync(path) == text) return
  } catch { /* not there yet */ }
  Deno.mkdirSync(dirname(path), { recursive: true })
  Deno.writeTextFileSync(`${path}.${Deno.pid}`, text)
  Deno.renameSync(`${path}.${Deno.pid}`, path)
}

/** Points `path` at `target`, unless it already does. */
let link = (path: string, target: string) => {
  try {
    if (Deno.readLinkSync(path) == target) return
    Deno.removeSync(path, { recursive: true })
  } catch { /* not a link, or not there */ }
  try {
    Deno.removeSync(path, { recursive: true })
  } catch { /* not there */ }
  Deno.mkdirSync(dirname(path), { recursive: true })
  try {
    Deno.symlinkSync(target, path)
  } catch (e) {
    if (Deno.readLinkSync(path) != target) throw e
  }
}

let there = (path: string) => {
  try {
    return Deno.statSync(path).isDirectory
  } catch {
    return false
  }
}

/** Lays a project out under `dir`. A package Deno never downloaded (another
 * platform's build) is left out. */
let lay = (p: Project, dir: string) => {
  for (let [path, from] of Object.entries(p.spread).sort()) {
    if (!there(from)) continue
    let at = `${dir}/${path}`
    try {
      if (Deno.lstatSync(at).isSymlink) Deno.removeSync(at)
    } catch { /* not there yet */ }
    Deno.mkdirSync(at, { recursive: true })
    for (let e of Deno.readDirSync(from)) {
      if (e.name != 'node_modules') link(`${at}/${e.name}`, `${from}/${e.name}`)
    }
  }
  for (let [path, target] of Object.entries(p.links)) {
    link(`${dir}/${path}`, target)
  }
  for (let [path, text] of Object.entries(p.files)) put(`${dir}/${path}`, text)
}

let manifest = (path: string) => {
  try {
    return JSON.parse(Deno.readTextFileSync(`${path}/package.json`))
  } catch {
    return {}
  }
}

/** Check the types of `roots` in a platform's program, and of their doc
 * comment examples where it checks those. */
let program = async (on: Platform, roots: string[], snapshot?: Survey) => {
  let docs = on.examples ? await examples(roots) : []
  let graph = `${on.dir}/graph.${Deno.pid}.ts`
  let tsconfig = `${on.dir}/tsconfig.${Deno.pid}.json`
  try {
    put(
      graph,
      [...roots, ...docs]
        .map((r) => `import '${relative(on.dir, `${CHECKOUT}/${r}`)}'\n`)
        .join(''),
    )
    let resolve = async () => {
      let info = await output([
        'info',
        '--json',
        ...on.config ? ['--no-lock', '--config', on.config] : [],
        graph,
      ])
      if (!info.success) throw new Error(info.err)
      return JSON.parse(info.out) as Info
    }
    let [found, globals] = await Promise.all([
      on.config ? resolve() : (async () =>
        await snapshot?.info(
          [...roots, ...docs],
          Object.values(MADE).flat(),
        ) ??
          await remembered(resolve)([...roots, ...docs]))(),
      on.globals(),
    ])
    if (!found) throw new Error('Cannot resolve source types')
    let graphed = { ...found, npmPackages: found.npmPackages ?? {} } as Info
    let manifests = Object.fromEntries(
      [...new Set(graphed.modules.flatMap((m) => m.npmPackage ?? []))]
        .map((id) => [id, manifest(graphed.npmPackages[id].localPath)]),
    )
    let p = project(
      graphed,
      CHECKOUT,
      on.dir,
      [...roots, ...docs],
      manifests,
      on.options,
      Object.keys(globals),
      on.hosted,
    )
    lay(p, on.dir)
    for (let [name, text] of Object.entries(globals)) {
      put(`${on.dir}/${name}`, text)
    }
    put(tsconfig, JSON.stringify(p.config, null, 1))
    let tsc = await incremental(
      `${on.dir}/build.tsbuildinfo`,
      (info) =>
        compile([
          'run',
          '-A',
          TSC,
          '-p',
          tsconfig,
          '--pretty',
          'false',
          '--incremental',
          '--tsBuildInfoFile',
          info,
        ]),
    )
    let errors = reported(tsc.out)
    if (errors.length) console.error(errors.join('\n'))
    if (!tsc.success && !/error TS/.test(tsc.out)) {
      console.error(tsc.out, tsc.err)
      return false
    }
    return !errors.length
  } finally {
    let made = [graph, tsconfig, ...docs.map((d) => `${CHECKOUT}/${d}`)]
    await Promise.all(made.map((path) => Deno.remove(path).catch(() => {})))
  }
}

/** Outputs validated by this run, possibly while source discovery proceeds. */
export type Prepared = readonly string[] | PromiseLike<readonly string[]>

/** Make a source's imports unless readiness validated every output this run. */
export let generate = async (
  made: string[],
  run: Run,
  prepared: Prepared = [],
) => {
  if (!made.length) return true
  let completed = await prepared
  return (await Promise.all(
    made.filter((g) => !MADE[g].every((path) => completed.includes(path)))
      .map((g) => run(['run', '--no-lock', '-A', g])),
  )).every(Boolean)
}

/** Check independent host programs as soon as their generated imports are
 * ready. A generator shared by hosts still runs only once. */
export let programs = async (
  jobs: { made: string[]; check: () => Promise<boolean> }[],
  run: Run,
  prepared: Prepared = [],
) => {
  let generating = new Map<string, Promise<boolean>>()
  let imports = (made: string[]) =>
    Promise.all(made.map((name) => {
      if (!generating.has(name)) {
        generating.set(name, generate([name], run, prepared))
      }
      return generating.get(name)!
    })).then((out) => out.every(Boolean))
  return (await Promise.all(
    jobs.map(async (job) => await imports(job.made) && await job.check()),
  )).every(Boolean)
}

let check = async (
  roots: string[],
  entries: string[],
  made: string[],
  run: Run,
  prepared: Prepared = [],
  hostedMade = made,
  snapshot?: Survey,
) => {
  let hosted = entries.length ? (await workers()).platform : undefined
  return await programs(
    [
      {
        made,
        check: () =>
          roots.length
            ? program(deno(), roots, snapshot)
            : Promise.resolve(true),
      },
      ...hosted
        ? [{
          made: hostedMade,
          check: () => program(hosted, entries),
        }]
        : [],
    ],
    run,
    prepared,
  )
}

/** Check the types of the modules the `changed` paths reach. */
export let types = async (
  changed: string[],
  run: Run = spawn,
  prepared: Prepared = [],
  snapshot?: Promise<Survey | undefined>,
) => {
  let { entries: hosted } = await workers()
  if (!changed.some((p) => checked(p) || hosted.includes(p))) return true
  let { roots, entries, made, hostedMade } = await reached(
    changed,
    hosted,
    snapshot,
  )
  return !roots.length && !entries.length ||
    await check(
      roots,
      entries,
      made,
      run,
      prepared,
      hostedMade,
      snapshot ? await snapshot : undefined,
    )
}

if (import.meta.main) {
  let all = Deno.args.includes('--all')
  let paths = Deno.args.filter((a) => !a.startsWith('--'))
  let { entries } = await workers()
  let ok = all || paths.length
    ? await check(
      all ? await every() : paths.filter((p) => !entries.includes(p)),
      all ? entries : paths.filter((p) => entries.includes(p)),
      Object.keys(MADE),
      spawn,
    )
    : await types(await changes())
  if (all) {
    let published = await spawn([
      'run',
      '-A',
      'bin/publish.ts',
      '--dry-run',
      '--allow-dirty',
    ])
    ok = ok && published
  }
  if (!ok) Deno.exit(1)
}
