// Which files a run can leave out: one whose tests all passed, when nothing
// it depends on has changed since. A file depends on its module graph, as
// `deno info` resolves it (a dynamic import of a literal specifier
// included); on every file or directory a module in that graph names beside
// itself (`new URL('./fixture.json', import.meta.url)`); and on what every
// file shares: the runner, the config and lock it runs under, the runtime,
// and whatever the caller adds. A file read any other way is not seen, so a
// run that must not trust the record asks for all of it.
//
// A key is a digest of all that. A passed key is kept in a file every
// checkout on the machine shares, so the same sources passing in one
// worktree count in another.

type Info = {
  modules: {
    specifier: string
    local?: string
    dependencies?: { code?: { specifier?: string } }[]
  }[]
  redirects: Record<string, string>
}

let hex = async (data: string | Uint8Array<ArrayBuffer>) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof data == 'string' ? new TextEncoder().encode(data) : data,
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')

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
 * say. */
export let graph = async (roots: string[]): Promise<Info | undefined> => {
  let dir = await Deno.makeTempDir({ prefix: 'yaks-testing-' })
  try {
    let entry = `${dir}/entry.ts`
    await Deno.writeTextFile(
      entry,
      roots.map((r) => `import ${JSON.stringify(url(r))}`).join('\n'),
    )
    let out = await new Deno.Command(Deno.execPath(), {
      args: ['info', '--json', entry],
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

let SKIP = ['node_modules', '.wrangler', 'vendor']

// A digest of a file's bytes, or of every file under a directory.
let digest = async (path: string): Promise<string> => {
  let info = await Deno.stat(path).catch(() => undefined)
  if (!info) return 'absent'
  if (info.isFile) return await hex(await Deno.readFile(path))
  let names: string[] = []
  for await (let e of Deno.readDir(path)) {
    if (!e.name.startsWith('.') && !SKIP.includes(e.name)) names.push(e.name)
  }
  let parts = await Promise.all(
    names.sort().map(async (n) => `${n} ${await digest(`${path}/${n}`)}`),
  )
  return await hex(parts.join('\n'))
}

/**
 * A key for each root: a digest of everything it depends on. `as` gives the
 * name a root is recorded by, where it stands for another file (an example
 * page's plan module stands for the page, which it depends on too); `also`
 * are paths every root depends on, and `salt` whatever else they share.
 * Without a graph there are no keys, and every file runs.
 */
export let keys = async (
  roots: string[],
  { also = [], salt = '', as = new Map<string, string>() }: {
    also?: string[]
    salt?: string
    as?: Map<string, string>
  } = {},
): Promise<Map<string, string>> => {
  // What each file is, and names: read once for the lot.
  let facts = new Map<string, Promise<{ digest: string; names: string[] }>>()
  let fact = (path: string) => {
    if (!facts.has(path)) {
      facts.set(
        path,
        digest(path).then(async (d) => ({
          digest: d,
          names: code(path)
            ? named(await Deno.readTextFile(path).catch(() => ''), path)
            : [],
        })),
      )
    }
    return facts.get(path)!
  }
  let starts = [...roots, ...also]
  let named0 = (await Promise.all(starts.map(fact))).flatMap((f) => f.names)
  let info = await graph([...new Set([...starts, ...named0].filter(code))])
  if (!info) return new Map()
  let modules = new Map(info.modules.map((m) => [m.specifier, m]))
  let local = info.modules.filter((m) => m.local).map((m) => rel(m.specifier))
  await Promise.all(local.map(fact))
  let names = new Map<string, string[]>()
  for (let [path, f] of facts) names.set(path, (await f).names)
  // The files and remote modules a path reaches.
  let reach = (paths: string[]) => {
    let seen = new Set<string>(), files = new Set<string>()
    let visit = (specifier: string) => {
      specifier = info.redirects[specifier] ?? specifier
      if (seen.has(specifier)) return
      seen.add(specifier)
      let m = modules.get(specifier)
      if (!specifier.startsWith('file:')) return
      let path = rel(specifier)
      files.add(path)
      for (let d of m?.dependencies ?? []) {
        if (d.code?.specifier) visit(d.code.specifier)
      }
      for (let n of names.get(path) ?? []) {
        if (modules.has(url(n))) visit(url(n))
        else files.add(n)
      }
    }
    paths.forEach((p) => visit(url(p)))
    return [...[...seen].filter((s) => !s.startsWith('file:')), ...files]
  }
  let digestOf = async (paths: string[]) =>
    await hex(
      (await Promise.all(
        reach(paths).map(async (f) =>
          f.includes(':') ? f : `${f} ${(await fact(f)).digest}`
        ),
      )).sort().join('\n'),
    )
  let shared = await hex(`${salt}\n${await digestOf(also)}`)
  let out = new Map<string, string>()
  for (let r of roots) {
    let name = as.get(r) ?? r
    out.set(r, await hex(`${shared}\n${name}\n${await digestOf([r, name])}`))
  }
  return out
}

/** Where passed keys are kept, for every checkout on this machine. */
export let STORE = `${
  Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`
}/yak/tests-passed.json`

// Enough keys for every file of many checkouts; the oldest go first.
let KEEP = 100_000

/** The keys that passed, each with when. */
export let passed = (store = STORE): Record<string, number> => {
  try {
    return JSON.parse(Deno.readTextFileSync(store))
  } catch {
    return {}
  }
}

/** Adds keys that passed now to what the store holds. */
export let remember = (keys: string[], store = STORE) => {
  if (!keys.length) return
  let now = Date.now()
  let all = {
    ...passed(store),
    ...Object.fromEntries(keys.map((k) => [k, now])),
  }
  let kept = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, KEEP)
  Deno.mkdirSync(store.slice(0, store.lastIndexOf('/')), { recursive: true })
  let draft = `${store}.${Deno.pid}`
  Deno.writeTextFileSync(draft, JSON.stringify(Object.fromEntries(kept)))
  Deno.renameSync(draft, store)
}
