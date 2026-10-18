// Derived command declarations, kept between processes while their inputs and
// sources agree. A memo is disposable: an unreadable memo or a source whose
// dependencies cannot be proved leaves the ordinary derivation in charge.
// Every command asks, so a hit is proved the way a version control index
// proves a clean tree: by each source's stat as it was read, or its
// directory's stat while it remains absent, and by contents where a stat moved. A memo nothing has read for a day (a
// deleted worktree's, a probe config's, an older version's) goes at the next
// miss.

/** A source module, or an optional facet of a configured package. */
export type MemoRoot = string | readonly [plugin: string, facet: string]

export type MemoFiles = {
  readTextFileSync: (path: string) => string
  statSync: (
    path: string,
  ) => Pick<Deno.FileInfo, 'size' | 'mtime' | 'ctime' | 'ino'>
  mkdirSync: (path: string, options: Deno.MkdirOptions) => void
  writeTextFileSync: (
    path: string,
    text: string,
    options: Deno.WriteFileOptions,
  ) => void
  renameSync: (from: string, to: string) => void
  removeSync: (path: string) => void
  readDirSync: (path: string) => Iterable<{ name: string }>
  utimeSync: (path: string, atime: Date, mtime: Date) => void
}

export type MemoOptions = {
  dir?: string
  files?: MemoFiles
  resolve?: (specifier: string) => string
  /** Function-valued fields excluded from each facet's derived data. */
  callbacks?: { [facet: string]: readonly string[] }
  /** Literal source dependencies; injected at the filesystem boundary in tests. */
  imports?: (source: string, name?: string) => Promise<string[]>
  /** The digest boundary is synchronous in memory tests. */
  digest?: (text: string) => string | Promise<string>
}

type Record<T> = {
  version: number
  roots: string[]
  files: string[]
  /** each file's stat as its contents were read, '' where they could still
   * change without moving it */
  stats: string[]
  absent?: { [path: string]: readonly [directory: string, stat: string] }
  source: string
  value: T
}

let VERSION = 7
let HOUR = 3_600_000
let DAY = 24 * HOUR
let FILES = ['deno.json', 'deno.jsonc']
let encoder = new TextEncoder()
let sha256 = async (text: string): Promise<string> =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
// Each path and present value carries its UTF-16 length; absence has its own
// marker. Concatenated entries have exactly one reading, including empty files.
let framed = (path: string, text: string | null): string =>
  `${path.length}:${path}${text === null ? 'n' : `s${text.length}:${text}`}`
let local = (s: string) => s.startsWith('file:')
let packaged = (s: string) => /^(?:npm|jsr):/.test(s)
let immutable = (s: string) =>
  /^(?:npm|jsr):[^\s]+@\d+\.\d+\.\d+(?:[-+][\w.-]+)?(?:\/|$)/.test(s) ||
  s.startsWith('node:')
let packageKey = (s: string): string => {
  let key = /^(?:npm|jsr):(?:@[^/]+\/)?[^/@]+@[^/]+/.exec(s)?.[0] ?? s
  // Deno records JSR's ^N.0.0 ranges as N; both describe the same releases.
  return key.startsWith('jsr:')
    ? key.replace(/@\^([1-9]\d*)\.0\.0$/, '@$1')
    : key
}
let pathOf = (s: string) => decodeURIComponent(new URL(s).pathname)

/** The memos a miss sweeps: those nothing has read for a day. A hit moves its
 * memo's time at most hourly, so a memo in use never ages out.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let now = Date.parse('2026-10-12T12:00:00Z')
 * assertEquals(
 *   idle([
 *     { name: 'gone.json', at: now - 2 * 86_400_000 },
 *     { name: 'used.json', at: now - 3_600_000 },
 *   ], now),
 *   ['gone.json'],
 * )
 * ```
 */
