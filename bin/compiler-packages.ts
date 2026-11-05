// The kernel deployment's source catalog, read from workspace manifests.
// Browser entries and their imports are captured, never app code or a bundle.
// Each package keeps its exports and paths; the compiler picks the app's roots.
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'es-module-lexer/js'
import type ts from 'typescript'
import { glob, stat } from 'node:fs/promises'
import type { Catalog } from '../packages/esbuild/platform.ts'
import { members as workspace } from '@yaks/cli/dependencies'

type Manifest = {
  name?: string
  exports?: string | Record<string, string>
  dependencies?: Record<string, string>
  workspaces?: string[]
}
type Member = {
  dir: string
  manifest: Manifest
  exports: Record<string, string>
  files: Record<string, string>
  resources: Record<string, string>
  dependencies: Record<string, string>
}

let read = (path: string): Manifest => JSON.parse(Deno.readTextFileSync(path))

let optional = (
  path: string,
): { entries?: string[]; resources?: string[] } | null => {
  try {
    return JSON.parse(Deno.readTextFileSync(path))
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null
    throw e
  }
}

let ordered = <T>(map: Record<string, T>) =>
  Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))

let digest = async (text: string) =>
  'sha256:' + [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
  ].map((n) => n.toString(16).padStart(2, '0')).join('')

/** What transpiling made of each source, by a digest of this module, the
 * file's name and its text. TypeScript makes a program for every file, which
 * is most of a catalog's cost, and the same bytes always come out the same:
 * `kept` is what an earlier catalog made, `made` what this one used. */
export type Transpiled = {
  kept: Record<string, string>
  made: Record<string, string>
}

// Loaded for the first source no earlier catalog transpiled.
let typescript: Promise<typeof ts> | undefined
let salt = digest(Deno.readTextFileSync(new URL(import.meta.url)))

let script = async (path: string, source: string, memo: Transpiled) => {
  let key = (await digest(`${await salt}\0${path}\0${source}`)).slice(7)
  let code = memo.kept[key]
  if (code == null) {
    let tsc = await (typescript ??= import('typescript').then((m) => m.default))
    code = tsc.transpileModule(source, {
      fileName: path,
      compilerOptions: {
        target: tsc.ScriptTarget.ESNext,
        module: tsc.ModuleKind.ESNext,
        jsx: tsc.JsxEmit.ReactJSX,
        jsxImportSource: 'preact',
        removeComments: true,
        newLine: tsc.NewLineKind.LineFeed,
      },
    }).outputText
  }
  return memo.made[key] = code
}

let npm = (spec: string) =>
  /^npm:((?:@[^/]+\/)?[^@/]+)(?:@([^/]+))?(\/.*)?$/.exec(spec)
let packageOf = (spec: string) =>
  spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : spec.split('/')[0]
let local = (spec: string) => /^\.{1,2}\//.test(spec)
let excluded = (path: string) =>
  /(^|\/)(?:fixtures?|node_modules|\.wrangler|tests?)(\/|$)/.test(path) ||
  /(?:_test|\.test|_bench|\.bench)\.[^.]+$/.test(path)

/** Capture the workspace's browser exports and their source dependency graph.
 * Dependencies come from package.json; type-only imports and
 * doctest examples never introduce dependencies. No source is bundled. */
