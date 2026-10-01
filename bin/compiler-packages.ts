// The compiler deployment's source catalog, read from workspace manifests.
// Browser entries and their imports are captured, never app code or a bundle.
// Each package keeps its exports and paths; the compiler picks the app's roots.
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'es-module-lexer/js'
import ts from 'npm:typescript@6.0.3'
import { expandGlob } from 'jsr:@std/fs@^1.0.0/expand-glob'
import type { Catalog } from '../packages/esbuild/platform.ts'

type Manifest = {
  name?: string
  exports?: string | Record<string, string>
  imports?: Record<string, string>
  workspace?: string[]
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

let script = (path: string, source: string) =>
  ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: 'preact',
      removeComments: true,
      newLine: ts.NewLineKind.LineFeed,
    },
  }).outputText

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

type Module = {
  specifier: string
  local?: string
  dependencies?: { specifier: string; code?: { specifier: string } }[]
}

// JSR has no npm install identity. Deno resolves its published module graph at
// platform deployment; the compiler receives those sources as package files.
let captured = new Map<
  string,
  Promise<{ files: Record<string, string>; entry: string }>
>()

let remote = async (
  spec: string,
): Promise<{ files: Record<string, string>; entry: string }> => {
  let command = await new Deno.Command('deno', {
    args: ['info', '--json', '--no-lock', spec],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!command.success) {
    throw new Error(new TextDecoder().decode(command.stderr))
  }
  let graph: {
    modules: Module[]
    redirects: Record<string, string>
  } = JSON.parse(new TextDecoder().decode(command.stdout))
  let files = new Map<string, string>()
  let out: Record<string, string> = {}
  for (let mod of graph.modules.filter((m) => m.local)) {
    let hash = (await digest(mod.specifier)).slice(7)
    files.set(mod.specifier, `.jsr/${hash}.ts`)
  }
  for (let mod of graph.modules.filter((m) => m.local)) {
    let file = files.get(mod.specifier)!
    let code = script(mod.specifier, Deno.readTextFileSync(mod.local!))
    let edits: { start: number; end: number; text: string }[] = []
    for (let imp of parse(code)[0]) {
      if (imp.n == null) continue
      let url = mod.dependencies?.find((d) => d.specifier == imp.n)
        ?.code?.specifier ?? new URL(imp.n, mod.specifier).href
      let target = files.get(graph.redirects[url] ?? url)
      if (!target) {
        throw new Error(`${mod.specifier}: unsupported JSR dependency ${imp.n}`)
      }
      edits.push({
        start: imp.s,
        end: imp.e,
        text: imp.d == -1
          ? './' + target.slice(5)
          : JSON.stringify('./' + target.slice(5)),
      })
    }
    for (let edit of edits.toReversed()) {
      code = code.slice(0, edit.start) + edit.text + code.slice(edit.end)
    }
    out[file] = code
  }
  let entry = files.get(graph.redirects[spec] ?? spec)
  if (!entry) throw new Error(`No JSR source entry for ${spec}`)
  return { files: out, entry }
}

let imported = async (spec: string, member: Member) => {
  if (!captured.has(spec)) captured.set(spec, remote(spec))
  let result = await captured.get(spec)!
  Object.assign(member.files, result.files)
  return result.entry
}

let mapped = (spec: string, map: Record<string, string>) => {
  if (map[spec]) return map[spec]
  let prefix = Object.keys(map).sort((a, b) => b.length - a.length)
    .find((key) =>
      spec.startsWith(key.endsWith('/') ? key : key + '/') &&
      (key.endsWith('/') || npm(map[key]))
    )
  return prefix ? map[prefix] + spec.slice(prefix.length) : spec
}

/** Capture the workspace's browser exports and their source dependency graph.
 * Import maps become npm specifiers or workspace names; type-only imports and
 * doctest examples never introduce dependencies. No source is bundled. */
export let catalog = async (root: string): Promise<Catalog> => {
  root = resolve(root)
  let config = read(join(root, 'deno.json'))
  let members = new Map<string, Member>()
  for (let path of config.workspace ?? []) {
    let dir = resolve(root, path)
    let manifest = read(join(dir, 'deno.json'))
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
    for (let glob of browser.resources ?? []) {
      if (glob.startsWith('/') || glob.split('/').includes('..')) {
        throw new Error(
          `${name}: resource glob must be package-relative: ${glob}`,
        )
      }
      for await (let hit of expandGlob(glob, { root: member.dir })) {
        let file = relative(member.dir, hit.path)
        if (!hit.isFile || excluded(file)) continue
        member.resources[file] = Deno.readTextFileSync(hit.path)
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
      code = script(file, source)
    } catch (e) {
      throw new Error(`${name}/${file}: ${e}`, { cause: e })
    }
    let edits: { start: number; end: number; text: string }[] = []
    for (let imp of parse(code)[0]) {
      if (imp.n == null) continue
      let spec = imp.n
      let own = member.manifest.imports ?? {}
      let target = mapped(spec, own)
      let base = member.dir
      if (target == spec) {
        target = mapped(spec, config.imports ?? {})
        if (target != spec) base = root
      }
      if (target.startsWith('@yaks/')) {
        member.dependencies[exported(target)] = 'platform'
      } else if (local(target)) {
        let at = resolve(target == spec ? dirname(path) : base, target)
        if (!at.startsWith(member.dir + '/')) {
          throw new Error(`${name}/${file}: cross-package path ${target}`)
        }
        enqueue(name, relative(member.dir, at))
        target = relative(dirname(path), at)
        if (!target.startsWith('.')) target = './' + target
      } else if (target.startsWith('jsr:')) {
        let at = await imported(target, member)
        target = relative(dirname(file), at)
        if (!target.startsWith('.')) target = './' + target
      } else if (npm(target)) {
        let [, pkg, version, sub = ''] = npm(target)!
        if (!version) throw new Error(`Unversioned dependency: ${target}`)
        let previous = member.dependencies[pkg]
        if (previous && previous != version) {
          throw new Error(`${name}: conflicting ${pkg} versions`)
        }
        member.dependencies[pkg] = version
        target = pkg + sub
      } else if (!/^(?:node|cloudflare):/.test(target)) {
        throw new Error(`${name}/${file}: unmapped runtime import ${target}`)
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
export let CATALOG = join(repo, 'workers/yak/.wrangler/packages.json')

/** Materialize atomically before wrangler reads the compiler wrapper. */
export let write = async (root = repo, to = CATALOG) => {
  let packages = await catalog(root)
  Deno.mkdirSync(dirname(to), { recursive: true })
  let tmp = `${to}.${crypto.randomUUID()}`
  try {
    Deno.writeTextFileSync(tmp, JSON.stringify(packages))
    Deno.renameSync(tmp, to)
  } finally {
    remove(tmp)
  }
  return packages
}

if (import.meta.main) await write(Deno.args[0] ?? repo, Deno.args[1] ?? CATALOG)
