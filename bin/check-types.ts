// `deno task check:types [--all] [paths…]` checks source and doc examples
// with the native TypeScript compiler, using Deno's resolution (tsconfig.ts).
// A scoped run checks changed modules, direct importers, and their package's
// transitive importers up to a module composing a whole platform. Type-only
// imports participate too; each host's entries follow the same scope.
//
// The native program API checks diagnostics only in those sources. Imports
// still supply their complete inferred types, without checking thousands of
// unrelated dependency bodies merely because a root imports a kernel fixture
// or a barrel. Main CI's `--all` checks every source through the compiler's
// incremental command line; build info is shared across checkouts.
//
// Deno, browser and Workers programs keep their globals separate. Each run's
// project and examples are private; resolution, dependency digests and proven
// roots are shared across checkouts. A root whose source, dependencies,
// examples, compiler, options and globals all match a passing proof is skipped.
// Raycast's Node/React host has its own tsconfig and check:raycast command.
import { dirname } from 'node:path'
import config from '../deno.json' with { type: 'json' }
import { createHash } from 'node:crypto'
import { once } from '@yaks/fp'
import {
  digest,
  FACTS,
  GRAPH,
  graphSeed,
  passed,
  remember,
  remembered,
  seal,
  type Survey,
  survey,
} from '@yaks/testing/deps'
import { seed, stores } from '@yaks/testing/kept'
import { exported, fences, typed } from '@yaks/testing/examples'
import { changes, git, member } from './test-changes.ts'
import { type Info, type Project, project, relative } from './tsconfig.ts'
import { type Boundary, platformConfig } from './check-platform.ts'
import { incremental } from './check-incremental.ts'
import { compiler } from './check-compiler.ts'
import { diagnostic, unavailable } from './check-imports.ts'
import { localCheck, onRunner } from './check-work.ts'
import { preactImports, usesPreact } from './app-renderer.ts'

/** Where the checked modules live. */
export const DIRS = ['apps', 'bench', 'bin', 'packages', 'plugins', 'workers']

/** What a generator makes, gitignored, and the modules importing it: the
 * kernel's tests import the workspace source catalog, and the public client
 * the browser assets. */
export const MADE: Record<string, string[]> = {
  'bin/compiler-packages.ts': ['packages.json', 'toolkit.json']
    .map((name) => `workers/yak/public/_compiler/${name}`),
  'workers/yak/assets.ts': [
    '_draft.js',
    '_outbox.js',
    '_wire.js',
    '_talk.js',
  ]
    .map((name) => `workers/yak/public/${name}`),
}

/** The compiler, pinned, and its build for this machine: the platform
 * package whose native binary its launcher would start. */
export const TSC = 'npm:typescript@7.0.2/tsc'
let NATIVE = `npm:@typescript/typescript-${
  Deno.build.os == 'windows' ? 'win32' : Deno.build.os
}-${
  ({ x86_64: 'x64', aarch64: 'arm64' } as Record<string, string>)[
    Deno.build.arch
  ] ?? Deno.build.arch
}@${TSC.match(/@([^/]+)\//)![1]}`

/** The checkout, and the project directory in it. */
let CHECKOUT = dirname(dirname(new URL(import.meta.url).pathname))
let DIR = `${CHECKOUT}/.types`

