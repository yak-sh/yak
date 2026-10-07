// A box catalog's source boundary: known Git checkouts and explicitly served
// URL origins. No frame chooses a directory, remote host, or revision command.

import { repositoryEid } from '@yaks/git/host'
import { repoPath, rootsOf, trees } from '@yaks/git/source'
import { checkout } from './sync.ts'
import type { Bundle } from '@yaks/graph'
import { type Catalog, resolveFrames } from './frames.ts'

export type Location = { file: string; function?: string; line?: number }
export type Sources = { roots: string[]; origins?: string[] }
export type SourceOptions = { cwd: string; url: string; origins?: string[] }
/** Frames thrown at a commit, each told whether it is the application's and,
 * where the catalog matches that commit, its module and symbol. */
export type Resolver = <T extends Location>(
  frames: T[],
  commit: string,
) => Promise<(T & { app: boolean; module?: string; symbol?: string })[]>

// deno-lint-ignore no-control-regex
let unsafe = /[\\\x00-\x1f\x7f]/

export let sourcePath = (
  file: string,
  sources: Sources,
): string | undefined => {
  if (file.length > 4096 || unsafe.test(file)) return
  let path: string
  try {
    let raw = decodeURIComponent(file.split(/[?#]/)[0])
    if (raw.split('/').some((part) => part == '..' || part == '.')) return
    if (file.startsWith('file:') || file.startsWith('/')) {
      let url = new URL(file.startsWith('/') ? `file://${file}` : file)
      if (url.protocol != 'file:' || url.host) return
      let absolute = decodeURIComponent(url.pathname)
      let root = [...sources.roots].sort((a, b) => b.length - a.length)
        .find((r) => absolute.startsWith(r + '/'))
      if (!root) return
      path = absolute.slice(root.length + 1)
    } else {
      let url = new URL(file)
      if (
        !['http:', 'https:'].includes(url.protocol) || url.username ||
        url.password || !sources.origins?.includes(url.origin)
      ) return
      path = decodeURIComponent(url.pathname.slice(1))
    }
  } catch {
    return
  }
  return repoPath(path) ? path : undefined
}

/** Read only requested global identities from the fleet's existing HTTP door. */
export let catalogAt = (url: string, send: typeof fetch = fetch): Catalog => ({
  get: async (ids) => {
    if (!ids.length) return []
    let at = new URL('/query', url)
    at.searchParams.set(
      'q',
      `.entity.eid=${ids.join(',')} ?file ?module ?symbol`,
    )
    let response: Response
    try {
      response = await send(at, { signal: AbortSignal.timeout(5000) })
    } catch (error) {
      // Transport unavailability is the pool waiting on the catalog, not a
      // defect to report on every attempt. The final failure is still reported.
      if (error instanceof Error) throw Object.assign(error, { retry: {} })
      throw error
    }
    if (!response.ok) {
      let error = Error(`code catalog: ${response.status}`)
      throw response.status >= 500 || [408, 429].includes(response.status)
        ? Object.assign(error, { retry: {} })
        : error
    }
    let rows = await response.json()
    if (!Array.isArray(rows)) throw Error('code catalog: expected bundles')
    return rows
  },
})

// A value read once and kept, read again only when asked `again` at least `ms`
// after the last read. A failed read is not kept.
let kept = <T>(read: () => Promise<T>, ms = Infinity) => {
  let got: Promise<T> | undefined
  let at = 0
  return (again = false): Promise<T> => {
    if (!got || (again && Date.now() - at >= ms)) {
      at = Date.now()
      got = read().catch((error) => {
        got = undefined
        throw error
      })
    }
    return got
  }
}

/** How often a frame under no known checkout reads the worktrees again (ms). */
export let ROOTS = 5_000

/** A catalog whose answers are kept for `ms`: frames thrown at one commit ask
 * after the same files and exports again and again, and the catalog changes
 * only as the code syncs. Callers asking at once share one request; a failed
 * request is not kept.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { remembered } from '@yaks/code/source'
 *
 * let asked: string[][] = []
 * let catalog = remembered({
 *   get: (ids) => (asked.push(ids), Promise.resolve([{ entity: { eid: 'f' } }])),
 * })
 * await Promise.all([catalog.get(['f', 'g']), catalog.get(['f'])])
 * equal(asked, [['f', 'g']])
 * ```
 */
export let remembered = (catalog: Catalog, ms = 60_000): Catalog => {
  let known = new Map<
    string,
    { at: number; row: Promise<Bundle | undefined> }
  >()
  return {
    get: async (ids) => {
      let now = Date.now()
      let fresh = (id: string) => now - (known.get(id)?.at ?? -Infinity) < ms
      if (known.size > 10_000) {
        for (let id of known.keys()) if (!fresh(id)) known.delete(id)
      }
      let missing = [...new Set(ids)].filter((id) => !fresh(id))
      if (missing.length) {
        let asked = catalog.get(missing).then((rows) =>
          new Map(rows.map((row) => [row.entity.eid, row]))
        )
        for (let id of missing) {
          let row: Promise<Bundle | undefined> = asked.then(
            (rows) => rows.get(id),
            (error) => {
              if (known.get(id)?.row == row) known.delete(id)
              throw error
            },
          )
          known.set(id, { at: now, row })
        }
      }
      let rows = await Promise.all(ids.map((id) => known.get(id)!.row))
      return rows.filter((row) => row != null)
    },
  }
}

/** A resolver for frames thrown at a commit. What it reads Git for is kept for
 * the life of the resolver, so a run costs no process: the checkout and its
 * repository never move, and a commit's tree never changes. Linked worktrees
 * come and go, so a file frame under none of the roots known reads them again,
 * at most once every {@link ROOTS} ms. The catalog it asks by default is
 * {@link remembered}. */
export let sourceFrames = (
  options: SourceOptions,
  catalog: Catalog = remembered(catalogAt(options.url)),
): Resolver => {
  let repo = kept(async () => {
    let { root, common } = await checkout(options.cwd)
    return { root, common, tree: trees(root) }
  })
  let roots = kept(async () => {
    let { root, common } = await repo()
    return [...new Set([root, ...await rootsOf(common)])]
  }, ROOTS)
  let origins = options.origins ?? [new URL(options.url).origin]
  let local = (file: string) => file.startsWith('file:') || file[0] == '/'
  return async (frames, commit) => {
    let { common, tree } = await repo()
    let under = (roots: string[]) =>
      frames.map((f) => sourcePath(f.file, { roots, origins }))
    let paths = under(await roots())
    if (paths.some((path, i) => path == null && local(frames[i].file))) {
      paths = under(await roots(true))
    }
    let blobs = await tree(commit, paths.filter((p) => p != null))
    let places = paths.map((path, i) => ({
      path: path ?? '',
      function: frames[i].function,
      line: frames[i].line,
    }))
    let resolved = await resolveFrames(
      catalog,
      repositoryEid(common),
      blobs,
      places,
    )
    return frames.map((f, i) => ({ ...f, ...resolved[i] }))
  }
}
