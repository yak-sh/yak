// `yak admin relocate`: where each of yaks.app's stores stands, and with
// --move each app's store far from the kernel moved beside it. Cloudflare never
// moves a Durable Object, and the kernel makes every call a store answers, so a
// store an ocean away waits about 100 ms on each. Every new object is created
// in eastern North America (workers/yak/door.ts `STORES_AT`); an older one
// moves to a new object there (workers/yak/relocate.ts): copied while it
// serves, then handed on in a short hold, the directory naming the new object.
// Every entity the store held is read again through the new object before the
// sweep goes on, and one missing stops it.
import type { Swept } from '../../workers/yak/sweep.ts'

/** The colos an object hinted to eastern North America stands in. */
export let NEAR = new Set(['ATL', 'EWR', 'IAD', 'MIA', 'ORD'])

/** An app's own store: not its sample's, a visitor's, git's or the directory's,
 * which the door does not move. */
let own = (s: Swept) => /^[^ ]+\/[^ ]+$/.test(s.at)

/** A new object's name: the store's own with a fresh key on the end, so it
 * still reads as that app's in Cloudflare's dashboard. */
export let renamed = (
  store: string,
  key = crypto.randomUUID().slice(-6),
) => `${store.replace(/\.[0-9a-f]{6}$/, '')}.${key}`

export let relocate = async (o: {
  stores: Swept[]
  standing: (store: string) => Promise<string>
  eids: (at: string) => Promise<string[]>
  prepare: (store: string, to: string) => Promise<unknown>
  hand: (store: string, to: string) => Promise<unknown>
  move: boolean
  out: (line: string) => void
  stopping: AbortSignal
}): Promise<string[]> => {
  let far: string[] = [], moved: string[] = [], failed: string[] = []
  for (let s of o.stores) {
    if (o.stopping.aborted) break
    try {
      let at = await o.standing(s.store)
      if (NEAR.has(at)) {
        o.out(`${s.at}  ${at}`)
        continue
      }
      far.push(s.at)
      if (!o.move || !own(s)) {
        o.out(`${s.at}  ${at}, far`)
        continue
      }
      let before = await o.eids(s.at)
      let to = renamed(s.store)
      await o.prepare(s.store, to)
      let there = await o.standing(to)
      if (!NEAR.has(there)) {
        failed.push(s.at)
        o.out(`${s.at}  ${at}, far; ${to} stands in ${there}, so it stays`)
        continue
      }
      await o.hand(s.store, to)
      let after = new Set(await o.eids(s.at))
      let lost = before.filter((eid) => !after.has(eid))
      if (lost.length) {
        failed.push(s.at)
        o.out(`${s.at}  moved to ${to}, and ${lost.length} entities are gone`)
        break
      }
      moved.push(s.at)
      o.out(`${s.at}  ${at} → ${there} as ${to}, ${before.length} entities`)
    } catch (e) {
      failed.push(s.at)
      o.out(`${s.at}  failed: ${e instanceof Error ? e.message : e}`)
    }
  }
  return [
    `${o.stores.length} stores, ${far.length} far` +
    (far.length ? `: ${far.join(', ')}` : ''),
    ...o.move ? [`${moved.length} moved`] : [],
    ...failed.length ? [`${failed.length} failed: ${failed.join(', ')}`] : [],
  ]
}