let CACHE = `${
  Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`
}/yak`

/** Where the roots that passed are kept, by proof (`proofs`), for every
 * checkout on this machine. */
export let TYPED = `${CACHE}/types-passed.log`

let hex = (text: string) => createHash('sha256').update(text).digest('hex')

/// anonymous(`a/.b.ts.t3.${Deno.pid}.example.ts`) -> 'a/.b.ts.t3.example.ts'
/// anonymous('a/b.ts') -> 'a/b.ts'
/** A path as every run names it: an example written `beside` its page
 * without the process that wrote it. */
export let anonymous = (path: string) =>
  path.replace(/(\.t\d+)\.\d+\.example\.([jt]sx?)$/, '$1.example.$2')

/**
 * Each root's proof: `platform` (what the compiler, its options and its
 * globals are), the root, and the seal of everything it and its examples
 * reach in the program `info` describes, a file in the checkout by what it
 * holds (`held`), any other module by its versioned specifier. A root's
 * diagnostics follow from those alone, so one that passed by a proof passes
 * by it again.
 */
export let proofs = async (
  info: Info,
  roots: string[],
  docs: string[],
  platform: string,
  held: (path: string) => Promise<string>,
  base = `file://${CHECKOUT}/`,
): Promise<Map<string, string>> => {
  let at = (s: string) => info.redirects[s] ?? s
  let next = new Map<string, string[]>(), own = new Map<string, string>()
  await Promise.all(info.modules.map(async (m) => {
    next.set(
      m.specifier,
      (m.dependencies ?? []).flatMap((d) =>
        [d.code?.specifier, d.type?.specifier].flatMap((s) => s ? [at(s)] : [])
      ),
    )
    let path = m.specifier.startsWith(base)
      ? decodeURIComponent(m.specifier.slice(base.length))
      : undefined
    own.set(
      m.specifier,
      path ? `${anonymous(path)} ${await held(path)}` : m.specifier,
    )
  }))
  for (let targets of [...next.values()]) {
    for (let t of targets) if (!next.has(t)) next.set(t, [])
  }
  let seals = seal(next, (n) => own.get(n) ?? n)
  let of = (path: string) =>
    seals.get(at(new URL(path, base).href)) ?? `unresolved ${path}`
  return new Map(roots.map((root) => [
    root,
    hex([
      platform,
      root,
      of(root),
      ...docs.filter((d) => paged(d) == root).map(of).sort(),
    ].join('\n')),
  ]))
}

