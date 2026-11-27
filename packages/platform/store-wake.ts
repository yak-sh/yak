import {
  doorOf,
  type Namespace,
  resending,
  type Stub,
  stubOf,
} from '@yaks/durable-object/door'
import { FILED } from '@yaks/api/headers'
import { PLATFORM_STORE } from './names.ts'

/** The object that holds the platform directory, placed near Chicago. */
export let PLATFORM_OBJECT: string = 'yak/platform/ord'

/** The object a Store handle names. */
export let objectOf = (store: string): string =>
  store == PLATFORM_STORE ? PLATFORM_OBJECT : store

/** Place new objects in eastern North America, beside the callers that
 * create them. A placed object keeps its location (T-149707). */
export let STORES_AT: string = 'enam'

export let placed = (ns: Namespace, store: string): Stub =>
  stubOf(ns, objectOf(store), STORES_AT)

/** Server-owned properties are admitted on a platform request. */
export let KERNEL: Record<string, string> = { 'x-yak-kernel': '1' }

/** A Store boots for the caller behind this request and answers 204. */
export let WAKE: string = '/wake'

let recent = new WeakMap<Namespace, Map<string, number>>()

/** Boot a Store already named by an authorized page's route. The caller
 * holds this work outside the page response. The wake sends no visitor
 * credentials and carries no authority to change the Store's route. */
export let wakeStore = async (
  ns: Namespace,
  store: string,
  report: (error: unknown) => void,
  now = Date.now(),
): Promise<void> => {
  let held = recent.get(ns)
  if (!held) recent.set(ns, held = new Map())
  if (now - (held.get(store) ?? -Infinity) < 10_000) return
  held.delete(store)
  held.set(store, now)
  if (held.size > 1024) held.delete(held.keys().next().value!)

  let reported: { error: unknown } | undefined
  try {
    let send = resending(doorOf((req) => placed(ns, store).fetch(req)), {
      report: (error) => {
        reported = { error }
        report(error)
      },
    })
    let answer = await send(WAKE, {}, { ...KERNEL, 'x-store': store })
    await answer.body?.cancel()
    if (
      answer.status >= 500 && !answer.headers.has(FILED) &&
      answer.headers.get('x-yak-migration') != 'refused'
    ) {
      throw new Error(`Store wake answered ${answer.status}`)
    }
  } catch (error) {
    if (held.get(store) == now) held.delete(store)
    if (!reported || error !== reported.error) report(error)
  }
}
