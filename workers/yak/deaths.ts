// A reference's death rule holds across a space's apps (T-151524). Each app's
// store applies a delete to its own rows (@yaks/graph cascade.ts), and a
// reference in one app to an entity of another is an eid like any other, so a
// death in one store is told to the others: the dying store's `notify_deaths`
// effect (facets/app-vocab.ts) delivers it to every sibling whose words declare
// a reference with a rule to apply, and each applies its own rules
// (@yaks/graph `bereft`) at `MOURN`.
//
// Siblings are read from the directory and their release declarations, which
// wake no store: a sibling whose words declare no reference that cascades,
// detaches or releases has nothing a death could change, and is left asleep.
import type { Eid } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import { declarationOf } from './declaration.ts'
import { directoryOf, storeName } from './directory.ts'
import { storeOf } from './door.ts'
import { type Namespace } from '@yaks/durable-object/door'
import type { Env } from './env.ts'
import { KERNEL } from './meta.ts'

/** The store door a death is told at: `{died: [eid, …]}`, kernel only. */
export let MOURN = '/mourn'

/** A store's mark that the graves it held before deaths were told are told
 * (graph.ts `#mourned`): the hour that walk began. */
export let MOURNED = 'mourned'

// Whether a vocabulary declares a reference a death changes something by.
let bearing = (doc: VocabDoc): boolean =>
  Object.values(doc.$defs ?? {}).some((def) =>
    Object.values(def.properties ?? {}).some((p) =>
      typeof p == 'object' && p != null && 'ref' in p &&
      ['cascade', 'detach', 'release'].includes(String(p.death))
    )
  )

/** The stores of the other apps serving in this app's space whose words
 * declare a reference with a death rule to apply. */
export let siblings = async (
  env: Partial<Env> & { STORE: Namespace },
  app: Eid,
): Promise<string[]> => {
  let dir = directoryOf(env.STORE)
  let found = await dir.appAt(app)
  if (!found) return []
  let { space } = found
  let mine = storeName(space, found.app)
  let apps = (await dir.apps(space)).filter((one) =>
    !one.trashed && one.eid != app && storeName(space, one) != mine
  )
  let told = await Promise.all(
    apps.map(async (one) =>
      bearing((await declarationOf(env as Env, space, one)).vocab)
        ? [storeName(space, one)]
        : []
    ),
  )
  return told.flat()
}

/** Tell each sibling of these deaths, and answer how many rows each changed.
 * Throws naming every sibling that did not take it, so the caller retries. */
export let mourned = async (
  env: Partial<Env> & { STORE: Namespace },
  app: Eid,
  died: Eid[],
): Promise<Record<string, number>> => {
  let out: Record<string, number> = {}
  if (!died.length) return out
  let failed: string[] = []
  await Promise.all(
    (await siblings(env, app)).map(async (name) => {
      let r = await storeOf(env.STORE, name)(MOURN, {
        method: 'POST',
        body: JSON.stringify({ died }),
      }, KERNEL)
      if (!r.ok) {
        failed.push(`${name} answered ${r.status}: ${await r.text()}`)
        return
      }
      out[name] = ((await r.json()) as { changed: number }).changed
    }),
  )
  if (failed.length) {
    throw new Error(`a death was not taken: ${failed.join('; ')}`)
  }
  return out
}
