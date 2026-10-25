// The paths an app has published files at (public-files.ts), kept on its own
// row as `publishing{paths}` by the transaction that writes the files. Every
// request to an app reads that row anyway, so the row is what says nothing is
// published at a path, and a page view of a publishing app asks the directory
// for a file only at a path on the list.
//
// Kept here rather than by the door that publishes: two files published at
// once are two batches, and a door folding its path into a list it read
// before the other door wrote would lose one. Inside the transaction, each
// batch reads the files every batch before it committed.
import { after } from '@yaks/fp'
import {
  type Bundle,
  dead,
  type Hook,
  type Plugin,
  TOMBSTONE,
  type Tx,
} from '@yaks/graph'
import { type Id, idOf } from '../directory.ts'

type File = { app?: Id; path?: string }

/**
 * The paths an app's files stand at once a batch is written: `stored` the
 * files the graph holds, `left` each file the batch touches as the batch
 * leaves it, null where the batch deletes it. Sorted, each once.
 *
 * ```ts
 * import { pathsOf } from './publishing-graph.ts'
 * import { assertEquals } from '@std/assert'
 * let stored = [
 *   { entity: { eid: 'a' }, public_file: { app: 'x', path: 'notes/1' } },
 *   { entity: { eid: 'b' }, public_file: { app: 'x', path: 'gone' } },
 *   { entity: { eid: 'e' }, public_file: { app: 'y', path: 'theirs' } },
 * ]
 * let left = new Map([
 *   ['b', null],
 *   ['c', { app: 'x', path: 'about' }],
 *   ['d', { app: 'y', path: 'also theirs' }],
 * ])
 * assertEquals(pathsOf('x', stored, left), ['about', 'notes/1'])
 * ```
 */
export let pathsOf = (
  app: string,
  stored: Bundle[],
  left: Map<string, File | null>,
): string[] => {
  let at = new Map<string, string>()
  let mine = (file?: File | null): file is Required<File> =>
    !!file?.app && !!file.path && idOf(file.app) == app
  for (let row of stored) {
    let file = row.public_file as File | undefined
    if (mine(file)) at.set(row.entity.eid, file.path)
  }
  for (let [eid, file] of left) {
    if (mine(file)) at.set(eid, file.path)
    else at.delete(eid)
  }
  return [...new Set(at.values())].sort()
}

// The batch, with each app whose files it touches wearing their paths. It
// runs in the transaction, so it stays synchronous wherever the storage is:
// on a Durable Object an await here would let the transaction commit before
// the batch is written (@yaks/durable-object).
let kept: Hook = Object.assign(
  (bundles: Bundle[], tx: Tx) => {
    let touched = bundles.filter((b) => 'public_file' in b || dead(b))
    if (!touched.length) return bundles
    let eids = touched.map((b) => b.entity.eid)
    return after(tx.get(eids, ['public_file']), (rows) => {
      // As the batch found them: a deletion names its app only here.
      let stood = new Map<string, File>()
      for (let row of rows) {
        if (row.public_file && !dead(row)) {
          stood.set(row.entity.eid, row.public_file as File)
        }
      }
      let left = new Map<string, File | null>(touched.map((b) => [
        b.entity.eid,
        dead(b) || b.public_file === null
          ? null
          : { ...stood.get(b.entity.eid), ...b.public_file as File },
      ]))
      let apps = new Set<string>()
      for (let file of [...stood.values(), ...left.values()]) {
        if (file?.app) apps.add(idOf(file.app))
      }
      // An app this batch deletes takes its files with it.
      for (let b of bundles) if (dead(b)) apps.delete(b.entity.eid)
      if (!apps.size) return bundles
      let asked = `.public_file.app=${[...apps].join(',')}`
      return after(tx.read(asked, {}, ['public_file']), (stored) => {
        let owed = new Map([...apps].map((app) => [
          app,
          { paths: JSON.stringify(pathsOf(app, stored, left)) },
        ]))
        let out = bundles.map((b) => {
          let publishing = owed.get(b.entity.eid)
          if (!publishing) return b
          owed.delete(b.entity.eid)
          return { ...b, publishing }
        })
        for (let [eid, publishing] of owed) {
          out.push({ entity: { eid }, publishing })
        }
        return out
      })
    })
  },
  { keys: ['public_file', '$delete', TOMBSTONE] },
)

export let plugins = (): Plugin[] => [{
  name: 'yak/publishing',
  admission: () => true,
  hooks: { rules: kept },
}]
