import { mimeOf } from '@yaks/blob'
import { parse } from 'es-module-lexer/js'
import { cssUrls } from './asset-url.ts'
import {
  decoded,
  inside,
  rootOf,
  script,
  type Serving,
  WORKER,
} from './files.ts'
import { BUILT, type Files } from './versions.ts'

/** The bytes a browser receives at a served path, and the original file
 * bytes a private app's worker can authorize at that path. */
export type Asset = {
  sha: string
  original: string
  type: string
  public?: true
  /** Local paths consulted when rewriting a stylesheet or module. */
  links?: string[]
}
export type Assets = Record<string, Asset>

export let encoded = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/')

/** Where a release keeps the platform's compiled packages: the toolkit's
 * files (`__packages/@yaks/ui/Button.css`) and npm packages' modules. They
 * are the same public code in every app, so anyone may load them, whatever
 * the app's access, and no app's worker is asked first. */
export let PACKAGES = BUILT + '__packages/'

let scripts = /^(?:text|application)\/javascript\b/
export let moduleAsset = (asset: Asset) => scripts.test(asset.type)

// The serving folder and compiled output use the same paths as the files
// door. The configured worker and the platform's private files stay inside.
let browserFiles = (files: Files, config: Serving) => {
  let root = rootOf('', config).slice(1)
  let folder = root ? root + '/' : ''
  let keys = new Map<string, Asset>()
  for (let [key, sha] of Object.entries(files)) {
    let resource = key.startsWith(PACKAGES)
    let path = resource ? key.slice(BUILT.length) : key.slice(folder.length)
    // At a package's path the compiler's file is served, never the app's.
    let shadowed = !resource && (BUILT + path).startsWith(PACKAGES) &&
      Object.hasOwn(files, BUILT + path)
    if (
      !resource && (!key.startsWith(folder) || key.startsWith(BUILT)) ||
      shadowed || key == (config.main ?? WORKER) || inside('/' + path) ||
      path.startsWith('api/') || decoded('/' + encoded(path)) == null
    ) continue
    let built = !resource && script.test(path) && files[BUILT + key]
    let type = mimeOf(built ? 'compiled.js' : path)
    if (type.startsWith('text/html')) continue
    let original = built || sha
    let open = config.assets?.public?.some((entry) =>
      entry.endsWith('/') ? path.startsWith(entry) : path == entry
    )
    keys.set(path, {
      sha: original,
      original,
      type,
      ...open ? { public: true } : {},
    })
  }
  return keys
}

// References in a fingerprinted file work at any mount, including a
// sandbox's token. Climb to the common assets directory to name a sibling.
let up = (path: string) => '../'.repeat(path.split('/').length)
let origin = 'https://app.invalid'

