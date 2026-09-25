// The codebase, read into a graph: a read-only @yaks/mirror binding over the
// files Git tracks in one checkout.
//
// The files own the code, so the binding only reads. What it remembers of each
// file is the blob id its module records, which is also what makes a sync
// incremental: a file whose blob still matches is not read again, and a full
// read of an unchanged tree writes nothing.
//
// Every id is derived from the vocabulary's declared identities (@yaks/graph
// `identities`): a module is its `file{path, repository}`, a symbol its module
// and name, a package its name. So reading the same tree twice is one set of
// entities, and nothing here invents an id.
//
// Nothing is ever deleted. A tombstoned id can never be written again, and a
// path or an export name comes back often, so what is gone has its components
// cleared instead: the entity stays, empty, and a later read fills it in.
// Import links are cleared the same way, with @yaks/edge's `unlink`.

import {
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  identities,
  signed,
} from '@yaks/graph'
import type { Actor } from '@yaks/graph'
import { link, unlink } from '@yaks/edge'
import type { Binding } from '@yaks/mirror'
import { blobOf } from '@yaks/mirror'
import {
  type DocNode,
  exportsOf,
  header,
  isCode,
  isMarkdown,
  type Manifest,
  manifest,
  markdown,
  owner,
  resolve,
  specifiers,
} from './read.ts'

let str = (v: unknown) => v == null ? '' : String(v)
let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** Run a command in a directory and return its stdout; a failure throws with
 * its stderr. */
let run = async (cmd: string, args: string[], cwd: string) => {
  let out = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  let err = new TextDecoder().decode(out.stderr)
  if (!out.success) throw new Error(`${cmd} ${args[0]}: ${err.trim()}`)
  return new TextDecoder().decode(out.stdout)
}

/** The checkout `cwd` is in: its root, and its repository's common Git
 * directory, both canonical. */
export let checkout = async (
  cwd: string,
): Promise<{ root: string; common: string }> => {
  let root = await Deno.realPath(
    (await run('git', ['rev-parse', '--show-toplevel'], cwd)).trim(),
  )
  let common = await Deno.realPath(
    (await run(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      root,
    )).trim(),
  )
  return { root, common }
}

/** Which tracked files are code: TS/JS modules, markdown and package
 * manifests, outside any `vendor` directory. */
export let covered = (path: string): boolean =>
  !/(^|\/)(vendor|node_modules)\//.test(path) &&
  (isCode(path) || isMarkdown(path) || /(^|\/)deno\.json$/.test(path))

/**
 * The exports of many modules at once. `deno doc` refuses a whole batch when
 * one module in it cannot be resolved, so a refused module is set aside —
 * named in `refused`, read for everything but its exports — and the rest are
 * asked again.
 */