/// failed(['a.ts(1,2): error TS1: no', 'b/c.ts(3,4): error TS2: x']) -> ['a.ts', 'b/c.ts']
/// failed(['error TS5023: Unknown compiler option']) -> undefined
/** The files diagnostics were reported in, or none when one names no file. */
export let failed = (diagnostics: string[]) => {
  let files = diagnostics.map((d) => /^([^(\s]+)\(\d+,\d+\): /.exec(d)?.[1])
  return files.every(Boolean) ? [...new Set(files as string[])] : undefined
}

/// let info = { redirects: {}, npmPackages: {}, modules: [
///   { specifier: 'file:///c/a.ts', dependencies: [{ specifier: './b.ts', code: { specifier: 'file:///c/b.ts' } }] },
///   { specifier: 'file:///c/b.ts' }, { specifier: 'file:///c/d.ts' },
/// ] }
/// clear(info, ['a.ts', 'd.ts'], ['b.ts'], 'file:///c/') -> ['d.ts']
/// clear(info, ['a.ts', 'd.ts'], ['d.ts'], 'file:///c/') -> ['a.ts']
/** Of `roots`, those reaching none of the files diagnostics were reported in:
 * a root importing a file that failed failed with it. */
export let clear = (
  info: Info,
  roots: string[],
  red: string[],
  base = `file://${CHECKOUT}/`,
) => {
  let at = (s: string) => info.redirects[s] ?? s
  let deps = new Map(info.modules.map((m) => [
    m.specifier,
    (m.dependencies ?? []).flatMap((d) =>
      [d.code?.specifier, d.type?.specifier].flatMap((s) => s ? [at(s)] : [])
    ),
  ]))
  let bad = new Set(red.map((f) => new URL(f, base).href))
  let reaches = (root: string) => {
    let seen = new Set<string>(), todo = [at(new URL(root, base).href)]
    for (let s; (s = todo.pop());) {
      if (bad.has(s)) return true
      if (seen.has(s)) continue
      seen.add(s)
      todo.push(...deps.get(s) ?? [])
    }
    return false
  }
  return roots.filter((r) => !reaches(r))
}

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

/** Every module the check checks, listed once a process: a run's survey and
 * its check share the listing. Git's index still names a file deleted from
 * the working tree, which is no module to check. */
let every = once(async () => {
  let [listed, deleted] = await Promise.all([
    git(['ls-files', '-co', '--exclude-standard', ...DIRS]),
    git(['ls-files', '-d', ...DIRS]),
  ])
  let gone = new Set(deleted.split('\n'))
  return listed.split('\n').filter((p) => checked(p) && !gone.has(p))
})

/** Where every checkout of this repository shares a platform's pool of build
 * info (./check-incremental.ts); outside one, the project's own. */
let pool = async (on: Platform) => {
  try {
    let common = await git([
      '-C',
      CHECKOUT,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ])
    return `${common.trim()}/types/${on.name}`
  } catch {
    return `${on.dir}/builds`
  }
}

/** A platform's program: its name, where its project lies, the Deno
 * configuration resolving it (the checkout's when none), its compiler
 * options, its globals by file name, whether its types declare the modules
 * Deno leaves to the host, and whether its roots' doc comment examples are
 * checked. */
type Platform = {
  name: string
  dir: string
  config?: string
  importMap?: string
  options: Record<string, unknown>
  globals: () => Promise<Record<string, string>>
  hosted: boolean
  examples: boolean
  boundaries?: Boundary[]
}

/// namespace('/// <reference no-default-lib="true" />\ndeclare namespace Deno { a }\n/// <reference no-default-lib="true" />\ninterface Console {}\n/// <reference no-default-lib="true" />\n/// <reference lib="deno.ns" />\ndeclare namespace Deno { b }\n') -> '/// <reference no-default-lib="true" />\ndeclare namespace Deno { a }\n'
/**
 * Of every lib `deno types` prints, those `deno.ns` names: Deno's namespace
 * and the `deno.net` it references, each declaring `namespace Deno` without
 * building on `deno.ns` as `deno.unstable` does. Deno's own web globals are
 * left to the config's `dom` libs, as Deno's check leaves them; both at once
 * merge into wider signatures than Deno's check allows.
 */
export let namespace = (types: string) =>
  types.split(/^(?=\/\/\/ <reference no-default-lib="true" \/>$)/m)
    .filter((lib) =>
      /^declare namespace Deno \{/m.test(lib) &&
      !lib.includes('/// <reference lib="deno.ns" />')
    ).join('')

// An asset imported `with { type: 'text' }` is its text, as Deno's
// `raw-imports` and the app compiler (@yaks/esbuild) both load it.
let TEXT = ['css', 'md'].map((ext) =>
  `declare module '*.${ext}' {
  const text: string
  export default text
}
`
).join('')

let deno = (name: 'deno' | 'preact' = 'deno'): Platform => {
  let { lib, ...options } = config.compilerOptions
  let other = lib.filter((l) => l.startsWith('deno.') && l != 'deno.ns')
  if (other.length) throw new Error(`deno.json: no program for ${other}`)
  return {
    name,
    dir: name == 'preact' ? `${DIR}/preact` : DIR,
    importMap: name == 'preact' ? preactImports : undefined,
    options: {
      ...options,
      lib: [...lib.filter((l) => !l.startsWith('deno.')), 'esnext'],
    },
    globals: async () => ({
      'deno.d.ts': namespace((await output(['types'])).out),
      'text.d.ts': TEXT,
    }),
    hosted: false,
    examples: true,
  }
}

/** A host's program and entries. Workers globals are supplied for every entry,
 * including shipped entries without a conformance file's type reference. */
type Host = { platform: Platform; entries: string[] }

let host = (name: 'workers' | 'browser') =>
  once(async (): Promise<Host> => {
    let { config, entries, boundaries } = await platformConfig(
      new URL(`file://${CHECKOUT}/`),
      name,
    )
    let dir = `${DIR}/${name}`
    put(`${dir}/config.json`, JSON.stringify(config))
    return {
      platform: {
        name,
        dir,
        config: `${dir}/config.json`,
        options: name == 'workers'
          ? {
            ...config.compilerOptions,
            // SSR imports shared views that use DOM types for their effects.
            lib: [...config.compilerOptions.lib, 'dom', 'dom.iterable'],
          }
          : config.compilerOptions,
        globals: async (): Promise<Record<string, string>> =>
          name == 'workers'
            ? {
              'workers.d.ts': await Deno.readTextFile(
                `${CHECKOUT}/node_modules/@cloudflare/workers-types/latest/index.d.ts`,
              ),
              // Encoding creates a new ordinary buffer, as DOM's declaration does.
              'utf8.d.ts':
                'interface TextEncoder { encode(input?: string): Uint8Array<ArrayBuffer> }',
              'wasm.d.ts': `declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
`,
            }
            : {},
        hosted: name == 'workers',
        examples: false,
        boundaries,
      },
      entries: entries.map((e) => e.slice(`file://${CHECKOUT}/`.length)),
    }
  })

/** The host programs, each made once a process: a run's survey, its scope and
 * its check share them. */
let HOSTS = [host('workers'), host('browser')]
let hosts = () => Promise.all(HOSTS.map((h) => h()))

/** One command's resolution snapshot, including source roots and hosted entries. */
export let sourceSurvey = async (
  paths: string[],
): Promise<Survey | undefined> => {
  let [all, on] = await Promise.all([every(), hosts()])
  return await survey(
    [...paths, ...all, ...on.flatMap((h) => h.entries)],
    undefined,
    FACTS,
  )
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
  let far = s.distance(changed, undefined, false)
  let homes = new Set(changed.map(owner).filter(Boolean))
  return all.filter((f) =>
    far(f) <= 1 || homes.has(owner(f)) && far(f) < Infinity
  )
}

/** A host boundary covers the whole import chain, even past a package or
 * platform composition where checking source bodies deliberately stops. */
export let hostEntries = (
  s: Survey,
  entries: string[],
  changed: string[],
  platform?: string,
) =>
  changed.some((p) => p.endsWith(`/${platform}.json`))
    ? entries
    : entries.filter((entry) => s.reaches([entry], changed, false, false))

/** Of a change's `roots`, those a host's `entries` load. The host's program
 * checks them too, under its globals: a native program reports only its
 * roots, and `--all` reports every file its entries load, so a scoped run
 * that checked the entries alone passed what main's then failed. Resources a
 * module names with new URL are data, not imports checked under its globals. */
export let hostRoots = async (
  s: Survey,
  entries: string[],
  roots: string[],
) => {
  if (!entries.length) return []
  let info = await s.info(entries)
  if (!info) throw new Error('Cannot resolve host source imports')
  let modules = new Set(info.modules.map((m) => m.specifier))
  return roots.filter((r) => {
    let url = new URL(r, `file://${CHECKOUT}/`).href
    return !entries.includes(r) && modules.has(info.redirects[url] ?? url)
  })
}

/** The modules a change reaches: those changed, the rest of their package
 * that imports one, each module importing one, and each host's entries
 * reaching one, with the modules among those that the entries load. */
let reached = async (
  changed: string[],
  on: Host[],
  snapshot?: Promise<Survey | undefined>,
  bodiesOnly = false,
) => {
  let all = await every()
  let s = snapshot
    ? await snapshot
    : await survey([...all, ...on.flatMap((h) => h.entries)], undefined, FACTS)
  if (!s) {
    throw new Error(
      'Cannot say what the change reaches: dependency graph unavailable. ' +
        '`deno task check:types --all` checks every module.',
    )
  }
  let roots = bodiesOnly
    ? all.filter((path) => changed.includes(path))
    : scope(s, all, changed)
  let hosted = await Promise.all(on.map(async (h) => {
    let entries = hostEntries(s, h.entries, changed, h.platform.name)
    return {
      ...h,
      entries: [...entries, ...await hostRoots(s, entries, roots)],
    }
  }))
  return { roots, hosted, survey: s }
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

let execute = async (
  command: string,
  args: string[],
  env?: Record<string, string>,
) => {
  let { success, stdout, stderr, signal } = await new Deno.Command(
    command,
    {
      args,
      env,
      cwd: CHECKOUT,
      stdout: 'piped',
      stderr: 'piped',
    },
  ).output()
  if (signal) {
    throw new Error(`${command} ${args.join(' ')} stopped by ${signal}`)
  }
  let text = new TextDecoder()
  return { success, out: text.decode(stdout), err: text.decode(stderr) }
}

let output = (args: string[], env?: Record<string, string>) =>
  execute(Deno.execPath(), args, env)

/** The compiler's native binary, as Deno's npm cache holds it: asked of Deno
 * once per machine and kept, so a check starts the binary itself rather than
 * a Deno process running its launcher. None when Deno cannot say. */
let native = async () => {
  let kept = `${CACHE}/tsgo-${hex(NATIVE).slice(0, 16)}`
  try {
    let path = Deno.readTextFileSync(kept)
    if (Deno.statSync(path).isFile) return path
  } catch { /* not kept, or gone */ }
  let info = await output([
    'info',
    '--json',
    '--no-lock',
    '--no-config',
    NATIVE,
  ])
  let at = info.success
    ? Object.values(
      (JSON.parse(info.out) as Info).npmPackages ?? {},
    )[0]?.localPath
    : undefined
  let path = at && `${at}/lib/tsc${Deno.build.os == 'windows' ? '.exe' : ''}`
  if (!path || !there(dirname(path))) return undefined
  put(kept, path)
  return path
}
let tsgo: Promise<string | undefined> | undefined

let compile = compiler(async (args, env) => {
  tsgo ??= native()
  let exe = await tsgo
  return exe
    ? await execute(exe, args, env)
    : await output(['run', '-A', TSC, ...args], env)
}, Deno.env.toObject())

// The API host inherits the same Go budget as the command-line compiler.
// It asks the native program for diagnostics only in the selected sources.
let source = compiler((args, env) =>
  execute(Deno.execPath(), [
    'run',
    '--no-lock',
    '-A',
    `${CHECKOUT}/bin/check-source.ts`,
    ...args,
  ], env), Deno.env.toObject())

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

/** Where what deno says a platform's configuration resolves is kept: the
 * checkout's store, and the machine's, which seeds a checkout with none. The
 * configuration names the checkout's own paths, so both are keyed by it as
 * any checkout would write it. */
let shared = (name: string, config: string): [string, string] => {
  let text = Deno.readTextFileSync(config).replaceAll(CHECKOUT, '<checkout>')
  return [
    `${stores()}/${name}-${hex(text).slice(0, 16)}.json`,
    seed(`types-${name}`, text),
  ]
}

/** Check the types of `roots` in a platform's program, and of their doc
 * comment examples where it checks those. */
let program = async (
  on: Platform,
  roots: string[],
  snapshot?: Survey,
  all = false,
) => {
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
        ...on.importMap
          ? [
            '--no-lock',
            '--node-modules-dir=manual',
            '--import-map',
            on.importMap,
          ]
          : [],
        graph,
      ])
      if (!info.success) throw new Error(info.err)
      return JSON.parse(info.out) as Info
    }
    // What deno said a platform's own configuration resolves is kept by
    // that configuration, as Deno's is by the checkout's, and a new checkout
    // starts from what any checkout said under the same one (`shared`).
    let settings = on.config ?? on.importMap
    let own = settings && shared(on.name, settings)
    let [found, globals] = await Promise.all([
      own
        ? remembered(resolve, ...own)(roots, snapshot?.said)
        : (async () =>
          await snapshot?.info(
            [...roots, ...docs],
            Object.values(MADE).flat(),
          ) ??
            await remembered(resolve, GRAPH, graphSeed())(
              [...roots, ...docs],
              snapshot?.said,
            ))(),
      on.globals(),
    ])
    if (!found) throw new Error('Cannot resolve source types')
    let graphed = { ...found, npmPackages: found.npmPackages ?? {} } as Info
    if (on.boundaries) {
      let base = `file://${CHECKOUT}/`
      let selected = new Set(roots.map((r) => new URL(r, base).href))
      let missing = on.boundaries.flatMap((boundary) =>
        unavailable(
          graphed,
          boundary.entries.filter((e) => selected.has(e)),
          (s) =>
            s.startsWith('node:') && !boundary.nodeModules.includes(s) ||
            on.name == 'browser' && /(?:^|\/)@types\/node(?:@|\/|$)/.test(s),
          base,
          new Set(boundary.hostOnly),
          on.name == 'workers',
        )
      )
      if (missing.length) {
        let unique = new Map<string, typeof missing[number]>()
        for (let m of missing) {
          let key = `${m.file}\n${m.specifier}`
          if ((unique.get(key)?.chain.length ?? Infinity) > m.chain.length) {
            unique.set(key, m)
          }
        }
        let sources = new Map(
          graphed.modules.map((m) => [m.specifier, m.local]),
        )
        console.error(
          (await Promise.all([...unique.values()].map((m) =>
            diagnostic(
              m,
              on.name,
              (s) => Deno.readTextFileSync(sources.get(s) ?? new URL(s)),
              base,
            )
          ))).join('\n'),
        )
        return false
      }
    }
    let platform = hex(JSON.stringify([
      TSC,
      Deno.version.deno,
      on.options,
      on.hosted,
      on.name != 'browser',
      on.boundaries &&
      JSON.stringify(on.boundaries).replaceAll(
        `file://${CHECKOUT}/`,
        '<checkout>/',
      ),
      Object.entries(globals).map(([name, text]) => [name, hex(text)]),
    ]))
    let proven = await proofs(
      graphed,
      roots,
      docs,
      platform,
      snapshot?.bytes ?? digest,
    )
    let kept = passed(TYPED)
    let left = roots.filter((r) => !kept.has(proven.get(r)!))
    if (!left.length) return true
    // Keep the full project context, but ask for diagnostics only in roots
    // without a passing proof. The --all CLI reuses its incremental build.
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
      on.name != 'browser',
      new Set(
        on.importMap
          ? Object.keys(JSON.parse(Deno.readTextFileSync(on.importMap)).imports)
          : [],
      ),
    )
    lay(p, on.dir)
    for (let [name, text] of Object.entries(globals)) {
      put(`${on.dir}/${name}`, text)
    }
    put(tsconfig, JSON.stringify(p.config, null, 1))
    let tsc = all
      ? await incremental(
        on.dir,
        await pool(on),
        (info) =>
          compile([
            '-p',
            tsconfig,
            '--pretty',
            'false',
            '--incremental',
            '--tsBuildInfoFile',
            info,
          ]),
        graphed.modules.flatMap((m) =>
          m.specifier.startsWith(`file://${CHECKOUT}/`)
            ? [
              relative(
                on.dir,
                decodeURIComponent(new URL(m.specifier).pathname),
              ),
            ]
            : []
        ),
      )
      : await source([
        tsconfig,
        ...[...left, ...docs.filter((d) => left.includes(paged(d)))]
          .map((r) => `${CHECKOUT}/${r}`),
      ])
    let errors = reported(tsc.out)
    if (errors.length) console.error(errors.join('\n'))
    if (!tsc.success && !/error TS/.test(tsc.out)) {
      console.error(tsc.out, tsc.err)
      return false
    }
    let red = failed(errors)
    if (red) {
      remember(
        clear(graphed, roots, red).map((r) => proven.get(r)!),
        TYPED,
      )
    }
    return !errors.length
  } finally {
    let made = [graph, tsconfig, ...docs.map((d) => `${CHECKOUT}/${d}`)]
    await Promise.all(made.map((path) => Deno.remove(path).catch(() => {})))
  }
}

