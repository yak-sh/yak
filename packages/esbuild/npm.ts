// npm packages as a compile installs them: one version of each name, flat,
// from the registry, as @cloudflare/worker-bundler's own installer did. That
// installer decoded every text file of every tarball into the file system a
// build reads: three.js ships 20 MB of sources and a page reads 2 MB of them.
// Each compile indexes a tarball in one pass. It keeps a bounded amount of
// its source bytes for random access, and decodes only files the build reads.
import { Gunzip } from 'fflate'
import { maxSatisfying, valid } from 'semver'
import { REGISTRY, sha256, type Tarball } from './home.ts'
import { rooted, untar } from './tar.ts'

export { REGISTRY }

// How long the registry has to answer, in ms.
let WAIT = 30_000

// The files of a package a build can read: its text, as worker-bundler kept
// it. A build reads nothing else (an image or a binary is never compiled in);
// a page fetches those from the package's home (./home.ts).
let TEXT = /\.(?:[cm]?[jt]sx?|json|md|txt|css|html|ya?ml|toml|xml|svg|map|py)$/i
let NAMED =
  /^(?:license|readme|changelog|package\.json|tsconfig\.json|\.npmignore|\.gitignore)/i
let text = (path: string) =>
  TEXT.test(path) || NAMED.test(path.slice(path.lastIndexOf('/') + 1))

let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// How much tarball to inflate at a time.
let STEP = 1 << 16

/**
 * Walk a gzipped tarball's entries in order, inflating a slice at a time and
 * never the whole: `each` and `take` are ./tar.ts `untar`'s.
 */
let walk = (
  tgz: Uint8Array,
  each: (path: string, size: number, file: boolean) => boolean,
  take: (path: string, bytes: Uint8Array) => boolean | void,
) => {
  let push = untar(each, take)
  let stop = false
  let inflate = new Gunzip((chunk) => void (stop ||= push(chunk)))
  for (let i = 0; i < tgz.length && !stop; i += STEP) {
    inflate.push(tgz.subarray(i, i + STEP), i + STEP >= tgz.length)
  }
}

/** An installed package: its tarball, where that came from, and the text
 * files it holds, by path from the package's own directory. */
type Packed = {
  tgz: Uint8Array
  from?: Tarball
  root: string
  holds: Set<string>
  decoded: Map<string, string>
  key?: string
}

// Only registry tarball content is shared across compiles. A Files keeps its
// own path overrides and a copy of the index, so writes/deletes never change
// another compile. Retain compressed bytes and only text actually read.
let held = new Map<string, Packed>()
let bytes = 0
let LIMIT = 16 << 20
let size = (pack: Packed) =>
  pack.tgz.byteLength +
  [...pack.holds].reduce((n, path) => n + path.length * 2, 0) +
  [...pack.decoded].reduce(
    (n, [path, text]) => n + (path.length + text.length) * 2,
    0,
  )
let sizes = new Map<string, number>()
let keep = (pack: Packed) => {
  let key = pack.key
  if (!key) return
  bytes -= sizes.get(key) ?? 0
  held.delete(key)
  sizes.delete(key)
  let n = size(pack)
  if (n > LIMIT) return
  while (bytes + n > LIMIT) {
    let oldest = held.keys().next().value!
    bytes -= sizes.get(oldest)!
    held.delete(oldest)
    sizes.delete(oldest)
  }
  held.set(key, pack)
  sizes.set(key, n)
  bytes += n
}

let PACKAGE = /^node_modules\/(?:@[^/]+\/)?[^/]+\//
let SOURCES = /\.(?:[cm]?[jt]sx?|json|css)$/i
let SOURCE_LIMIT = 32 << 20

/**
 * A compile's files: the ones it was handed, and each installed package's,
 * which come out of its tarball the first time a build reads one. It is the
 * file system ./bundle.ts builds from.
 */
export class Files {
  #files: Map<string, string>
  #packages = new Map<string, Packed & { sources?: Map<string, Uint8Array> }>()
  #sourceBytes = 0

  constructor(files: Record<string, string> = {}) {
    this.#files = new Map(Object.entries(files))
  }

  read(path: string): string | null {
    let own = this.#files.get(path)
    if (own != null) return own
    let dir = PACKAGE.exec(path)?.[0] ?? ''
    let pack = this.#packages.get(dir)
    let rest = path.slice(dir.length)
    if (!pack?.holds.has(rest)) return null
    let decoded = pack.decoded.get(rest)
    if (decoded != null) {
      this.#files.set(path, decoded)
      // Touch the immutable cached index, not the local deletion copy.
      let cached = pack.key ? held.get(pack.key) : undefined
      if (cached) keep(cached)
      return decoded
    }
    if (SOURCES.test(rest)) pack.sources ??= this.#sources(pack)
    let source = pack.sources?.get(pack.root + rest)
    let out = source ? decode(source) : this.#extract(pack, rest)
    if (out != null) {
      this.#files.set(path, out)
      pack.decoded.set(rest, out)
      let cached = pack.key ? held.get(pack.key) : undefined
      if (cached) keep(cached)
    }
    return out
  }

