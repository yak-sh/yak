// The store's alias keys: each readable name, such as beast:boar or sfx:wolf,
// to the eid it names, and back. A store keeps an alias as a key entity,
// key{of, value} (@yaks/alias), and the page watches them (main.ts), so code
// and data may name an entity by a name a person reads while every stored
// reference holds its eid.
import { comp } from './bundle.ts'
import type { Bundle } from './net.ts'

let held: Bundle[] = []
let names = new Map<string, string>()
let aliases = new Map<string, string>()

/** Install the store's alias keys, `key{of, value}`. The same rows again
 * keep the index. */
export let useNames = (rows: Bundle[]) => {
  if (rows == held) return
  held = rows
  names = new Map(rows.flatMap((row) => {
    let k = comp(row, 'key')
    return typeof k.value == 'string' && typeof k.of == 'string'
      ? [[k.value, k.of]]
      : []
  }))
  aliases = new Map([...names].map(([name, eid]) => [eid, name]))
}

/** The eid an alias names. */
export let named = (name: string): string | undefined => names.get(name)

/** An entity's alias, by its eid. */
export let aliasOf = (eid: string): string | undefined => aliases.get(eid)