/** Check independent host programs as soon as their generated imports are
 * ready. A generator shared by hosts still runs only once. */
export let programs = async (
  jobs: { made: string[]; check: () => Promise<boolean> }[],
  run: Run,
) => {
  let generating = new Map<string, Promise<boolean>>()
  let imports = (made: string[]) =>
    Promise.all(made.map((name) => {
      if (!generating.has(name)) {
        generating.set(name, run(['run', '--no-lock', '-A', name]))
      }
      return generating.get(name)!
    })).then((out) => out.every(Boolean))
  return (await Promise.all(
    jobs.map(async (job) => await imports(job.made) && await job.check()),
  )).every(Boolean)
}

/** Check `roots` in Deno's program and each host's entries in its own, at
 * once, each after the generated modules it imports are made: those `survey`
 * says it reaches, or without one every generator's. */
let check = async (
  roots: string[],
  hosted: Host[],
  run: Run,
  snapshot?: Survey,
  all = false,
) => {
  let made = (roots: string[]) =>
    snapshot
      ? Object.entries(MADE)
        .filter(([, out]) => snapshot.reaches(roots, out))
        .map(([generator]) => generator)
      : Object.keys(MADE)
  let local = roots.filter((root) => !usesPreact(root))
  let legacy = roots.filter(usesPreact)
  return await programs(
    [
      ...roots.length
        ? [{
          made: made(roots),
          check: async () => {
            // Both renderers use the Deno slot so a fourth compiler doesn't
            // compete with the browser and Worker programs for memory.
            let react = !local.length ||
              await program(deno(), local, snapshot, all)
            let preact = !legacy.length ||
              await program(deno('preact'), legacy, snapshot, all)
            return react && preact
          },
        }]
        : [],
      ...hosted.filter((h) => h.entries.length).map((h) => ({
        made: made(h.entries),
        check: () => program(h.platform, h.entries, snapshot, all),
      })),
    ],
    run,
  )
}

/** Check the types of the modules the `changed` paths reach. */
export let types = async (
  changed: string[],
  run: Run = spawn,
  snapshot?: Promise<Survey | undefined>,
  bodiesOnly = false,
) => {
  let on = await hosts()
  let entry = (p: string) => on.some((h) => h.entries.includes(p))
  if (
    !changed.some((p) =>
      checked(p) || entry(p) || /\/(browser|workers)\.json$/.test(p)
    )
  ) return true
  let { roots, hosted, survey } = await reached(
    changed,
    on,
    snapshot,
    bodiesOnly,
  )
  return await check(roots, hosted, run, survey)
}

if (import.meta.main) {
  let code = await onRunner('check:types', Deno.args)
  if (code != undefined) Deno.exit(code)
  using _checkCPU = await localCheck()
  let all = Deno.args.includes('--all')
  let paths = Deno.args.filter((a) => !a.startsWith('--'))
  let on = await hosts()
  let ok = all
    ? await check(
      await every(),
      on,
      spawn,
      undefined,
      all,
    )
    : await types(
      paths.length
        ? paths
        : await changes({ at: Deno.env.get('TASKS_TEST_BASE') }),
    )
  if (!ok) Deno.exit(1)
}
