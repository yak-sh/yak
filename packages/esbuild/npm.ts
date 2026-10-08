// npm packages as a compile installs them: one version of each name, flat,
// from the registry, as @cloudflare/worker-bundler's own installer did. That
// installer decoded every text file of every tarball into the file system a
// build reads: three.js ships 20 MB of sources and a page reads 2 MB of them.
// Here a package stays in its gzipped tarball, and a file comes out of it the
// first time a build reads it, so a compile holds what its builds read.
import { Gunzip } from 'fflate'
import { maxSatisfying } from 'semver'

/** Where packages come from. */
export let REGISTRY = 'https://registry.npmjs.org'

// How long the registry has to answer, in ms.
let WAIT = 30_000

// The files of a package kept for a build: its text, as worker-bundler kept
// it. A build reads nothing else (an image or a binary is never compiled in).
let TEXT = /\.(?:[cm]?[jt]sx?|json|md|txt|css|html|ya?ml|toml|xml|svg|map|py)$/i
let NAMED =
  /^(?:license|readme|changelog|package\.json|tsconfig\.json|\.npmignore|\.gitignore)/i
let text = (path: string) =>
  TEXT.test(path) || NAMED.test(path.slice(path.lastIndexOf('/') + 1))

let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// A NUL-terminated field of a tar header.
let field = (head: Uint8Array, at: number, length: number) => {
  let bytes = head.subarray(at, at + length)
  let end = bytes.indexOf(0)
  return decode(end < 0 ? bytes : bytes.subarray(0, end))
}

// An entry's path: a ustar header's prefix joined to its name.
let named = (head: Uint8Array) => {
  let name = field(head, 0, 100)
  let ustar = field(head, 257, 6) == 'ustar' && field(head, 263, 2) == '00'
  let prefix = ustar ? field(head, 345, 155) : ''
  return (prefix ? `${prefix}/${name}` : name).replace(/^(?:\.\/)+/, '')
}

// How much tarball to inflate at a time.
let STEP = 1 << 16

/**
 * Walk a gzipped tarball's entries in order, inflating a slice at a time and
 * never the whole: `each` sees an entry's path, size and whether it is a
 * regular file, and answers true to be handed its bytes; `take` gets them, and
 * ends the walk by answering true.
 */
let walk = (
  tgz: Uint8Array,
  each: (path: string, size: number, file: boolean) => boolean,
  take: (path: string, bytes: Uint8Array) => boolean | void,
) => {
  let head = new Uint8Array(512)
  let filled = 0, left = 0, pad = 0, at = 0, stop = false
  let path = '', body: Uint8Array | null = null
  let done = () => {
    if (body) stop = !!take(path, body)
    body = null
  }
  let inflate = new Gunzip((chunk) => {
    let i = 0
    while (i < chunk.length && !stop) {
      let n
      if (left) {
        n = Math.min(left, chunk.length - i)
        body?.set(chunk.subarray(i, i + n), at)
        at += n
        left -= n
        if (!left) done()
      } else if (pad) {
        n = Math.min(pad, chunk.length - i)
        pad -= n
      } else {
        n = Math.min(512 - filled, chunk.length - i)
        head.set(chunk.subarray(i, i + n), filled)
        filled += n
        if (filled == 512) {
          filled = 0
          if (head.every((b) => b == 0)) stop = true
          else {
            path = named(head)
            let size = parseInt(field(head, 124, 12).trim(), 8) || 0
            let wants = each(path, size, head[156] == 48 || head[156] == 0)
            body = wants ? new Uint8Array(size) : null
            left = size
            pad = (512 - size % 512) % 512
            at = 0
            if (!size) done()
          }
        }
      }
      i += n
    }
  })
  for (let i = 0; i < tgz.length && !stop; i += STEP) {
    inflate.push(tgz.subarray(i, i + STEP), i + STEP >= tgz.length)
  }
}