export let idle = (
  entries: readonly { name: string; at: number }[],
  now: number,
): string[] => entries.filter((e) => now - e.at > DAY).map((e) => e.name)

// No parser in an ordinary memo hit, and no subprocess in either path.
import type { ImportSpecifier } from 'es-module-lexer/js'

export let sourceImports = (
  source: string,
  parsed: readonly ImportSpecifier[],
): string[] =>
  parsed.filter((i) => {
    if (!i.n) return false
    if (i.d >= 0) return true
    if (i.d != -1) return false
    let statement = source.slice(i.ss, i.se)
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ')
    if (/^(?:import|export)\s+type\s+(?!from\b)/.test(statement)) return false
    let named = /^(?:import|export)\s*\{([^}]*)\}\s*from\b/.exec(statement)
    let members = named?.[1].split(',').filter((s) => s.trim())
    return !members?.length ||
      !members.every((s) => /^\s*type\s+(?!as\b)/.test(s))
  }).map((i) => i.n!)

let importsOf = async (
  source: string,
  name?: string,
  callbacks: readonly string[] = [],
): Promise<string[]> => {
  let { parse } = await import('es-module-lexer/js')
  try {
    let parsed = parse(source)[0]
    if (!callbacks.length || !parsed.some((i) => i.d >= 0)) {
      return sourceImports(source, parsed)
    }
  } catch {
    /* TSX needs the syntax-aware scanner too. */
  }
  return (await import('./parser.ts')).imports(source, name, callbacks)
}

let directory = (): string | undefined => {
  try {
    let root = Deno.env.get('XDG_CACHE_HOME')
    let home = Deno.env.get('HOME')
    return root || home ? `${root ?? `${home}/.cache`}/yak/cli` : undefined
  } catch {
    return undefined
  }
}

/** Reuse JSON data while the configuration and every literal source dependency
 * are unchanged. Static imports and literal dynamic imports are tracked; a
 * caller supplies roots for modules chosen by runtime callbacks. Callbacks
 * projected out of the data keep their imports for invocation. A source agrees
 * while its stat has not moved, or, once it has, while its contents (or its
 * absence) still do. Only the digest of `inputs` is kept; callers project away
 * closures and host capabilities before returning their data. */
