// The refusal: an incomplete key is not a key.
//
// A key is three things — a kind, a value, and the entity the value is FOR —
// and any two of them mean nothing. A bundle with a value and no tag would land
// as a row nothing can read; one with no `of` would identify nobody. Both are
// caught here, at the `mint` phase, which runs after the graph has assigned an
// id to every `$alias` — so the refusal can name the entity it is talking
// about, and an `of` written as an alias is already the id it resolved to.
//
// A bundle with NEITHER a value nor an `of` is a patch of a key that already
// exists, and is left alone: it claims nothing, so it cannot claim half of
// something.
//
// Every bundle in the write is read before any check, because one entity may
// arrive as several bundles — the key in one, its tag in another — and together
// they are one key.

import type { Bundle, Comp, Eid, Hook } from '@yaks/graph'
import { comps, Refused } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { KEY, names } from './kinds.ts'
import { tagOf } from './eid.ts'

// Every bundle in the write merged per entity, so a key spread over several of
// them is checked as the one key it is.
export let gathered = (bundles: Bundle[]): Map<Eid, Bundle> => {
  let out = new Map<Eid, Bundle>()
  for (let b of bundles) {
    let at = out.get(b.entity.eid) ?? { entity: b.entity }
    for (let [name, comp] of comps(b)) {
      let had = at[name] as Comp | null | undefined
      at[name] = comp == null ? null : { ...(had ?? {}), ...comp }
    }
    out.set(b.entity.eid, at)
  }
  return out
}

/**
 * The `mint` hook that refuses an incomplete key, naming what is missing.
 * Registered by {@link https://jsr.io/@yaks/key/doc/~/keys | keys}; exported on
 * its own for a graph that wants the check without the rest.
 */
export let stated = (vocab: Vocab): Hook => {
  let tags = names(vocab)
  let known = Object.values(tags).sort()
  return (bundles) => {
    for (let [eid, b] of gathered(bundles)) {
      let key = b[KEY] as Comp | null | undefined
      // nothing claimed (a patch, or a bundle about something else entirely)
      if (!key || (key.of == null && key.value == null)) continue
      for (let col of ['of', 'value']) {
        if (key[col] == null) {
          throw new Refused(`key ${eid} has no \`${col}\``)
        }
      }
      if (!tagOf(b, tags)) {
        throw new Refused(
          `key ${eid} says no kind — a key wears a kind tag beside ` +
            `key{of, value}${
              known.length ? ` (this vocabulary knows ${known.join(', ')})` : ''
            }`,
        )
      }
    }
    return bundles
  }
}
