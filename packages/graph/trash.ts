// Storage keeps a recoverable copy before a destructive write, in the same
// transaction. One batch holds each entity as it first stood, including the
// rows a death cascade detaches or releases.
import { after } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { type Bundle, comps, dead } from './bundle.ts'
import { mint } from './mint.ts'
import type { Tx } from './storage.ts'
import type { ApplyOpts, Graph } from './graph.ts'
import { token } from './sha256.ts'

/** One retained transaction, including every row it removed data from. */
export type Trash = { id: string; at: string; bundles: Bundle[] }

/** Wrap a storage transaction so every data removal keeps its before-image.
 * Generated or computed properties are never manufactured into saved rows. */
export let preserving = <T extends Tx>(
  tx: T,
  vocab: Vocab,
  keep: (id: string, at: string, bundles: Bundle[]) => void | Promise<void>,
): T => {
  let id: string, at: string
  let held = new Set<string>()
  let erased = (before: Bundle, patch: Bundle): boolean =>
    comps(patch).some(([c, value]) => {
      let old = before[c]
      return old != null &&
        (value == null ||
          Object.entries(value).some(([p, v]) =>
            v === null && (old as Record<string, unknown>)[p] != null
          ))
    })
  let retain = (eids: string[], patches?: Bundle[]) => {
    let wanted = [...new Set(eids)].filter((eid) => !held.has(eid))
    if (!wanted.length) return
    return after(tx.get(wanted), (rows) => {
      let saved = rows.filter((b) =>
        !dead(b) && comps(b).length &&
        (!patches ||
          patches.some((p) => p.entity.eid == b.entity.eid && erased(b, p)))
      ).map((b) => ({
        entity: b.entity,
        ...Object.fromEntries(
          comps(b).filter(([c]) => !vocab.comp(c)?.computed)
            .map(([c, row]) => [
              c,
              Object.fromEntries(
                Object.entries(row ?? {})
                  .filter(([p]) => !vocab.prop(c, p)?.computed),
              ),
            ]),
        ),
      }))
      for (let b of saved) held.add(b.entity.eid)
      if (!saved.length) return
      id ??= mint()
      at ??= new Date().toISOString()
      return keep(id, at, saved)
    })
  }
  return {
    ...tx,
    patch: (bundles: Bundle[]) =>
      after(
        retain(
          bundles.filter((b) =>
            comps(b).some(([, c]) =>
              c == null || Object.values(c).some((v) => v === null)
            )
          ).map((b) => b.entity.eid),
          bundles,
        ),
        () => tx.patch(bundles),
      ),
    remove: (entities) =>
      after(retain(entities.map((e) => e.eid)), () => tx.remove(entities)),
  } as T
}

/** Report changes made while choosing where retained data can return. */
export type RestoreOpts = { notice?: (text: string) => void }

/** Restore a retained transaction without replacing later values on survivors.
 * The caller supplies the same authority it uses for ordinary graph writes. */
export let restoring = async (
  graph: Graph,
  entry: Trash,
  opts: RestoreOpts = {},
): Promise<Bundle[]> => {
  let bundles = entry.bundles
  for (let plugin of graph.plugins) {
    if (!plugin.restore) continue
    let restored = await plugin.restore(graph, bundles)
    bundles = restored.bundles
    for (let notice of restored.notices ?? []) opts.notice?.(notice)
  }
  let current = new Map(
    (await graph.get(bundles.map((b) => b.entity.eid)))
      .map((b) => [b.entity.eid, b]),
  )
  let patches = bundles.flatMap((saved): Bundle[] => {
    let now = current.get(saved.entity.eid)
    if (!now || dead(now)) {
      return [{
        ...saved,
        $was: now
          ? { tombstone: { '': token({}) } }
          : { entity: { eid: null } },
      }]
    }
    let patch: Bundle = { entity: { eid: saved.entity.eid } }
    let was: NonNullable<Bundle['$was']> = {}
    for (let [comp, row] of comps(saved)) {
      if (row == null) continue
      let held = now[comp] as Record<string, unknown> | undefined
      let missing = Object.fromEntries(
        Object.entries(row).filter(([p]) => held?.[p] == null),
      )
      if (!held || Object.keys(missing).length) {
        patch[comp] = held ? missing : row
        was[comp] = held
          ? Object.fromEntries(
            Object.keys(row).map((p) => [p, token(held?.[p] ?? null)]),
          )
          : { '': null }
      }
    }
    if (!comps(patch).length) return []
    patch.$was = was
    return [patch]
  })
  return patches
}

/** Apply a retained transaction through the graph under the caller's authority. */
export let restoreTrash = async (
  graph: Graph,
  entry: Trash,
  opts: ApplyOpts & RestoreOpts = {},
): Promise<Bundle[]> => {
  let { notice, ...apply } = opts
  let patches = await restoring(graph, entry, { notice })
  return patches.length ? await graph.apply(patches, apply) : []
}