export let remember = async <T>(
  inputs: unknown,
  roots: readonly MemoRoot[],
  make: () => T | Promise<T>,
  opts: MemoOptions = {},
): Promise<T> => {
  let io = opts.files ?? Deno
  let digest = opts.digest ?? sha256
  let locate = opts.resolve ?? import.meta.resolve
  let resolved = new Map<string, string>()
  let resolve = (specifier: string): string => {
    let known = resolved.get(specifier)
    if (known !== undefined) return known
    let found = locate(specifier)
    resolved.set(specifier, found)
    return found
  }
  let dir = opts.dir ?? directory()
  if (!dir) return await make()
  let file: string
  let identities: string[] = []
  let starts: string[] = []
  let packages: string[] = []
  let callbacks = new Map<string, readonly string[]>()
  try {
    file = `${dir}/${await digest(
      JSON.stringify([
        VERSION,
        Deno.version,
        inputs,
        roots,
        opts.callbacks ?? {},
      ]),
    )}.json`
    for (let root of roots) {
      if (typeof root == 'string') {
        let spec = resolve(root)
        if (!local(spec) && !packaged(spec) && !immutable(spec)) {
          throw new Error('mutable module')
        }
        starts.push(spec)
        callbacks.set(spec, [])
        identities.push(spec)
      } else {
        let [plugin, facet] = root
        // Even an absent export depends on its package's export map.
        let owner = resolve(plugin)
        if (!local(owner) && !packaged(owner) && !immutable(owner)) {
          throw new Error('mutable module')
        }
        packages.push(owner)
        let spec: string | undefined
        try {
          spec = resolve(`${plugin}/${facet}`)
        } catch {
          /* The derivation decides whether an absent facet is allowed. */
        }
        if (spec && !local(spec) && !packaged(spec) && !immutable(spec)) {
          throw new Error('mutable module')
        }
        identities.push(owner, spec ?? `absent:${plugin}/${facet}`)
        if (spec) {
          starts.push(spec)
          let excluded = opts.callbacks?.[facet] ?? []
          let known = callbacks.get(spec)
          callbacks.set(
            spec,
            known ? known.filter((n) => excluded.includes(n)) : excluded,
          )
        }
      }
    }
  } catch {
    return await make()
  }

  let read = (path: string): string | null => {
    try {
      return io.readTextFileSync(path)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return null
      throw e
    }
  }
  // A file's size, times and inode, which every write to it moves. One written
  // within the clock's last tick could be written again without moving them,
  // so it has no stat to trust ('').
  let stat = (path: string): string => {
    try {
      let { size, mtime, ctime, ino } = io.statSync(path)
      let at = [mtime?.getTime(), ctime?.getTime()]
      return at.some((t) => t == null || Date.now() - t < 2)
        ? ''
        : `${size} ${at.join(' ')} ${ino}`
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return 'absent'
      throw e
    }
  }
  // A stable directory listing distinguishes a missing leaf from a broken
  // symlink. Its stat then proves that absence without asking for the leaf.
  let absent = (
    files: string[],
    stats: string[],
    prior: Record<T>['absent'] = {},
  ): Record<T>['absent'] => {
    let directories = new Map<string, Set<string>>()
    let proved: NonNullable<Record<T>['absent']> = { ...prior }
    for (let [i, path] of files.entries()) {
      if (stats[i] != 'absent') continue
      let parent = path.slice(0, path.lastIndexOf('/')) || '/'
      let names = directories.get(parent)
      if (!names) directories.set(parent, names = new Set())
      names.add(path)
    }
    for (let [parent, paths] of directories) {
      try {
        let before = stat(parent)
        if (!before || before == 'absent') continue
        let names = new Set(Array.from(io.readDirSync(parent), (e) => e.name))
        if (before != stat(parent)) continue
        for (let path of paths) {
          delete proved[path]
          if (!names.has(path.slice(path.lastIndexOf('/') + 1))) {
            proved[path] = [parent, before]
          }
        }
      } catch { /* An absence we cannot prove still checks the file. */ }
    }
    return proved
  }
  let fingerprint = (files: Iterable<[string, string | null]>) =>
    digest(Array.from(files, ([path, text]) => framed(path, text)).join(''))
  let snapshot = (files: string[]) =>
    fingerprint(files.map((path) => [path, read(path)]))
  let keep = (record: Record<T>) => {
    let draft = `${file}.${crypto.randomUUID()}`
    try {
      io.mkdirSync(dir, { recursive: true, mode: 0o700 })
      io.writeTextFileSync(draft, JSON.stringify(record), { mode: 0o600 })
      io.renameSync(draft, file)
    } catch {
      /* Persistence is optional. */
    } finally {
      try {
        io.removeSync(draft)
      } catch { /* A renamed draft is already gone. */ }
    }
  }
  // A hit says it was read, at most hourly, so a sweep leaves it alone.
  let seen = () => {
    try {
      let at = io.statSync(file).mtime?.getTime()
      if (at != null && Date.now() - at > HOUR) {
        let now = new Date()
        io.utimeSync(file, now, now)
      }
    } catch { /* An unrefreshed memo is only rebuilt sooner. */ }
  }
  let sweep = () => {
    try {
      let entries = []
      for (let { name } of io.readDirSync(dir)) {
        let path = `${dir}/${name}`
        if (path == file) continue
        try {
          let at = io.statSync(path).mtime?.getTime()
          if (at != null) entries.push({ name, at })
        } catch { /* Another miss swept it first. */ }
      }
      for (let name of idle(entries, Date.now())) {
        try {
          io.removeSync(`${dir}/${name}`)
        } catch { /* Another miss swept it first. */ }
      }
    } catch { /* Sweeping is optional. */ }
  }
  try {
    let known: Record<T> = JSON.parse(read(file) ?? 'null')
    if (
      known?.version == VERSION && 'value' in known &&
      JSON.stringify(known.roots) == JSON.stringify(identities) &&
      Array.isArray(known.files) && known.files.length > 0 &&
      Array.isArray(known.stats) && known.stats.length == known.files.length
    ) {
      let directories = new Map<string, string>()
      let stale = false
      let stats = known.files.map((path) => {
        let witness = known.absent?.[path]
        if (witness) {
          let [parent, before] = witness
          let now = directories.get(parent)
          if (now === undefined) directories.set(parent, now = stat(parent))
          if (now && now == before) return 'absent'
          stale = true
        }
        return stat(path)
      })
      if (stats.every((s, i) => s && s == known.stats[i])) {
        if (stale) {
          keep({ ...known, absent: absent(known.files, stats, known.absent) })
        }
        seen()
        return known.value
      }
      // A stat moved without saying whether its contents did (a checkout, a
      // touch): contents that still agree keep the memo, under the new stats.
      if (known.source == await snapshot(known.files)) {
        keep({
          ...known,
          stats,
          absent: absent(known.files, stats, known.absent),
        })
        return known.value
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.PermissionDenied) return await make()
    // A damaged memo is rebuilt.
  }

  // If a miss cannot be kept, source scanning buys nothing. Check the write
  // boundary before loading the parser or walking the dependency graph.
  let probe = `${file}.${crypto.randomUUID()}`
  let writable = false
  try {
    io.mkdirSync(dir, { recursive: true, mode: 0o700 })
    io.writeTextFileSync(probe, '', { mode: 0o600, createNew: true })
    writable = true
  } catch {
    /* Derivation needs no writable cache. */
  } finally {
    try {
      io.removeSync(probe)
    } catch { /* An unsuccessful write may have created nothing. */ }
  }
  if (!writable) return await make()

  let sources = new Map<string, string | null>()
  let stats = new Map<string, string>()
  type Imports = { [key: string]: string }
  type Manifest = {
    imports?: Imports
    scopes?: { [scope: string]: Imports }
    base: URL
  }
  let locks = new Map<string, { [specifier: string]: string }>()
  let scanned = new Set<string>()
  // Its stat before its contents: a write after the read moves the stat kept.
  // A file the stat found absent is absent, and is not asked again.
  let watch = (path: string) => {
    if (!sources.has(path)) {
      let at = stat(path)
      stats.set(path, at)
      sources.set(path, at == 'absent' ? null : read(path))
    }
    return sources.get(path)!
  }
  // A configuration file, with the lock and import map it names watched too.
  // A JSONC form this JSON reader cannot prove derives normally.
  let manifest = (text: string, base: URL): Manifest => {
    let doc = JSON.parse(text)
    if (doc.lock !== false) {
      let lock = new URL(
        typeof doc.lock == 'string' ? doc.lock : doc.lock?.path ?? 'deno.lock',
        base,
      )
      let path = pathOf(lock.href)
      if (!locks.has(path)) {
        let text = watch(path)
        if (text !== null) locks.set(path, JSON.parse(text).specifiers ?? {})
      }
    }
    if (!doc.importMap) return { ...doc, base }
    let map = new URL(doc.importMap, base)
    let held = watch(pathOf(map.href))
    if (held === null) throw new Error('absent import map')
    return { ...JSON.parse(held), base: map }
  }
  // The configurations over a directory, nearest first. Each directory's
  // files are watched once, however many modules a walk finds in it.
  let over = new Map<string, Manifest[]>()
  let governing = (dir: URL): Manifest[] => {
    let known = over.get(dir.href)
    if (known) return known
    let here = pathOf(dir.href)
    let found = FILES.flatMap((name) => {
      let text = watch(here + name)
      return text === null ? [] : [manifest(text, new URL(name, dir))]
    })
    let up = new URL('../', dir)
    let chain = up.href == dir.href ? found : [...found, ...governing(up)]
    over.set(dir.href, chain)
    return chain
  }
  let ancestry = (specifier: string): Manifest[] =>
    local(specifier) ? governing(new URL('.', specifier)) : []
  let relative = (specifier: string, from: string): string => {
    let address = (name: string, base: URL | string): string =>
      /^(?:\.?\.?\/|[a-z][\w+.-]*:)/i.test(name)
        ? new URL(name, base).href
        : name
    let asked = address(specifier, from)
    for (let doc of ancestry(from)) {
      let scopes = Object.keys(doc.scopes ?? {}).filter((s) =>
        from.startsWith(new URL(s, doc.base).href)
      ).sort((a, b) =>
        new URL(b, doc.base).href.length - new URL(a, doc.base).href.length
      )
      for (
        let map of [...scopes.map((s) => doc.scopes![s]), doc.imports ?? {}]
      ) {
        let key = Object.keys(map).filter((k) =>
          address(k, doc.base) == asked ||
          k.endsWith('/') && asked.startsWith(address(k, doc.base)) ||
          packaged(map[k]) && asked.startsWith(`${k}/`)
        ).sort((a, b) =>
          address(b, doc.base).length - address(a, doc.base).length
        )[0]
        if (!key) {
          continue
        }
        let mapped = map[key] + asked.slice(address(key, doc.base).length)
        return packaged(mapped) || immutable(mapped)
          ? mapped
          : mapped.startsWith('.') || mapped.startsWith('/')
          ? new URL(mapped, doc.base).href
          : resolve(mapped)
      }
    }
    return packaged(asked) || immutable(asked)
      ? asked
      : asked == specifier
      ? resolve(specifier)
      : asked
  }
  let visit = async (specifier: string): Promise<void> => {
    if (scanned.has(specifier)) return
    scanned.add(specifier)
    if (!local(specifier)) {
      if (
        !immutable(specifier) &&
        ![...locks.values()].some((lock) =>
          /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?(?:_[^\s]+)?$/.test(
            lock[packageKey(specifier)] ?? '',
          )
        )
      ) throw new Error('mutable module')
      return
    }
    ancestry(specifier)
    let path = pathOf(specifier)
    let text = watch(path)
    if (text === null || !/\.[cm]?[jt]sx?$/.test(specifier)) return
    let imports = opts.imports ??
      ((source: string, name?: string) =>
        importsOf(source, name, callbacks.get(specifier)))
    for (let dependency of await imports(text, specifier)) {
      await visit(relative(dependency, specifier))
    }
  }
  let proved = false
  try {
    packages.forEach(ancestry)
    starts.filter(local).forEach(ancestry)
    for (let source of starts) await visit(source)
    proved = sources.size > 0
  } catch { /* A source we cannot prove is derived normally. */ }
  let sourceHash: string | undefined
  try {
    if (proved) sourceHash = await fingerprint(sources)
  } catch { /* A failed digest still leaves ordinary derivation usable. */ }

  // Derivation errors always reach the caller, regardless of cache failures.
  let value = await make()
  if (sourceHash !== undefined) {
    try {
      // A source changed while derivation ran: the next call must derive too.
      let dependencies = [...sources.keys()]
      if (sourceHash == await snapshot(dependencies)) {
        keep({
          version: VERSION,
          roots: identities,
          files: dependencies,
          stats: dependencies.map((path) => stats.get(path)!),
          absent: absent(
            dependencies,
            dependencies.map((path) => stats.get(path)!),
          ),
          source: sourceHash,
          value,
        })
        sweep()
      }
    } catch { /* Persistence is optional. */ }
  }
  return value
}