export let catalog = async (
  root: string,
  memo: Transpiled = { kept: {}, made: {} },
): Promise<Catalog> => {
  root = resolve(root)
  let members = new Map<string, Member>()
  for (let path of workspace(root)) {
    let dir = resolve(root, path)
    let manifest = read(join(dir, 'package.json'))
    if (!manifest.name?.startsWith('@yaks/') || !manifest.exports) continue
    members.set(manifest.name, {
      dir,
      manifest,
      exports: typeof manifest.exports == 'string'
        ? { '.': manifest.exports }
        : manifest.exports,
      files: {},
      resources: {},
      dependencies: {},
    })
  }
  let pending: [string, string][] = []
  let queued = new Set<string>()
  let enqueue = (name: string, file: string) => {
    let member = members.get(name)!
    let path = relative(member.dir, resolve(member.dir, file))
    if (path.startsWith('../') || excluded(path)) {
      throw new Error(`${name}: source outside catalog: ${file}`)
    }
    let key = `${name}/${path}`
    if (queued.has(key)) return
    queued.add(key)
    pending.push([name, path])
  }
  let exported = (spec: string) => {
    let name = packageOf(spec)
    let member = members.get(name)
    if (!member) throw new Error(`No workspace package for ${spec}`)
    let key = '.' + spec.slice(name.length)
    let file = member.exports[key]
    if (!file) throw new Error(`${name} does not export ${key}`)
    enqueue(name, file)
    return name
  }
  for (let [name, member] of members) {
    let browser = optional(join(member.dir, 'browser.json'))
    if (!browser) continue
    for (let pattern of browser.resources ?? []) {
      if (pattern.startsWith('/') || pattern.split('/').includes('..')) {
        throw new Error(
          `${name}: resource glob must be package-relative: ${pattern}`,
        )
      }
      for await (let hit of glob(pattern, { cwd: member.dir })) {
        let file = hit.replaceAll('\\', '/')
        let path = join(member.dir, hit)
        if (!(await stat(path)).isFile() || excluded(file)) continue
        member.resources[file] = Deno.readTextFileSync(path)
      }
    }
    for (
      let key of new Set([
        ...(browser.entries ?? ['.']),
        './vocab',
        './views',
        './ui',
      ])
    ) {
      if (member.exports[key]) enqueue(name, member.exports[key])
    }
  }
  while (pending.length) {
    let [name, file] = pending.shift()!
    let member = members.get(name)!
    let path = join(member.dir, file)
    let source = Deno.readTextFileSync(path)
    if (!/\.[cm]?[jt]sx?$/.test(file)) {
      member.files[file] = source
      continue
    }
    let code: string
    try {
      code = await script(file, source, memo)
    } catch (e) {
      throw new Error(`${name}/${file}: ${e}`, { cause: e })
    }
    let edits: { start: number; end: number; text: string }[] = []
    for (let imp of parse(code)[0]) {
      if (imp.n == null) continue
      let spec = imp.n
      let target = spec
      let dependency = member.manifest.dependencies?.[packageOf(spec)]
      if (target.startsWith('@yaks/')) {
        member.dependencies[exported(target)] = 'platform'
      } else if (local(target)) {
        let at = resolve(dirname(path), target)
        if (!at.startsWith(member.dir + '/')) {
          throw new Error(`${name}/${file}: cross-package path ${target}`)
        }
        enqueue(name, relative(member.dir, at))
      } else if (dependency) {
        let alias = npm(dependency)
        let pkg = alias?.[1] ?? packageOf(spec)
        let version = alias?.[2] ?? dependency
        let previous = member.dependencies[pkg]
        if (previous && previous != version) {
          throw new Error(`${name}: conflicting ${pkg} versions`)
        }
        member.dependencies[pkg] = version
        target = pkg + spec.slice(packageOf(spec).length)
      } else if (!/^(?:node|cloudflare):/.test(target)) {
        throw new Error(`${name}/${file}: undeclared runtime import ${target}`)
      }
      if (target != spec) {
        edits.push({
          start: imp.s,
          end: imp.e,
          text: imp.d == -1 ? target : JSON.stringify(target),
        })
      }
    }
    for (let edit of edits.toReversed()) {
      code = code.slice(0, edit.start) + edit.text + code.slice(edit.end)
    }
    member.files[file] = code
  }
  let out: Catalog = {}
  for (let [name, member] of members) {
    if (!Object.keys(member.files).length) continue
    let exports = Object.fromEntries(
      Object.entries(member.exports).filter(([, file]) =>
        relative(member.dir, resolve(member.dir, file)) in member.files
      ),
    )
    let dependencies = ordered(member.dependencies)
    member.files['package.json'] = JSON.stringify({
      name,
      type: 'module',
      exports,
      dependencies,
    })
    let files = ordered(member.files)
    let resources = ordered(member.resources)
    out[name] = {
      files,
      resources,
      dependencies,
      version: await digest(JSON.stringify({ files, resources })),
    }
  }
  return ordered(out)
}

let remove = (path: string) => {
  try {
    Deno.removeSync(path)
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
}

let repo = fileURLToPath(new URL('../', import.meta.url))
// A static asset of the kernel's own version, read by a compile through ASSETS
// (workers/yak/esbuild.ts), never part of the script every isolate loads.
export let CATALOG = join(repo, 'workers/yak/public/_compiler/packages.json')
let MEMO = join(repo, 'workers/yak/.wrangler/transpiled.json')

let materialize = (to: string, value: unknown) => {
  Deno.mkdirSync(dirname(to), { recursive: true })
  let tmp = `${to}.${crypto.randomUUID()}`
  try {
    Deno.writeTextFileSync(tmp, JSON.stringify(value))
    Deno.renameSync(tmp, to)
  } finally {
    remove(tmp)
  }
}

let kept = (path: string): Record<string, string> => {
  try {
    return JSON.parse(Deno.readTextFileSync(path))
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof SyntaxError) return {}
    throw e
  }
}

/** Materialize atomically before wrangler reads the kernel, with
 * reusable transpilation at `memo`, which can outlive the checkout. */
export let write = async (
  root = repo,
  to = CATALOG,
  memo = join(dirname(to), 'transpiled.json'),
) => {
  let made: Record<string, string> = {}
  let packages = await catalog(root, { kept: kept(memo), made })
  materialize(to, packages)
  materialize(memo, made)
  return packages
}

if (import.meta.main) {
  let to = Deno.args[1] ?? CATALOG
  let cache = Deno.env.get('DENO_DIR')
  await write(
    Deno.args[0] ?? repo,
    to,
    Deno.args[2] ??
      (cache
        ? join(cache, 'yak', 'compiler-transpiled.json')
        : to == CATALOG
        ? MEMO
        : join(dirname(to), 'transpiled.json')),
  )
}
