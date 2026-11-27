// Reading in a namespace: turning a name a reader writes into the word it
// means. A name is a bare label (`cost`), a full label (`yourname/trip:cost`)
// or an identity, a UUID. A full label means its word in every reader, and an
// identity always does; a bare label is read in the reader's namespace N:
//
// 1. the word N declares by that label, else a word of N's that was called it
//    before a rename, until another of N's words takes it;
// 2. a word N uses by that label: one a namespace it names in `uses` declares,
//    such as another app of its space;
// 3. the one other word by that label.
//
// Read in no namespace, a bare label means the one word by that label. A tier
// that holds several is ambiguous, and refused with the full labels to write
// instead (`Ambiguous`).

import type { Namespace } from './types.ts'
import { fullLabel } from './namespace.ts'
import { Ambiguous } from './names.ts'

/** How a reader reads: the namespace it reads in, where it has one, the
 * namespaces it uses words from, and the labels words were called before a
 * rename, by identity. */
export type Reader = {
  /** namespaces whose words it reads bare after its own, such as the other
   * apps of its space whose words it uses */
  uses?: Namespace[]
  /** the labels each word, component or property, was called before a
   * rename, by its identity: each keeps meaning its word in its namespace
   * until another word takes it */
  former?: Record<string, string[]>
}

/** One word a reader may name: the name a vocabulary holds it under, its
 * label, its namespace and its identity. */
export type Named = {
  held: string
  label: string
  ns?: Namespace
  id?: string
}

/** Whether two namespaces are one: by identity where both have one, else by
 * label. One that says neither is no namespace a reader can be in. */
export let one = (a?: Namespace, b?: Namespace): boolean =>
  !!a && !!b && (a.id && b.id ? a.id == b.id : !!a.label && a.label == b.label)

/** A word's full label, or the name it is held under where it has neither a
 * namespace's label nor an identity. */
export let full = (w: Named): string => fullLabel(w.label, w.ns, w.id) ?? w.held

let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** What one reader reads each name as: `meant` turns a name into the word it
 * means, undefined for one that means none and `Ambiguous` for a bare label
 * that means several, and `written` is the name the reader writes a word by:
 * its bare label where that reads back to it, its full label otherwise. */
export type Reading = {
  meant: (name: string) => Named | undefined
  written: (w: Named) => string
}

/** The reading of a list of words by a reader in `ns` (none for a reader in
 * no namespace). */
export let reading = (
  words: Named[],
  ns: Namespace | undefined,
  { uses = [], former = {} }: Reader = {},
): Reading => {
  let group = (pick: (w: Named) => string[]) => {
    let out = new Map<string, Named[]>()
    for (let w of words) {
      for (let k of pick(w)) out.set(k, [...out.get(k) ?? [], w])
    }
    return out
  }
  let labeled = group((w) => [w.label])
  let was = group((w) => w.id ? former[w.id] ?? [] : [])
  let ids = new Map(words.flatMap((w) => w.id ? [[w.id, w]] : []))
  let mine = (w: Named) => one(w.ns, ns)
  let used = (w: Named) => uses.some((u) => one(w.ns, u))

  // The words a bare label may mean: those of the first tier that has any.
  let tier = (label: string): Named[] => {
    let all = labeled.get(label) ?? []
    if (!ns) return all
    for (let pick of [all.filter(mine), (was.get(label) ?? []).filter(mine)]) {
      if (pick.length) return pick
    }
    let near = all.filter(used)
    return near.length ? near : all
  }
  // A full label: its namespace's word by that label, else the one that was
  // called it.
  let qualified = (name: string): Named | undefined => {
    let at = name.lastIndexOf(':')
    let space = name.slice(0, at), label = name.slice(at + 1)
    let here = (w: Named) => w.ns?.label == space
    return (labeled.get(label) ?? []).find(here) ??
      (was.get(label) ?? []).find(here)
  }
  let meant = (name: string): Named | undefined => {
    if (UUID.test(name)) return ids.get(name)
    if (name.includes(':')) return qualified(name)
    let all = tier(name)
    if (all.length > 1) throw new Ambiguous(name, all.map(full))
    return all[0]
  }
  let written = (w: Named): string => {
    try {
      if (meant(w.label) === w) return w.label
    } catch (e) {
      if (!(e instanceof Ambiguous)) throw e
    }
    return full(w)
  }
  return { meant, written }
}
