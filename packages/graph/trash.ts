// Storage keeps a recoverable copy before a destructive write, in the same
// transaction. One batch holds each entity as it first stood, including the
// rows a death cascade detaches or releases.
import { after, each } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { type Bundle, comps, dead } from './bundle.ts'
import { mint } from './mint.ts'
import type { Storage, Tx } from './storage.ts'
import { Refused } from './errors.ts'
import type { ApplyOpts, Graph } from './graph.ts'
import { token } from './sha256.ts'

/** One retained transaction, including every row it removed data from. */
export type Trash = { id: string; at: string; bundles: Bundle[] }

/** A bounded archive page, or one exact retained transaction. */
export type TrashPage = {
  after?: string
  before?: Pick<Trash, 'at' | 'id'>
  id?: string
  limit?: number
}

/** Reject an invalid read window rather than accidentally selecting all history. */
export let trashLimit = (page: TrashPage): number => {
  let limit = page.limit ?? 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Refused('trash limit must be an integer from 1 to 100')
  }
  return limit
}

/** The ordering shared by archive discovery and its continuation cursor. */
export let trashOrder = (
  a: Pick<Trash, 'at' | 'id'>,
  b: Pick<Trash, 'at' | 'id'>,
): number => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)

/** Whether a proposed server-owned field is the archive's original value. */
export type Restored = (
  bundle: Bundle,
  component: string,
  property?: string,
) => boolean

/** Verify restore requests against this store's own archive before admission. */
export let restoreFields = async (
  storage: Storage,
  bundles: Bundle[],
): Promise<Restored> => {
  let retained = new Map<string, Bundle>()
  for (let b of bundles) {
    if (b.$restore === undefined) continue
    if (typeof b.$restore != 'string' || !storage.trash) {
      throw new Refused('restore requires an existing retained transaction')
    }
    let [entry] = await storage.trash([b.entity.eid], { id: b.$restore })
    let saved = entry?.bundles.find((row) => row.entity.eid == b.entity.eid)
    if (!saved) {
      throw new Refused(
        `${b.entity.eid} has no values in retained transaction ${b.$restore}`,
      )
    }
    retained.set(`${b.$restore}/${b.entity.eid}`, saved)
  }
  return (b, comp, prop) => {
    let source = retained.get(`${b.$restore}/${b.entity.eid}`)?.[comp]
    let patch = b[comp]
    if (!source || !patch) return false
    let same = (p: string) =>
      token((source as Record<string, unknown>)[p] ?? null) ==
        token((patch as Record<string, unknown>)[p] ?? null)
    return prop === undefined ? Object.keys(patch).every(same) : same(prop)
  }
}

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
  entry: Trash | Trash[],
  opts: RestoreOpts = {},
): Promise<Bundle[]> => {
  let entries = Array.isArray(entry) ? entry : [entry]
  let sources = new Map<string, { id: string; bundle: Bundle }>()
  for (let saved of entries) {
    for (let b of saved.bundles) {
      if (!sources.has(b.entity.eid)) {
        sources.set(b.entity.eid, { id: saved.id, bundle: b })
      }
    }
  }
  let bundles = [...sources.values()].map((s) => s.bundle)
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
    let source = sources.get(saved.entity.eid)?.id
    // A plugin may allocate a new generated identity (a renamed alias key).
    // Its system metadata belongs to the new row, while retained rows keep
    // their verified original metadata.
    if (!source) {
      saved = {
        entity: saved.entity,
        ...Object.fromEntries(
          comps(saved).flatMap(([c, row]) => {
            let fields = Object.entries(row ?? {}).filter(([p]) =>
              !graph.vocab.prop(c, p)?.stamped
            )
            return fields.length || !Object.keys(row ?? {}).length
              ? [[c, Object.fromEntries(fields)]]
              : []
          }),
        ),
      }
    }

    let now = current.get(saved.entity.eid)
    if (!now || dead(now)) {
      return [{
        ...saved,
        ...source ? { $restore: source } : {},
        $was: now
          ? { tombstone: { '': token({}) } }
          : { entity: { eid: null } },
      }]
    }
    let patch: Bundle = {
      entity: { eid: saved.entity.eid },
      ...source ? { $restore: source } : {},
    }
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
  entry: Trash | Trash[],
  opts: ApplyOpts & RestoreOpts = {},
): Promise<Bundle[]> => {
  let { notice, ...apply } = opts
  let patches = await restoring(graph, entry, { notice })
  return patches.length ? await graph.apply(patches, apply) : []
}

export { readTrash } from './trash-read.ts'

/** Erase exact entities' saved copies after a person chose permanent purge,
 * or for an intentional security redaction. Ordinary deletion never calls it.
 * Unrelated rows in a shared transaction or trash group remain recoverable. */
export let purgeEntities = (
  graph: Graph,
  eids: string[],
): void | Promise<void> => {
  let targets = new Set(eids)
  if (!targets.size) return
  let removed: Bundle[] = []
  let saved = (cursor?: string): void | Promise<void> => {
    if (!graph.storage.trash) return
    return after(
      graph.storage.trash(eids, { limit: 100, after: cursor }),
      (page) => {
        removed.push(
          ...page.flatMap((t) =>
            t.bundles.filter((b) => targets.has(b.entity.eid))
          ),
        )
        if (page.length == 100) {
          return saved(page.at(-1)!.id)
        }
      },
    )
  }
  let append = (values: Bundle[] | void): void => {
    removed.push(...values ?? [])
  }
  return graph.storage.tx(() =>
    after(graph.storage.get(eids), (live) => {
      removed.push(...live)
      let steps: (() => void | Promise<void>)[] = [
        () => saved(),
        () => after(graph.storage.purgeHistory?.(eids), append),
        ...graph.plugins.map((plugin) => () =>
          after(plugin.purge?.(graph, eids), append)
        ),
        () => graph.storage.purgeTrash?.(eids),
        ...graph.plugins.map((plugin) => () => plugin.purged?.(graph, removed)),
      ]
      return each(steps, undefined as void, (_v, step) => step())
    })
  )
}