// The directory every file of a tarball sits in (npm's `package/`), which
// installing strips, or '' when they share none.
let rooted = (paths: string[]) => {
  let root: string | undefined
  for (let path of paths) {
    let slash = path.indexOf('/')
    if (
      slash <= 0 ||
      (root ??= path.slice(0, slash + 1)) != path.slice(0, slash + 1)
    ) {
      return ''
    }
  }
  return root ?? ''
}

/** An installed package: its tarball, and the text files it holds, by path
 * from the package's own directory. */
type Packed = { tgz: Uint8Array; root: string; holds: Set<string> }

let PACKAGE = /^node_modules\/(?:@[^/]+\/)?[^/]+\//

/**
 * A compile's files: the ones it was handed, and each installed package's,
 * which come out of its tarball the first time a build reads one. It is the
 * file system ./bundle.ts builds from.
 */
export class Files {
  #files: Map<string, string>
  #packages = new Map<string, Packed>()

  constructor(files: Record<string, string> = {}) {
    this.#files = new Map(Object.entries(files))
  }

  read(path: string): string | null {
    let held = this.#files.get(path)
    if (held != null) return held
    let dir = PACKAGE.exec(path)?.[0] ?? ''
    let pack = this.#packages.get(dir)
    let rest = path.slice(dir.length)
    if (!pack?.holds.has(rest)) return null
    let out: string | null = null
    walk(
      pack.tgz,
      (at, _, file) => file && at == pack.root + rest,
      (_, bytes) => {
        out = decode(bytes)
        return true
      },
    )
    if (out != null) this.#files.set(path, out)
    return out
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
   * reading only its package.json now. */
  hold(name: string, tgz: Uint8Array) {
    let files: string[] = []
    let holds: string[] = []
    let manifests: Record<string, string> = {}
    walk(tgz, (path, size, file) => {
      if (!file || !path) return false
      files.push(path)
      if (size && text(path)) holds.push(path)
      return !!size && /^(?:[^/]+\/)?package\.json$/.test(path)
    }, (path, bytes) => void (manifests[path] = decode(bytes)))
    let root = rooted(files)
    let dir = `node_modules/${name}/`
    let manifest = manifests[root + 'package.json']
    if (manifest != null) this.#files.set(dir + 'package.json', manifest)
    this.#packages.set(dir, {
      tgz,
      root,
      holds: new Set(holds.map((path) => path.slice(root.length))),
    })
  }
}

type Version = {
  dependencies?: Record<string, string>
  dist?: { tarball?: string }
}
type Metadata = {
  'dist-tags': Record<string, string>
  versions: Record<string, Version>
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
) => {
  let installed: string[] = []
  let warnings: string[] = []
  let done = new Set<string>()
  let pending = new Map<string, Promise<void>>()
  let fetched = async (url: string, init: RequestInit = {}) => {
    try {
      return await get(url, { ...init, signal: AbortSignal.timeout(WAIT) })
    } catch (e) {
      if ((e as Error).name != 'TimeoutError') throw e
      throw new Error(
        `the registry did not answer ${url} within ${WAIT / 1000}s`,
      )
    }
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
        let r = await fetched(url, {
          headers: {
            accept:
              'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8',
          },
        })
        if (!r.ok) {
          throw new Error(
            `the registry answered ${r.status} for "${name}"` +
              (r.status == 404
                ? ' (no such package: check its name in package.json)'
                : ''),
          )
        }
        let meta: Metadata = await r.json()
        let version = resolve(range, meta)
        let release = version ? meta.versions[version] : undefined
        if (!version || !release) {
          warnings.push(`no version of ${name} satisfies ${range}`)
          return
        }
        done.add(name)
        installed.push(`${name}@${version}`)
        let tarball = release.dist?.tarball
        if (!tarball) throw new Error(`${name}@${version} names no tarball`)
        let t = await fetched(tarball)
        if (!t.ok) {
          throw new Error(`its tarball answered ${t.status} (${tarball})`)
        }
        fs.hold(name, new Uint8Array(await t.arrayBuffer()))
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
