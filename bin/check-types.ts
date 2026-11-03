// `deno task check:types [--all] [paths…]`: the types of source and of the
// code in its doc comments, checked by TypeScript's native compiler (tsgo) in
// the project Deno's resolution describes (./tsconfig.ts). With no paths it
// checks what the branch and working changes reach: each changed module and
// each module importing one (`types`), as `deno task test` does on every run
// with no paths. The consumers past those are main's CI's: `deno task check`
// runs `--all`, every module, after the push. Raycast is a Node/React host
// with its own tsconfig, checked by check:raycast, so it is not among DIRS.
//
// tsc checks a fresh worktree's Worker change in seconds where `deno check`
// took 17 s, needs no build info from an earlier run and keeps no lock. Each
// run's project lies in `.types/` with its process id; the links into Deno's
// caches there are shared, and the same for every run.
import { dirname, matchesGlob } from 'node:path'
import config from '../deno.json' with { type: 'json' }
import { survey } from '@yaks/testing/deps'
import { exported, fences, typed } from '@yaks/testing/examples'
import { changes, git } from './test-changes.ts'
import { type Info, type Project, project } from './tsconfig.ts'

/** Where the checked modules live. */
export const DIRS = ['apps', 'bench', 'bin', 'packages', 'plugins', 'workers']

/** What a generator makes, gitignored, and the modules importing it: the
 * kernel's tests import the workspace source catalog, and the public client
 * the browser assets. */
export const MADE: Record<string, string[]> = {
  'bin/compiler-packages.ts': ['workers/yak/public/_compiler/packages.json'],
  'workers/yak/client-assets.ts': ['_draft.js', '_outbox.js', '_wire.js']
    .map((name) => `workers/yak/public/${name}`),
}

/** The compiler, pinned. */
export const TSC = 'npm:typescript@7.0.2/tsc'

/** The checkout, and the project directory in it. */
let CHECKOUT = dirname(dirname(new URL(import.meta.url).pathname))
let DIR = `${CHECKOUT}/.types`

/// checked('packages/sql/render.ts') -> true
/// checked('raycast/src/index.tsx') -> false
/// checked('workers/yak/conform.ts') -> false
/// checked('packages/sql/README.md') -> false
/** Whether a path is a module the check checks. */
export let checked = (path: string) =>
  /\.[mc]?[jt]sx?$/.test(path) &&
  DIRS.some((d) => path.startsWith(`${d}/`)) &&
  !config.exclude.some((p) => matchesGlob(path, p) || path.startsWith(`${p}/`))

/** Every module the check checks. */
let every = async () =>
  (await git(['ls-files', '-co', '--exclude-standard', ...DIRS]))
    .split('\n').filter(checked)

/** The modules a change reaches: those changed and their importers. */
let reached = async (changed: string[]) => {
  let all = await every()
  let s = await survey(all)
  if (!s) {
    throw new Error(
      'Cannot say what the change reaches: dependency graph unavailable. ' +
        '`deno task check:types --all` checks every module.',
    )
  }
  let far = s.distance(changed)
  let roots = all.filter((f) => far(f) <= 1)
  let made = Object.entries(MADE)
    .filter(([, out]) => s.reaches(roots, out))
    .map(([generator]) => generator)
  return { roots, made }
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
/**
 * The diagnostics tsc printed (`--pretty false`) that are the checkout's: not
 * those in Deno's modules or packages, which Deno does not report either, and
 * not the `/// <reference lib="deno.ns" />` tsc cannot find, since the
 * project holds Deno's types itself. An example's is reported at its page.
 */
export let reported = (output: string) =>
  output.split(/\n(?=\S)/).map((d) => d.trimEnd()).filter((d) =>
    /error TS\d+/.test(d) &&
    !/^(\.types\/(jsr|node_modules)\/|\.types\/deno\.d\.ts|\.\.\/|\/)/.test(
      d,
    ) &&
    !/error TS2726: Cannot find lib definition for 'deno\./.test(d) &&
    !/error TS7016: .*\/\.types\/node_modules\//.test(d)
  ).map((d) => d.replace(/^[^(]+/, paged))

/** Runs `deno` with these arguments, and says whether it succeeded. */
export type Run = (args: string[]) => Promise<boolean>

let deno: Run = async (args) =>
  (await new Deno.Command(Deno.execPath(), { args }).spawn().status).success

let output = async (args: string[]) => {
  let { success, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: CHECKOUT,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  let text = new TextDecoder()
  return { success, out: text.decode(stdout), err: text.decode(stderr) }
}

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

/** Lays a project out under DIR. A package Deno never downloaded (another
 * platform's build) is left out. */
let lay = (p: Project) => {
  for (let [path, from] of Object.entries(p.spread).sort()) {
    if (!there(from)) continue
    let at = `${DIR}/${path}`
    try {
      if (Deno.lstatSync(at).isSymlink) Deno.removeSync(at)
    } catch { /* not there yet */ }
    Deno.mkdirSync(at, { recursive: true })
    for (let e of Deno.readDirSync(from)) {
      if (e.name != 'node_modules') link(`${at}/${e.name}`, `${from}/${e.name}`)
    }
  }
  for (let [path, target] of Object.entries(p.links)) {
    link(`${DIR}/${path}`, target)
  }
  for (let [path, text] of Object.entries(p.files)) put(`${DIR}/${path}`, text)
}

let manifest = (path: string) => {
  try {
    return JSON.parse(Deno.readTextFileSync(`${path}/package.json`))
  } catch {
    return {}
  }
}

/** Check the types of `roots` and their doc comment examples, after making
 * what they import. */
let check = async (roots: string[], made: string[], run: Run) => {
  if (
    !(await Promise.all(made.map((g) => run(['run', '--no-lock', '-A', g]))))
      .every(Boolean)
  ) return false
  let docs = await examples(roots)
  let graph = `${DIR}/graph.${Deno.pid}.ts`
  let tsconfig = `${DIR}/tsconfig.${Deno.pid}.json`
  try {
    put(graph, [...roots, ...docs].map((r) => `import '../${r}'\n`).join(''))
    let [info, types] = await Promise.all([
      output(['info', '--json', graph]),
      output(['types']),
    ])
    if (!info.success) throw new Error(info.err)
    let graphed: Info = JSON.parse(info.out)
    let manifests = Object.fromEntries(
      [...new Set(graphed.modules.flatMap((m) => m.npmPackage ?? []))]
        .map((id) => [id, manifest(graphed.npmPackages[id].localPath)]),
    )
    let { lib, ...options } = config.compilerOptions
    let p = project(graphed, CHECKOUT, DIR, [...roots, ...docs], manifests, {
      ...options,
      lib: [...lib.filter((l) => !l.startsWith('deno.')), 'esnext'],
    })
    lay(p)
    put(`${DIR}/deno.d.ts`, types.out)
    put(tsconfig, JSON.stringify(p.config, null, 1))
    let tsc = await output([
      'run',
      '-A',
      TSC,
      '-p',
      tsconfig,
      '--pretty',
      'false',
    ])
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

/** Check the types of the modules the `changed` paths reach. */
export let types = async (changed: string[], run: Run = deno) => {
  if (!changed.some(checked)) return true
  let { roots, made } = await reached(changed)
  return !roots.length || await check(roots, made, run)
}

if (import.meta.main) {
  let all = Deno.args.includes('--all')
  let paths = Deno.args.filter((a) => !a.startsWith('--'))
  let ok = all || paths.length
    ? await check(all ? await every() : paths, Object.keys(MADE), deno)
    : await types(await changes())
  if (!ok) Deno.exit(1)
}
