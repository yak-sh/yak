// `yak admin relocate`: where each of yaks.app's stores stands, and with
// --move each app's store far from the kernel moved beside it. Cloudflare never
// moves a Durable Object, and the kernel makes every call a store answers, so a
// store an ocean away waits about 100 ms on each. Every new object is hinted to
// eastern North America (workers/yak/door.ts `STORES_AT`), and Cloudflare puts
// one there near the Worker that first reaches it: a birth's, from the kernel,
// stands beside it. An older one moves to a new object (workers/yak/relocate.ts):
// first reached from the kernel and kept only if it stands near, then copied
// while the store serves and handed on in a short hold, the directory naming
// the new object. Every entity the store held is read again through the new
// object before the sweep goes on, and one missing stops it.
import type { Swept } from '@yaks/platform/mover'

/** The colos the kernel runs in (its `[placement]` is aws:us-east-2), where a
 * store answers it soonest. Measured from the kernel, 2026-11-07, a warm read's
 * fetch less the store's own time: ORD 17-22 ms, ATL about 25, EWR 31-35, MIA
 * 40-50 (T-149707). */
export let NEAR = new Set(['IAD', 'ORD'])

/** How many new objects a move makes for a store before it says none stood
 * near: a hint picks the region, and the colo within it is Cloudflare's. */
let TRIES = 3

/** An app's own store: not its sample's, a visitor's, git's or the directory's,
 * which the door does not move. */
let own = (s: Swept) => /^[^ ]+\/[^ ]+$/.test(s.at)

/** A new object's name: the store's own with a fresh key on the end, so it
 * still reads as that app's in Cloudflare's dashboard. */
export let renamed = (
  store: string,
  key = crypto.randomUUID().slice(-6),
) => `${store.replace(/\.[0-9a-f]{6}$/, '')}.${key}`

// A new object for `store`, reached first from the kernel, so that it stands
// beside it as a birth's does; one that stands far is left empty, as nothing
// but its start touched it, and another name is tried.
let sited = async (
  store: string,
  standing: (store: string) => Promise<string>,
) => {
  let to = '', there = ''
  for (let tries = 0; tries < TRIES && !NEAR.has(there); tries++) {
    to = renamed(store)
    there = await standing(to)
  }
  return { to, there }
}

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
      let { to, there } = await sited(s.store, o.standing)
      if (!NEAR.has(there)) {
        failed.push(s.at)
        o.out(`${s.at}  ${at}, far; ${to} stands in ${there}, so it stays`)
        continue
      }
      let before = await o.eids(s.at)
      await o.prepare(s.store, to)
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
