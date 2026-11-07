import { fault } from '@yaks/api/refuse'
import * as disk from '@yaks/file/io'
import { watchReads } from '@yaks/file/io'
import { watchImports } from '@yaks/fp/imports'
import { modules } from '@yaks/process/modules'
import * as system from '@yaks/process/system'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runtimeTree } from './runtime.ts'
// What a supervised process runs, so `yak restart` replaces only one whose
// code or config changed (./restart.ts). A process in a pinned runtime
// (./runtime.ts) runs from a tree nothing rewrites while it runs. What it can
// run from that tree is its entry's module graph, and beyond what any graph
// names: a module it imports by a computed specifier (a plugin's facet, a
// bundler, through @yaks/fp/imports), a module a bundler reads for the
// browser (reported the same way), and a file it reads (@yaks/file/io). A
// process given `--ready` keeps each, as a path in its tree, in its code
// record beside its ready file, rewritten as it learns more.
//
// A record is proved against another tree the way the test runner proves a
// pass (@yaks/testing/deps): the module graph of its roots, computed in the
// tree it ran from, with every file it reaches, the configs over them and
// every file it read compared byte for byte.

/** What a process runs: the tree it runs from, by path and by id, the roots
 * beyond its entry and the files it read there, as paths in the tree, and
 * the digest of its config. */
export type Code = {
  root: string
  tree: string
  imports: string[]
  reads: string[]
  config?: { path: string; sum: string }
}

/** The entry every `yak` process starts from, in its tree. */
export let ENTRY = 'packages/cli/yak.ts'

// What every module shares, beside the configs over it.
let SHARED = ['deno.json', 'deno.lock', 'package.json', 'pnpm-lock.yaml']

/// codeFile('/run/user/1000/yak-web-1.ready') -> '/run/user/1000/yak-web-1.code'
/** Where the process whose ready file is `ready` keeps its code record. */
export let codeFile = (ready: string): string =>
  ready.replace(/\.ready$/, '') + '.code'

let sum = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

let digest = (path: string) => disk.readFile(path).then(sum, () => undefined)

/// inside('/c/0', 'file:///c/0/packages/a.ts') -> 'packages/a.ts'
/// inside('/c/0', '/c/0/packages/') -> 'packages'
/// inside('/c/0', '/c/0/node_modules/x/a.js') -> undefined
/// inside('/c/0', '/c/01/a.ts') -> undefined
/** A path in the tree at `root`, outside its `node_modules`, which its lock
 * speaks for. */
export let inside = (root: string, at: string | URL): string | undefined => {
  let path = at instanceof URL || at.startsWith('file:')
    ? fileURLToPath(at)
    : disk.resolve(at)
  if (!path.startsWith(`${root}/`)) return
  let rel = path.slice(root.length + 1).replace(/\/$/, '')
  return /(^|\/)node_modules(\/|$)/.test(rel) || !rel ? undefined : rel
}

/** Keep what this process runs in `file`, if it runs from a pinned tree,
 * from now until `stop` removes it; `now` is what it holds. The record is
 * rewritten, whole, within a second of learning more. */
export let record = (
  file: string,
  config?: string,
  tree = runtimeTree(),
): { now: () => Code | undefined; stop: () => Promise<void> } => {
  if (!tree) return { now: () => undefined, stop: async () => {} }
  let imports = new Set<string>(), reads = new Set<string>()
  let said = config
    ? { path: disk.resolve(config), sum: sum(disk.readFileSync(config)) }
    : undefined
  let now = (): Code => ({
    root: tree.root,
    tree: tree.id,
    imports: [...imports].sort(),
    reads: [...reads].sort(),
    ...said ? { config: said } : {},
  })
  let pending: ReturnType<typeof setTimeout> | undefined
  let written = Promise.resolve()
  let stopped = false
  let write = () => {
    pending = undefined
    written = written.then(async () => {
      if (stopped) return
      let next = `${file}.${crypto.randomUUID()}`
      await disk.writeTextFile(next, JSON.stringify(now()))
      await disk.rename(next, file)
    }).catch((error) => fault(error, `writing ${file}`))
  }
  let learn = (into: Set<string>, at: string | URL) => {
    let rel = inside(tree.root, at)
    if (!rel || into.has(rel)) return
    into.add(rel)
    if (pending || stopped) return
    pending = setTimeout(write, 1000)
    system.unrefTimer(pending)
  }
  let offImports = watchImports((specifier) => {
    if (specifier.startsWith('file:')) learn(imports, specifier)
  })
  let offReads = watchReads((path) => learn(reads, path))
  write()
  return {
    now,
    stop: async () => {
      stopped = true
      offImports()
      offReads()
      clearTimeout(pending)
      await written
      await disk.remove(file).catch(() => {})
    },
  }
}

// A file's bytes, a directory's listing, or nothing.
let held = async (path: string): Promise<string | undefined> => {
  let info = await disk.stat(path).catch(() => undefined)
  if (!info) return
  if (!info.isDirectory) return digest(path)
  let names = []
  for await (let entry of disk.readDir(path)) names.push(entry.name)
  return names.sort().join('\n')
}

/** Why the process `code` describes would run differently from one started
 * from the tree `tree`, or undefined when it runs the same: the config, or
 * the first file, that differs. */
export let stale = async (
  code: Code,
  tree: { root: string; id: string },
): Promise<string | undefined> => {
  if (code.config && (await digest(code.config.path)) != code.config.sum) {
    return `${code.config.path} differs`
  }
  if (code.tree == tree.id) return
  let graph = await disk.stat(code.root).then(
    () =>
      modules(
        [ENTRY, ...code.imports].map((p) => `file://${code.root}/${p}`),
        code.root,
      ),
    () => undefined,
  )
  if (!graph) return `deno can't say what ${code.root} loads`
  let files = new Set([...SHARED, ...code.reads])
  for (let m of graph.modules) {
    let rel = m.local ? inside(code.root, m.local) : undefined
    if (!rel) continue
    files.add(rel)
    for (let dir = rel; dir.includes('/');) {
      dir = dir.slice(0, dir.lastIndexOf('/'))
      files.add(`${dir}/deno.json`)
      files.add(`${dir}/package.json`)
    }
  }
  for (let rel of [...files].sort()) {
    let [was, now] = await Promise.all([
      held(`${code.root}/${rel}`),
      held(`${tree.root}/${rel}`),
    ])
    if (was != now) return `${rel} differs`
  }
}
