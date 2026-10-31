// Which files a run can leave out: one whose tests all passed, when nothing
// it depends on has changed since. Before it runs, a file depends on its
// module graph, as `deno info` resolves it (a dynamic import of a literal
// specifier included); on every file a module in that graph names beside
// itself (`new URL('./fixture.json', import.meta.url)`); and on what every
// file shares: the runner, the config and lock it runs under, the runtime,
// and whatever the caller adds. A directory a module names is a place (a
// root, a working directory), not what lies in it. That is the file's key.
//
// As it runs, a file reads what no graph can say: a directory it walks, a
// file at a path it computes, a module it imports by a computed specifier
// (./reads.ts says how the runner sees them). Each is a dependency too: a
// file's bytes, a directory's listing, a module's whole graph. A pass is kept
// by its proof, the file's key with what each of those holds; a run that
// could not see them keeps the key alone. The passes are kept in a file every
// checkout on the machine shares, so the same sources passing in one worktree
// count in another, and what each key's file read in a file beside it.
import { createHash } from 'node:crypto'
import { written } from './find.ts'

/** A module graph, as `deno info --json` says one. */
export type Info = {
  modules: {
    specifier: string
    local?: string
    dependencies?: {
      code?: { specifier?: string }
      type?: { specifier?: string }
      isDynamic?: boolean
    }[]
  }[]
  redirects: Record<string, string>
}

let hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex')

let base = () => `file://${Deno.cwd()}/`
let url = (path: string) => new URL(path, base()).href
// A file's path from the checkout, so keys agree between checkouts; one
// outside it, whole. Any other specifier is itself.
let rel = (specifier: string) =>
  specifier.startsWith(base())
    ? decodeURIComponent(specifier.slice(base().length))
    : specifier.startsWith('file:')
    ? decodeURIComponent(new URL(specifier).pathname)
    : specifier
let code = (path: string) => /\.[mc]?[jt]sx?$/.test(path)

/** The module graph reached from `roots`, or undefined when deno cannot
 * say. Deno resolves it by the checkout's lock, and writes what it resolved
 * anew (a module's `/// <reference types>`) to a copy: the lock is in every
 * key, and a run that wrote it would leave its own passes behind. */
