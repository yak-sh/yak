// Files outlive their last referrer by the store's point-in-time window.
import type { Bundle } from '@yaks/graph'
import { mint } from '@yaks/graph/identity'
import { addressed } from '@yaks/platform/versions'
import { type Line, line } from '@yaks/query'
import { blobPrefix, receiptPrefix, uploadPrefix, waiting } from './blob-key.ts'
import { ownedPrefix } from './file-root.ts'
import { WINDOW } from './recover.ts'
import { idOf } from '@yaks/platform/listing'
import type { Directory } from './directory.ts'
import type { Objects } from '@yaks/blob'
import { pruned } from './written.ts'
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
      apps.push({ prefix: `${space.store}/`, app, space })
    }
  }
  return apps
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

let ownerStands = async (graph: Ledger, row: Retirement) => {
  let owner = row.file_retirement.owner
  return !!owner && (await graph.read(
        line`.entity.eid=${idOf(owner)}&(.app|.space|.visit)`,
      )).length > 0
}

let current = async (graph: Ledger, eid: string) =>
  (await graph.read(line`.entity.eid=${eid}&.file_retirement`))[0] as
    | Retirement
    | undefined

let protectedPrefixes = (apps: Awaited<ReturnType<typeof standing>>) =>
  apps.flatMap(({ app, space }) => [
    `${ownedPrefix(space, app)}/`,
    blobPrefix(space, app),
    `${space.store}/.releases/${app.eid}/`,
    `${space.store}/.declarations/${app.eid}/`,
    receiptPrefix(app),
    uploadPrefix(app),
  ])

export let retired = async (
  graph: Ledger,
  dir: Directory,
  blobs: Objects,
  eid: string,
  attempt?: Pick<Attempt, 'defer'>,
  now = Date.now(),
) => {
  let row = await current(graph, eid)
  if (!row) return
  if (row.file_retirement.owner) {
    if (await ownerStands(graph, row)) return attempt?.defer?.(WINDOW)
    if (!row.file_retirement.at) {
      await graph.apply([{
        entity: { eid },
        file_retirement: { at: new Date(now).toISOString() },
      }], { trusted: true })
      return attempt?.defer?.(WINDOW)
    }
  }
  let wait = waiting(row.file_retirement.at!, now)
  if (wait > 0) return attempt?.defer?.(wait)
  let apps = await standing(dir)
  if (row.file_retirement.owner) {
    let prefixes = protectedPrefixes(apps)
    row = await current(graph, eid)
    if (!row) return
    if (await ownerStands(graph, row)) return attempt?.defer?.(WINDOW)
    if (!row.file_retirement.at || waiting(row.file_retirement.at, now)) {
      return attempt?.defer?.(WINDOW)
    }
    await blobs.delete(
      row.file_retirement.keys.filter((key) =>
        !prefixes.some((prefix) => key.startsWith(prefix))
      ),
    )
  } else {
    await pruned(dir, blobs, apps, now, async (keys) => {
      let currentRow = await current(graph, eid)
      if (!currentRow || waiting(currentRow.file_retirement.at!, now)) return
      let due = new Set(currentRow.file_retirement.keys)
      await blobs.delete(keys.filter((key) => due.has(key)))
    })
  }
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