  #extract(pack: Packed, rest: string) {
    let out: string | null = null
    walk(
      pack.tgz,
      (at, _, file) => file && at == pack.root + rest,
      (_, bytes) => {
        out = decode(bytes)
        return true
      },
    )
    return out
  }

  #retain(path: string, size: number) {
    if (!SOURCES.test(path) || this.#sourceBytes + size > SOURCE_LIMIT) {
      return false
    }
    this.#sourceBytes += size
    return true
  }

  #sources(pack: Packed) {
    let sources = new Map<string, Uint8Array>()
    if (this.#sourceBytes >= SOURCE_LIMIT) return sources
    walk(
      pack.tgz,
      (path, size, file) =>
        file && !sources.has(path) &&
        pack.holds.has(path.slice(pack.root.length)) &&
        !pack.decoded.has(path.slice(pack.root.length)) &&
        this.#retain(path, size),
      (path, bytes) => void sources.set(path, bytes),
    )
    return sources
  }

  /** The registry tarball an installed package came out of, when it came
   * out of one. */
  tarball(name: string): Tarball | undefined {
    return this.#packages.get(`node_modules/${name}/`)?.from
  }

  write(path: string, content: string) {
    this.#files.set(path, content)
  }

  delete(path: string) {
    this.#files.delete(path)
    let dir = PACKAGE.exec(path)?.[0] ?? ''
    this.#packages.get(dir)?.holds.delete(path.slice(dir.length))
  }

  list(prefix = ''): string[] {
    let paths = new Set(this.#files.keys())
    for (let [dir, pack] of this.#packages) {
      for (let path of pack.holds) paths.add(dir + path)
    }
    return [...paths].filter((path) => path.startsWith(prefix))
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }

  /** Install a package from its gzipped tarball, as `node_modules/<name>/`,
   * reading only its package.json now, and `from` where it came from. */
  hold(name: string, tgz: Uint8Array, from?: Tarball) {
    let dir = `node_modules/${name}/`
    // A replacement also replaces any text already read from that package.
    for (let path of this.#files.keys()) {
      if (path.startsWith(dir)) this.#files.delete(path)
    }
    let cached = from ? held.get(from.sha256) : undefined
    if (cached) {
      keep(cached)
      this.#packages.set(dir, { ...cached, from, holds: new Set(cached.holds) })
      let manifest = cached.decoded.get('package.json')
      if (manifest != null) this.#files.set(dir + 'package.json', manifest)
      return
    }
    let files: string[] = []
    let holds: string[] = []
    let manifests: Record<string, string> = {}
    let sources = new Map<string, Uint8Array>()
    walk(tgz, (path, size, file) => {
      if (!file || !path) return false
      files.push(path)
      if (size && text(path)) holds.push(path)
      return !!size && (manifest(path) ||
        !sources.has(path) && this.#retain(path, size))
    }, (path, bytes) => {
      if (manifest(path)) manifests[path] = decode(bytes)
      else sources.set(path, bytes)
    })
    let root = rooted(files)
    let own = manifests[root + 'package.json']
    if (own != null) this.#files.set(dir + 'package.json', own)
    let pack: Packed = {
      tgz,
      from,
      root,
      holds: new Set(holds.map((path) => path.slice(root.length))),
      decoded: new Map(
        Object.entries(manifests).map((
          [path, text],
        ) => [path.slice(root.length), text]),
      ),
      key: from?.sha256,
    }
    keep(pack)
    this.#packages.set(dir, { ...pack, sources, holds: new Set(pack.holds) })
  }
}

let manifest = (path: string) => /^(?:[^/]+\/)?package\.json$/.test(path)

type Version = {
  dependencies?: Record<string, string>
  dist?: { tarball?: string }
}
type Metadata = {
  'dist-tags': Record<string, string>
  versions: Record<string, Version>
}

type Release = { from: Tarball; dependencies: Record<string, string> }

// Exact releases share the bounded tarball cache. Tags and ranges still ask
// the registry which version they mean. Fetch implementations have separate
// indexes so an injected registry cannot choose another registry's bytes.
let releases = new WeakMap<typeof fetch, Map<string, Release>>()
let exact = (get: typeof fetch) => {
  let index = releases.get(get)
  if (!index) releases.set(get, index = new Map())
  return index
}

let remember = (index: Map<string, Release>, key: string, release: Release) => {
  index.delete(key)
  index.set(key, release)
  if (index.size > 256) index.delete(index.keys().next().value!)
}

// The version a range asks for, as npm reads it: a tag, an exact version or
// the newest the range allows.
let resolve = (range: string, meta: Metadata) =>
  range == 'latest' || range == '*'
    ? meta['dist-tags'].latest
    : range in meta.versions
    ? range
    : meta['dist-tags'][range] ??
      maxSatisfying(Object.keys(meta.versions), range) ?? undefined

/**
 * Install what `want` names, package name to version range, and what each
 * needs, one version of each name beside the others. A package `fs` already
 * holds (its package.json reads) is kept as it is. Answers what was installed,
 * as `name@version`, and a line for each package that could not be.
 */
export let install = async (
  fs: Files,
  want: Record<string, string>,
  get: typeof fetch = fetch,
  registry = REGISTRY,
  report?: (ms: number) => void,
) => {
  let installed: string[] = []
  let warnings: string[] = []
  let done = new Set<string>()
  let pending = new Map<string, Promise<void>>()
  let index = exact(get)
  let fetching = 0, began = 0
  let fetched = async <T>(
    url: string,
    read: (response: Response) => Promise<T>,
    init: RequestInit = {},
  ) => {
    if (report && !fetching++) began = performance.now()
    try {
      return await read(
        await get(url, { ...init, signal: AbortSignal.timeout(WAIT) }),
      )
    } catch (e) {
      if ((e as Error).name != 'TimeoutError') throw e
      throw new Error(
        `the registry did not answer ${url} within ${WAIT / 1000}s`,
      )
    } finally {
      if (report && !--fetching) report(performance.now() - began)
    }
  }
  let load = async (url: string, name: string, range: string) => {
    let pin = valid(range)
    let was = pin ? index.get(`${url}/${pin}`) : undefined
    let packed = was && held.get(was.from.sha256)
    if (was && packed) {
      fs.hold(name, packed.tgz, was.from)
      remember(index, `${url}/${pin}`, was)
      return { version: pin!, dependencies: was.dependencies }
    }
    let meta = await fetched(url, async (r) => {
      if (r.ok) return await r.json() as Metadata
      await r.body?.cancel()
      throw new Error(
        `the registry answered ${r.status} for "${name}"` +
          (r.status == 404
            ? ' (no such package: check its name in package.json)'
            : ''),
      )
    }, {
      headers: {
        accept:
          'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8',
      },
    })
    let version = resolve(range, meta)
    let release = version ? meta.versions[version] : undefined
    if (!version || !release) return
    let tarball = release.dist?.tarball
    if (!tarball) throw new Error(`${name}@${version} names no tarball`)
    let key = `${url}/${version}`
    let known = index.get(key)
    let ready = known?.from.url == tarball && held.get(known.from.sha256)
    let from: Tarball
    if (ready && known) {
      fs.hold(name, ready.tgz, known.from)
      from = known.from
    } else {
      let tgz = await fetched(tarball, async (r) => {
        if (r.ok) return new Uint8Array(await r.arrayBuffer())
        await r.body?.cancel()
        throw new Error(`its tarball answered ${r.status} (${tarball})`)
      })
      from = { url: tarball, sha256: await sha256(tgz) }
      fs.hold(name, tgz, from)
    }
    let dependencies = release.dependencies ?? {}
    remember(index, key, { from, dependencies })
    return { version, dependencies }
  }
  let one = (name: string, range: string): Promise<void> | void => {
    if (done.has(name)) return
    if (fs.read(`node_modules/${name}/package.json`) != null) {
      done.add(name)
      return
    }
    let running = pending.get(name)
    if (running) return running
    let work = (async () => {
      try {
        let url = `${registry}/${
          name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : name
        }`
        let release = await load(url, name, range)
        if (!release) {
          warnings.push(`no version of ${name} satisfies ${range}`)
          return
        }
        done.add(name)
        installed.push(`${name}@${release.version}`)
        await Promise.all(
          Object.entries(release.dependencies ?? {}).map(([dep, r]) =>
            one(dep, r)
          ),
        )
      } catch (e) {
        warnings.push(`could not install ${name}: ${(e as Error).message}`)
      }
    })()
    pending.set(name, work)
    return work.finally(() => pending.delete(name))
  }
  await Promise.all(
    Object.entries(want).map(([name, range]) => one(name, range)),
  )
  return { installed, warnings }
}