export let exported = async (
  root: string,
  paths: string[],
): Promise<{ nodes: Record<string, DocNode>; refused: string[] }> => {
  let refused: string[] = []
  let left = paths.filter(isCode)
  while (left.length) {
    let out = await new Deno.Command('deno', {
      args: ['doc', '--json', '-q', ...left],
      cwd: root,
      env: { NO_COLOR: '1' },
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (out.success) {
      let json = JSON.parse(new TextDecoder().decode(out.stdout))
      return { nodes: json.nodes ?? {}, refused }
    }
    // deno doc names the module it could not resolve from as a file URL.
    let err = new TextDecoder().decode(out.stderr)
    let bad = [...err.matchAll(/from 'file:\/\/([^']+)'/g)]
      .map((m) => m[1].slice(root.length + 1))
      .find((p) => left.includes(p))
    if (!bad) throw new Error(`deno doc: ${err.trim()}`)
    refused.push(bad)
    left = left.filter((p) => p != bad)
  }
  return { nodes: {}, refused }
}

/** What a sync of one checkout did, beyond what the mirror reports. */
export type Read = {
  modules: number
  symbols: number
  imports: number
  packages: number
  refused: string[]
}

/** The biggest change one transaction carries. */
let BATCH = 1000

/**
 * The binding for one checkout. `full` forgets what was read, so every file
 * is read again; `read` accumulates what the reads found into `said`.
 */
export let codeMirror = async (
  g: Graph,
  cwd: string,
  opts: { full?: boolean; actor?: Actor | null } = {},
): Promise<{ binding: Binding; said: Read; root: string }> => {
  let { root, common } = await checkout(cwd)
  let derive = identities(g.vocab)
  // The id a component's declared identity gives these values; a graph whose
  // vocabulary declares no such identity cannot hold a codebase.
  let ids = (name: string, c: Comp): Eid => {
    let d = derive[name]
    if (!d) throw new Error(`this graph declares no identity for ${name}`)
    return d(c, { entity: { eid: '' }, [name]: c })
  }
  let repository = ids('repository', { common })
  let apply = async (change: Bundle[]) => {
    for (let i = 0; i < change.length; i += BATCH) {
      await g.apply(signed(change.slice(i, i + BATCH), opts.actor ?? null))
    }
  }
  await apply([{ entity: { eid: repository }, repository: { common } }])

  // Regular files only: a symlink's blob is the path it points at, and a
  // submodule is somebody else's tree.
  let tracked = (await run('git', ['ls-files', '-s', '-z'], root)).split('\0')
    .filter((l) => /^100/.test(l)).map((l) => l.slice(l.indexOf('\t') + 1))
    .filter(covered)
  let isTracked = new Set(tracked)
  let text = (path: string) => Deno.readTextFileSync(`${root}/${path}`)
  let pkgs = tracked.filter((p) => p.endsWith('deno.json')).flatMap((p) => {
    try {
      return [manifest(p, text(p))].filter((m): m is Manifest => !!m)
    } catch {
      return []
    }
  })
  let moduleOf = (path: string): Eid => ids('file', { path, repository })
  let packageOf = (name: string): Eid => ids('package', { name })

  // What the graph read last time, kept for the read below: every module of
  // this repository, by path.
  let known = new Map<string, Bundle>()
  let said: Read = {
    modules: 0,
    symbols: 0,
    imports: 0,
    packages: 0,
    refused: [],
  }

  let read = async (paths: string[], gone: string[]) => {
    let here = paths.filter((p) => !gone.includes(p))
    let mods = new Set([...paths.map(moduleOf)])
    let { nodes, refused } = await exported(root, here)
    said.refused = refused
    let change: Bundle[] = []
    let later: Bundle[] = []

    // Packages first, so a module's reference to one lands on an entity that
    // exists; and each manifest that moved clears the package it used to be.
    let wasPkgs = await g.read('.package')
    for (let path of paths.filter((p) => p.endsWith('deno.json'))) {
      let m = moduleOf(path)
      let now = pkgs.find((p) => p.path == path && !gone.includes(path))
      for (let old of wasPkgs) {
        let c = comp(old, 'package')!
        if (c.manifest == m && c.name != now?.name) {
          change.push({ entity: old.entity, package: null, doc: null })
        }
      }
      if (!now) continue
      said.packages++
      change.push({
        entity: { eid: packageOf(now.name) },
        package: { name: now.name, version: now.version ?? null, manifest: m },
        doc: { title: now.name, body: now.description ?? null },
      })
    }
    let pkgOf = (path: string) => {
      let p = owner(path, pkgs)
      return p ? packageOf(p.name) : null
    }

    // The exports and imports each module had, so what it no longer has is
    // cleared rather than left behind.
    let wasSyms = (await g.read('.symbol')).filter((b) =>
      mods.has(str(comp(b, 'symbol')?.module))
    )
    let wasLinks = (await g.read('.imports&.edge?')).filter((b) =>
      mods.has(str(comp(b, 'edge')?.from))
    )
    let keep = new Set<Eid>()

    for (let path of paths) {
      let m = moduleOf(path)
      if (gone.includes(path)) {
        change.push({ entity: { eid: m }, file: null, module: null, doc: null })
        continue
      }
      let body = text(path)
      let md = isMarkdown(path) ? markdown(path, body) : undefined
      said.modules++
      change.push({
        entity: { eid: m },
        file: { path, repository },
        module: { blob: await blobOf(body), package: pkgOf(path) },
        doc: md ?? { title: path, body: header(body) || null },
      })
      for (let e of exportsOf(nodes, `file://${root}/${path}`)) {
        let s = ids('symbol', { module: m, name: e.name })
        keep.add(s)
        said.symbols++
        later.push({
          entity: { eid: s },
          symbol: { module: m, name: e.name, kind: e.kind, line: e.line },
          doc: { title: e.name, body: e.doc || null },
        })
      }
      if (!isCode(path)) continue
      for (let spec of specifiers(body)) {
        let to = resolve(spec, path, pkgs)
        if (!to || to == path || !isTracked.has(to)) continue
        let l = link(m, 'imports', moduleOf(to))
        keep.add(l.entity.eid)
        said.imports++
        later.push(l)
      }
    }
    for (let b of wasSyms) {
      if (!keep.has(b.entity.eid)) {
        later.push({ entity: b.entity, symbol: null, doc: null })
      }
    }
    for (let b of wasLinks) {
      if (!keep.has(b.entity.eid)) {
        let e = comp(b, 'edge')!
        later.push(unlink(str(e.from), 'imports', str(e.to)))
      }
    }

    // A manifest that came or went moves every file under it: re-point the
    // modules nobody read this time.
    if (paths.some((p) => p.endsWith('deno.json'))) {
      for (let [path, b] of known) {
        if (mods.has(b.entity.eid)) continue
        let want = pkgOf(path)
        if (str(comp(b, 'module')?.package) != str(want)) {
          change.push({ entity: b.entity, module: { package: want } })
        }
      }
    }
    await apply([...change, ...later])
  }

  let binding: Binding = {
    name: 'code',
    files: async () => {
      let out = new Map<string, string>()
      for (let path of tracked) out.set(path, await blobOf(text(path)))
      return out
    },
    read,
    agreed: async () => {
      known.clear()
      for (let b of await g.read(`.file.repository=${repository}&.module?`)) {
        let path = str(comp(b, 'file')?.path)
        if (path && comp(b, 'module')) known.set(path, b)
      }
      // A full read forgets every blob, so every file reads as moved, while a
      // file that is gone is still known to have been here.
      return new Map(
        [...known].map((
          [path, b],
        ) => [path, { blob: opts.full ? '' : str(comp(b, 'module')?.blob) }]),
      )
    },
  }
  return { binding, said, root }
}
