// Unreferenced bucket keys remain in recoverable trash until a person purges them.
import type { Bundle } from '@yaks/graph'
import { mint } from '@yaks/graph/identity'
import { addressed } from '@yaks/platform/versions'
import { type Line, line } from '@yaks/query'
import type { Directory } from './directory.ts'
import type { Objects } from '@yaks/blob'
import type { Attempt } from '@yaks/effects'

type Retirement = Bundle & {
  file_retirement: { keys: string[]; at?: string | null; owner?: string }
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
  owner?: string,
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
        at: owner ? null : new Date(now).toISOString(),
        ...owner ? { owner } : {},
      },
    }], { trusted: true })
  }
}

/** A new or departing referrer removes exactly its keys from the trash list.
 * The next sweep records them again if they are orphaned. */
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

/** Preserve the physical keys before an explicit erase touches its store. */
export let retiringPrefix = async (
  graph: Ledger,
  blobs: Objects,
  prefix: string,
  owner: string,
) => {
  let keys = await blobs.list(prefix)
  await reclaimed(graph, keys)
  await retiring(graph, keys, Date.now(), owner)
  return keys
}

/** Complete old queued retirement runs without destroying retained bytes.
 * Retirement has no timer; only a person's explicit purge removes keys. */
export let retired = (
  _graph: Ledger,
  _dir: Directory,
  _blobs: Objects,
  _eid: string,
  _attempt?: Pick<Attempt, 'defer'>,
  _now = Date.now(),
): Promise<void> => Promise.resolve()

/** Purge a prefix after a person confirms permanent erasure from the trash. */
export let purgedPrefix = async (
  graph: Ledger,
  blobs: Objects,
  prefix: string,
) => {
  let keys = await blobs.list(prefix)
  await blobs.delete(keys)
  await reclaimed(graph, keys)
  return keys
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
