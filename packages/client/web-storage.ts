// A vault over Web Storage: one item per entity, under a name the
// application picks. `sessionStorage` is the tab's own, kept across its
// reloads and gone with it (Deno keeps one for the process), which is where
// {@link client} keeps a `durable: tab` component. Every call answers at
// once, so what the tab held is back in the graph before `client()` returns
// and the first paint already has it.

import type { Saved, Vault } from './vault.ts'

/** The part of Web Storage's `Storage` a vault uses. */
export type Area = Pick<
  Storage,
  'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'
>

/**
 * A {@link Vault} over a Web Storage area, each entity an item named
 * `<name>:<eid>`:
 *
 * ```ts ignore
 * let tab = keep(graph, webStorage(sessionStorage, 'recipes'), 'tab')
 * ```
 *
 * Give each application its own name. An item this build cannot read is
 * skipped, and the next write of that entity replaces it.
 */
export let webStorage = (area: Area, name = 'yaks'): Vault => {
  let pre = `${name}:`
  let keys = () =>
    Array.from({ length: area.length }, (_, i) => area.key(i) ?? '')
      .filter((k) => k.startsWith(pre))
  let read = (key: string): Saved[] => {
    try {
      return [JSON.parse(area.getItem(key) ?? '')]
    } catch {
      return []
    }
  }
  return {
    load: () => keys().flatMap(read),
    save: (recs) => {
      for (let r of recs) area.setItem(pre + r.eid, JSON.stringify(r))
    },
    drop: (eids) => {
      for (let eid of eids) area.removeItem(pre + eid)
    },
    clear: () => {
      for (let k of keys()) area.removeItem(k)
    },
  }
}