export let graph = async (roots: string[]): Promise<Info | undefined> => {
  let dir = await Deno.makeTempDir({ prefix: 'yaks-testing-' })
  try {
    let entry = `${dir}/entry.ts`
    await Deno.writeTextFile(
      entry,
      roots.map((r) => `import ${JSON.stringify(url(r))}`).join('\n'),
    )
    let lock = await Deno.copyFile('deno.lock', `${dir}/deno.lock`)
      .then(() => `--lock=${dir}/deno.lock`, () => '--no-lock')
    let out = await new Deno.Command(Deno.execPath(), {
      args: ['info', '--json', lock, entry],
      stdout: 'piped',
      stderr: 'null',
    }).output()
    return out.success
      ? JSON.parse(new TextDecoder().decode(out.stdout))
      : undefined
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

/// named("new URL('./a.json', import.meta.url)", 'x/t_test.ts') -> ['x/a.json']
/// named("new URL('../', import.meta.url)", 'x/y/t_test.ts') -> ['x']
/// named("new URL('../..', import.meta.url)", 'x/y/t_test.ts') -> ['.']
/// named("// new URL('./a.json', import.meta.url)", 'x/t_test.ts') -> []
/** What a module names beside itself: `new URL(literal, import.meta.url)`,
 * outside a comment. */
export let named = (source: string, path: string): string[] =>
  [
    ...source.replace(/^\s*(\/\/|\/\*|\*).*$/gm, '').matchAll(
      /new URL\(\s*(['"])([^'"]+)\1,\s*import\.meta\.url\s*\)/g,
    ),
  ].map((m) => rel(new URL(m[2], url(path)).href).replace(/\/$/, '') || '.')

/** What a path holds now: a file's bytes, a directory's listing (each entry's
 * name, a directory's ending in `/`, but for what the runner writes beside a
 * page while it is keyed or loads), or nothing. A directory a module only
 * names is a `place`, whatever lies in it. */
export let digest = async (path: string, place = false): Promise<string> => {
  let info = await Deno.stat(path).catch(() => undefined)
  if (!info) return 'absent'
  if (info.isFile) return hex(await Deno.readFile(path))
  if (place) return 'place'
  let names: string[] = []
  for await (let e of Deno.readDir(path)) {
    if (!written(e.name)) names.push(e.isDirectory ? `${e.name}/` : e.name)
  }
  return hex(names.sort().join('\n'))
}

/// let next = new Map([['a', ['b']], ['b', ['a']], ['c', ['a']], ['d', []]])
/// let s = seal(next, (n) => n)
/// s.get('a') == s.get('b') -> true
/// s.get('c') == s.get('a') -> false
/// s.get('c') == seal(next, (n) => n == 'b' ? 'B' : n).get('c') -> false
/// s.get('d') == seal(next, (n) => n == 'b' ? 'B' : n).get('d') -> true
/**
 * Each node's seal: a digest of what it is (`own`) and of every node it
 * reaches through `next`, so a change to any of those changes it. Nodes in a
 * cycle reach each other, and share one; a seal is made of the seals of the
 * cycles a node's own reaches (Tarjan's strongly connected components, which
 * come last first), so a graph is sealed in one pass however many roots
 * share it.
 */
export let seal = (
  next: Map<string, string[]>,
  own: (node: string) => string,
): Map<string, string> => {
  let index = new Map<string, number>(), low = new Map<string, number>()
  let stack: string[] = [], on = new Set<string>()
  let sealed = new Map<string, string>()
  let enter = (v: string) => {
    index.set(v, index.size)
    low.set(v, index.get(v)!)
    stack.push(v)
    on.add(v)
  }
  // A cycle closed at `v`: everything above it on the stack.
  let close = (v: string) => {
    let members: string[] = []
    let w
    do {
      w = stack.pop()!
      on.delete(w)
      members.push(w)
    } while (w != v)
    let inside = new Set(members)
    let beyond = new Set(
      members.flatMap((m) => next.get(m) ?? []).filter((n) => !inside.has(n))
        .map((n) => sealed.get(n)!),
    )
    let s = hex([...members.map(own).sort(), '', ...[...beyond].sort()].join(
      '\n',
    ))
    for (let m of members) sealed.set(m, s)
  }
  for (let start of next.keys()) {
    if (index.has(start)) continue
    enter(start)
    let work: [string, number][] = [[start, 0]]
    while (work.length) {
      let top = work.at(-1)!
      let [v, i] = top
      let out = next.get(v) ?? []
      if (i < out.length) {
        top[1]++
        let w = out[i]
        if (!index.has(w)) {
          enter(w)
          work.push([w, 0])
        } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!))
        continue
      }
      work.pop()
      let up = work.at(-1)?.[0]
      if (up) low.set(up, Math.min(low.get(up)!, low.get(v)!))
      if (low.get(v) == index.get(v)) close(v)
    }
  }
  return sealed
}

/** What a run knows of some paths and everything they reach, each file read
 * once: what a path holds now (`of`: a code module's seal, else its `digest`,
 * a directory its listing), what a module is with only what loads with it
 * (`loads`: its seal without what it imports only when it asks, by a literal
 * `import('…')`), and the seals of what a module imports (`next`). A file of
 * data is its bytes whether or not a module there imports it (a config read
 * as JSON), so it holds the same in every survey. */
export type Survey = {
  of: (path: string, runtime?: boolean) => Promise<string>
  loads: (path: string) => Promise<string>
  next: (path: string, runtime?: boolean) => string[]
  reaches: (
    roots: string[],
    changed: string[],
    loaded?: boolean,
    runtime?: boolean,
  ) => boolean
  distance: (changed: string[]) => (root: string) => number
}

/** How many modules a module may load and still say something about what its
 * importers depend on. Past it, a module composes a whole platform (a kernel,
 * a test fixture over one): nearly every change reaches its importers, so that
 * path does not make them relevant to the change. */
export const WIDE = 200

/** The survey of `paths`, their modules' graph from `info` (`deno info`), or
 * undefined when it cannot say what they import. */
export let survey = async (
  paths: string[],
  info: (roots: string[]) => Promise<Info | undefined> = graph,
): Promise<Survey | undefined> => {
  // What each file is and names: read once for the lot.
  let facts = new Map<string, Promise<{ digest: string; names: string[] }>>()
  let fact = (path: string) => {
    if (!facts.has(path)) {
      facts.set(
        path,
        digest(path, true).then(async (d) => ({
          digest: d,
          names: code(path)
            ? named(await Deno.readTextFile(path).catch(() => ''), path)
            : [],
        })),
      )
    }
    return facts.get(path)!
  }
  let named0 = (await Promise.all(paths.filter(code).map(fact)))
    .flatMap((f) => f.names)
  let roots = [...new Set([...paths, ...named0].filter(code))]
  let found = roots.length ? await info(roots) : { modules: [], redirects: {} }
  if (!found) return undefined
  let { redirects } = found
  let at = (s: string) => redirects[s] ?? s
  let modules = new Map(found.modules.map((m) => [m.specifier, m]))
  let local = found.modules.filter((m) => m.specifier.startsWith('file:'))
  await Promise.all(local.map((m) => fact(rel(m.specifier))))
  // A node is a module, by its specifier, or a file a module names that is
  // none, by its path. A remote module is its versioned specifier.
  let next = new Map<string, string[]>()
  let still = new Map<string, string[]>()
  let runtime = new Map<string, string[]>()
  let own = new Map<string, string>()
  for (let m of local) {
    let path = rel(m.specifier)
    let { digest: d, names } = await fact(path)
    own.set(m.specifier, `${path} ${d}`)
    let deps = (m.dependencies ?? []).flatMap((d) =>
      [d.code?.specifier, d.type?.specifier].flatMap((specifier) =>
        specifier
          ? [{
            to: at(specifier),
            asked: d.isDynamic,
            typed: specifier != d.code?.specifier,
          }]
          : []
      )
    )
    let beside: string[] = []
    for (let n of names) {
      if (modules.has(url(n))) beside.push(url(n))
      else {
        beside.push(n)
        own.set(n, `${n} ${(await fact(n)).digest}`)
        next.set(n, [])
      }
    }
    next.set(m.specifier, [...deps.map((d) => d.to), ...beside])
    runtime.set(m.specifier, [
      ...deps.flatMap((d) => d.typed ? [] : [d.to]),
      ...beside,
    ])
    still.set(m.specifier, [
      ...deps.flatMap((d) => d.asked || d.typed ? [] : [d.to]),
      ...beside,
    ])
  }
  for (let m of found.modules) {
    if (!next.has(m.specifier)) next.set(m.specifier, [])
  }
  for (let targets of [...next.values()]) {
    for (let t of targets) if (!next.has(t)) next.set(t, [])
  }
  let mine = (n: string) => own.get(n) ?? n
  let seals = seal(next, mine)
  let executed = seal(
    new Map([...next].map(([n]) => [n, runtime.get(n) ?? []])),
    mine,
  )
  let held = new Map<string, Promise<string>>()
  let reverse = new Map<Map<string, string[]>, Map<string, string[]>>()
  let incoming = (edges: Map<string, string[]>) => {
    if (!reverse.has(edges)) {
      let back = new Map<string, string[]>()
      for (let [from, targets] of edges) {
        for (let to of targets) {
          let parents = back.get(to) ?? []
          parents.push(from)
          back.set(to, parents)
        }
      }
      reverse.set(edges, back)
    }
    return reverse.get(edges)!
  }
  let closures = new Map<string, Set<string>>()
  let breadths = new Map<string, number>()
  let breadth = (node: string) => {
    if (!breadths.has(node)) {
      let seen = new Set([node])
      let go = [node]
      while (go.length) {
        for (let n of runtime.get(go.pop()!) ?? []) {
          if (seen.has(n)) continue
          seen.add(n)
          go.push(n)
        }
      }
      breadths.set(node, seen.size)
    }
    return breadths.get(node)!
  }
  return {
    of: (path, run = false) => {
      let key = `${run} ${path}`
      if (!held.has(key)) {
        let s = code(path) && (run ? executed : seals).get(at(url(path)))
        held.set(key, s ? Promise.resolve(s) : digest(path))
      }
      return held.get(key)!
    },
    loads: (path) => {
      let root = at(url(path))
      if (!code(path) || !seals.has(root)) return digest(path)
      let reached = new Set<string>()
      let go = [root]
      while (go.length) {
        let n = go.pop()!
        if (reached.has(n)) continue
        reached.add(n)
        go.push(...still.get(n) ?? [])
      }
      return Promise.resolve(hex([...reached].map(mine).sort().join('\n')))
    },
    reaches: (roots, changed, loaded = false, run = false) => {
      let cache = JSON.stringify([loaded, run, changed])
      if (!closures.has(cache)) {
        let edges = incoming(loaded ? still : run ? runtime : next)
        let seen = new Set<string>()
        let visit = changed.flatMap((p) => [p, at(url(p))])
        while (visit.length) {
          let node = visit.pop()!
          if (seen.has(node)) continue
          seen.add(node)
          visit.push(...edges.get(node) ?? [])
        }
        closures.set(cache, seen)
      }
      let reached = closures.get(cache)!
      return roots.some((p) => reached.has(p) || reached.has(at(url(p))))
    },
    distance: (changed) => {
      let edges = incoming(runtime)
      let far = new Map<string, number>()
      for (let p of changed) far.set(p, 0).set(at(url(p)), 0)
      for (let node of far.keys()) {
        let d = far.get(node)!
        if (d && breadth(node) > WIDE) continue
        for (let from of edges.get(node) ?? []) {
          if (!far.has(from)) far.set(from, d + 1)
        }
      }
      return (root) =>
        Math.min(far.get(root) ?? Infinity, far.get(at(url(root))) ?? Infinity)
    },
    next: (
      path,
      run = false,
    ) => (((run ? runtime : next).get(at(url(path))) ?? []).map((n) =>
      (run ? executed : seals).get(n)!
    )),
  }
}

/** What every file of a kind shares: `salt`, the runtime's version, what
 * each of `also` holds, and the modules of the `runner` running them, each
 * with what loads with it: the modules it imports only when it asks, for
 * some other file's sake, are that file's to depend on. */
export let shared = async (
  s: Survey,
  also: string[],
  salt = '',
  runner: string[] = [],
): Promise<string> =>
  hex(
    [
      `${Deno.version.deno} ${salt}`,
      ...(await Promise.all([
        ...also.map(async (p) => `${p} ${await s.of(p)}`),
        ...runner.map(async (p) => `${p} loads ${await s.loads(p)}`),
      ])).sort(),
    ].join('\n'),
  )

/** A file's key: `common` (what it shares with its kind), its name, and what
 * it is and reaches. A root standing for another file, `name` (an example
 * page's plan module stands for the page), is that file's: what the root
 * imports, and the page, not the root itself. */
export let key = async (
  s: Survey,
  common: string,
  root: string,
  name = root,
  runtime = false,
): Promise<string> =>
  hex(
    [
      common,
      name,
      ...name == root
        ? [await s.of(root, runtime)]
        : [...s.next(root, runtime), await s.of(name, runtime)].sort(),
    ].join('\n'),
  )

/** The pass a file is kept by: its key, and what each path it read as it ran
 * holds now. A run that could not see what it read keeps the key alone,
 * which no proof of a run that could ever matches. */
export let proof = async (
  s: Survey,
  key: string,
  reads?: string[],
  runtime = false,
): Promise<string> =>
  reads
    ? hex(
      [
        key,
        ...(await Promise.all(
          reads.map(async (p) => `${p} ${await s.of(p, runtime)}`),
        )).sort(),
      ].join('\n'),
    )
    : key

let cache = Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`

/** Where passes are kept, by proof, for every checkout on this machine. */
export let STORE: string = `${cache}/yak/tests-passed.json`

/** Where what each key's file read as it last passed is kept, beside them. */
export let READS: string = `${cache}/yak/tests-read.json`

// Enough passes for every file of many checkouts; the oldest go first.
let KEEP = 100_000

let load = <T>(store: string): Record<string, T> => {
  try {
    return JSON.parse(Deno.readTextFileSync(store))
  } catch {
    return {}
  }
}

/** The passes kept, each with when. */
export let passed = (store = STORE): Record<string, number> => load(store)

/** What each key's file read as it last passed. */
export let recall = (store = READS): Record<string, string[]> => load(store)

/** Adds passes made now to what the store holds. */
export let remember = (proofs: string[], store = STORE): void => {
  if (!proofs.length) return
  let now = Date.now()
  save(
    { ...passed(store), ...Object.fromEntries(proofs.map((k) => [k, now])) },
    store,
  )
}

/**
 * Adds what each key's file read as it passed now. A file that read nothing
 * has no entry: what it read then is nothing, and its proof matches only a
 * pass that read nothing, so a lost entry costs a run, never a miss. The
 * newest are kept, last in the store.
 */
export let note = (reads: Record<string, string[]>, store = READS): void => {
  let all = recall(store)
  let changed = false
  for (let [k, paths] of Object.entries(reads)) {
    if (!paths.length && !(k in all)) continue
    delete all[k]
    if (paths.length) all[k] = paths
    changed = true
  }
  if (changed) {
    write(Object.fromEntries(Object.entries(all).slice(-KEEP)), store)
  }
}

/** Takes passes back out of what the store holds: those that a caller
 * holding the run to more than passing (bin/test-budget.ts) does not grant. */
export let forget = (proofs: string[], store = STORE): void => {
  if (!proofs.length) return
  let all = passed(store)
  for (let k of proofs) delete all[k]
  save(all, store)
}

// The store holding `all`, the newest kept, written whole.
let save = (all: Record<string, number>, store: string) =>
  write(
    Object.fromEntries(
      Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, KEEP),
    ),
    store,
  )

let write = (all: unknown, store: string) => {
  Deno.mkdirSync(store.slice(0, store.lastIndexOf('/')), { recursive: true })
  let draft = `${store}.${Deno.pid}`
  Deno.writeTextFileSync(draft, JSON.stringify(all))
  Deno.renameSync(draft, store)
}
