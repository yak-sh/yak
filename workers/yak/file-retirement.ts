// Files outlive their last referrer by the store's point-in-time window.
import type { Bundle } from '@yaks/graph'
import { mint } from '@yaks/graph/identity'
import { addressed } from '@yaks/platform/versions'
import { type Line, line } from '@yaks/query'
import { waiting } from './blob-key.ts'
import type { Directory } from './directory.ts'
import type { Objects } from '@yaks/blob'
import { pruned } from './written.ts'
import type { Attempt } from '@yaks/effects'

type Retirement = Bundle & {
  file_retirement: { keys: string[]; at: string }
}
type Ledger = {
  read: (query: Line) => Bundle[] | Promise<Bundle[]>
  apply: (
    bundles: Bundle[],
    options?: { trusted?: boolean },
  ) => unknown
}
let pending = async (graph: Ledger) =>
  await graph.read(line`.file_retirement`) as Retirement[]

/** Record only newly orphaned keys; another sweep never moves their clock. */
export let retiring = async (
  graph: Ledger,
  keys: string[],
  now = Date.now(),
) => {
  let held = new Set(
    (await pending(graph)).flatMap((r) => r.file_retirement.keys),
  )
  let fresh = keys.filter((key) => !held.has(key))
  for (let n = 0; n < fresh.length; n += 200) {
    await graph.apply([{
      entity: { eid: mint() },
      file_retirement: {
        keys: fresh.slice(n, n + 200),
        at: new Date(now).toISOString(),
      },
    }], { trusted: true })
  }
}

/** A new or departing referrer cancels the old clock for exactly its keys.
 * The next sweep starts their full window again if they are now orphaned. */
export let reclaimed = async (graph: Ledger, keys: string[]) => {
  let named = new Set(keys)
  for (let row of await pending(graph)) {
    let keep = row.file_retirement.keys.filter((key) => !named.has(key))
    if (keep.length == row.file_retirement.keys.length) continue
    await graph.apply([{
      entity: row.entity,
      ...keep.length ? { file_retirement: { keys: keep } } : { $delete: true },
    }], { trusted: true })
  }
}

/** The directory's complete census, including trash, checked at deletion. */
export let standing = async (dir: Directory) => {
  let apps = []
  for (let space of await dir.all()) {
    for (let app of await dir.apps(space)) {
      apps.push({ prefix: `${space.store}/`, app })
    }
  }
  return apps
}

export let retired = async (
  graph: Ledger,
  dir: Directory,
  blobs: Objects,
  eid: string,
  attempt?: Pick<Attempt, 'defer'>,
  now = Date.now(),
) => {
  let [row] = await graph.read(
    line`.entity.eid=${eid}&.file_retirement`,
  ) as Retirement[]
  if (!row) return
  let wait = waiting(row.file_retirement.at, now)
  if (wait > 0) return attempt?.defer?.(wait)
  await pruned(dir, blobs, await standing(dir), now, async (keys) => {
    let [current] = await graph.read(
      line`.entity.eid=${eid}&.file_retirement`,
    ) as Retirement[]
    if (!current || waiting(current.file_retirement.at, now)) return
    let due = new Set(current.file_retirement.keys)
    await blobs.delete(keys.filter((key) => due.has(key)))
  })
  await graph.apply([{ entity: { eid }, $delete: true }], { trusted: true })
}

/** Hashes in a written row or release manifest, including the file replaced. */
export let referenced = (row: Bundle): string[] => {
  let write = row.written as { sha?: string; was?: string } | undefined
  let deploy = row.deploy as { files?: string } | undefined
  return [
    write?.sha,
    write?.was,
    ...Object.values(JSON.parse(deploy?.files ?? '{}')),
  ]
    .filter((sha): sha is string => typeof sha == 'string' && !!sha)
    .map(addressed)
}