let local = (ref: string, path: string) => {
  if (!ref || /^(?:#|\/\/|[a-z][a-z0-9+.-]*:)/i.test(ref)) return null
  let url = URL.parse(ref, origin + '/' + encoded(path))
  if (!url || url.origin != origin) return null
  let name = decoded(url.pathname)?.slice(1)
  return name == null ? null : { name, url }
}

type Link = { from: number; to: number; ref: string; literal: boolean }
let links = (code: string): Link[] | null => {
  let imports
  try {
    imports = parse(code)[0]
  } catch {
    return null
  }
  // Runtime URL resolution uses the release's original directory tree.
  if (imports.some(({ d, n }) => d == -2 || d >= 0 && n == null)) return null
  return imports.flatMap(({ s, e, n, d }) =>
    n && /^\.{0,2}\//.test(n)
      ? [{ from: s, to: e, ref: n, literal: d >= 0 }]
      : []
  )
}

let scriptUrls = (code: string, refs: Link[], move: (ref: string) => string) =>
  refs.reduceRight((body, { from, to, ref, literal }) => {
    let next = move(ref)
    if (next == ref) return body
    let quoted = JSON.stringify(next)
    let specifier = quoted.slice(1, -1)
    if (code[from - 1] == "'") specifier = specifier.replaceAll("'", "\\'")
    return body.slice(0, from) + (literal ? quoted : specifier) +
      body.slice(to)
  }, code)

/** Name the browser's files bottom-up. Only CSS and JS need to be read.
 * Cycles and scripts that resolve paths at runtime keep the release tree. */
// How many reads go ahead of the walk: as many as a Worker keeps open at once.
let AHEAD = 6

export let fingerprints = async (
  files: Files,
  config: Serving,
  read: (sha: string) => Promise<string | null>,
  write: (text: string) => Promise<string>,
  previous: Assets = {},
): Promise<Assets> => {
  let candidates = browserFiles(files, config)
  let rewritten = (file: Asset) =>
    file.type.startsWith('text/css') || moduleAsset(file)
  let unchanged = (path: string, file: Asset) => {
    let prior = Object.hasOwn(previous, path) ? previous[path] : undefined
    return prior?.original == file.original && prior.type == file.type
      ? prior
      : undefined
  }
  // Each stylesheet and module is read for what it links, in the order the
  // walk below asks for them, a few ahead of it: read one after another,
  // each was a trip to the bucket in turn on every release (T-3600).
  let order = [
    ...new Set(
      [...candidates].filter(([path, file]) =>
        rewritten(file) && !unchanged(path, file)?.links
      ).map(([, file]) => file.sha),
    ),
  ]
  let ahead = new Map<string, Promise<string | null>>()
  let taken = new Set<string>()
  let next = 0
  let fill = () => {
    for (; next < order.length && ahead.size < AHEAD; next++) {
      let sha = order[next]
      if (taken.has(sha)) continue
      let reading = read(sha)
      reading.catch(() => {})
      ahead.set(sha, reading)
    }
  }
  let sourceOf = (sha: string) => {
    let held = ahead.get(sha)
    ahead.delete(sha)
    taken.add(sha)
    fill()
    return held ?? read(sha)
  }
  fill()
  let settled = new Map<string, Asset | null>()
  let pending = new Set<string>()
  let follow = async (path: string): Promise<Asset | null> => {
    if (settled.has(path)) return settled.get(path)!
    let file = candidates.get(path)!
    if (pending.has(path)) return null
    pending.add(path)
    let result = await fingerprint(file, path, follow)
    pending.delete(path)
    settled.set(path, result)
    return result
  }
  let fingerprint = async (
    file: Asset,
    path: string,
    follow: (path: string) => Promise<Asset | null>,
  ): Promise<Asset | null> => {
    let css = file.type.startsWith('text/css')
    if (!rewritten(file)) return file
    let prior = unchanged(path, file)
    let linksStillMatch = async (paths: string[]) => {
      for (let name of paths) {
        let before = Object.hasOwn(previous, name) ? previous[name] : undefined
        if (!candidates.has(name)) {
          if (before) return false
        } else {
          let after = await follow(name)
          if (!after || after.sha != before?.sha) return false
        }
      }
      return true
    }
    if (prior?.links && await linksStillMatch(prior.links)) {
      return { ...file, sha: prior.sha, links: prior.links }
    }
    let source = await sourceOf(file.sha)
    if (source == null) return null
    let refs = css ? [] : links(source)
    if (refs == null) return null
    let rewrite = (move: (ref: string) => string) =>
      css ? cssUrls(source, move) : scriptUrls(source, refs, move)
    let found = new Map<string, ReturnType<typeof local>>()
    rewrite((ref) => {
      found.set(ref, local(ref, path))
      return ref
    })
    let moved = new Map<string, string>()
    let depends = new Set<string>()
    for (let [ref, match] of found) {
      if (!match) continue
      let { name, url } = match
      depends.add(name)
      let tail = url.search + url.hash
      if (candidates.has(name)) {
        let dep = await follow(name)
        if (!dep) return null
        moved.set(ref, up(path) + dep.sha + url.pathname + tail)
      } else if (!ref.startsWith('/')) {
        moved.set(ref, up(path) + '../..' + url.pathname + tail)
      }
    }
    let text = rewrite((ref) => moved.get(ref) ?? ref)
    return {
      ...file,
      sha: text == source ? file.sha : await write(text),
      links: [...depends],
    }
  }
  for (let path of candidates.keys()) await follow(path)
  return Object.fromEntries(
    [...settled].flatMap(([path, asset]) => asset ? [[path, asset]] : []),
  )
}
