// A box catalog's source boundary: known Git checkouts and explicitly served
// URL origins. No frame chooses a directory, remote host, or revision command.

import { repositoryEid } from '@yaks/git/host'
import { repoPath, rootsOf, treeAt } from '@yaks/git/source'
import { checkout } from './sync.ts'
import { type Catalog, resolveFrames } from './frames.ts'

export type Location = { file: string; function?: string; line?: number }
export type Sources = { roots: string[]; origins?: string[] }
export type SourceOptions = { cwd: string; url: string; origins?: string[] }

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
    let response = await send(at, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw Error(`code catalog: ${response.status}`)
    let rows = await response.json()
    if (!Array.isArray(rows)) throw Error('code catalog: expected bundles')
    return rows
  },
})

export let sourceFrames = (
  options: SourceOptions,
  catalog: Catalog = catalogAt(options.url),
) =>
async <T extends Location>(
  frames: T[],
  commit: string,
): Promise<(T & { app: boolean; module?: string; symbol?: string })[]> => {
  let { root, common } = await checkout(options.cwd)
  let roots = [...new Set([root, ...await rootsOf(common)])]
  let paths = frames.map((f) =>
    sourcePath(f.file, {
      roots,
      origins: options.origins ?? [new URL(options.url).origin],
    })
  )
  let blobs = await treeAt(root, commit, paths.filter((p) => p != null))
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
