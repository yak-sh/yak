// The spelling: a name said on the entity it names.
//
// A key is its own entity — `{key: {of, value}, alias: {}}` — and that is the
// right shape to STORE and the wrong shape to write by hand. What anybody
// writes is the name beside the thing:
//
//   { entity: { eid: '$r' }, alias: { name: 'recipe:lemon-cakes' },
//     doc: { title: 'Lemon cakes' } }
//
// So the `normalize` phase lifts it: the tag comes off the bundle and a key
// entity goes in beside it, pointing back. Everything after that is @yaks/key's
// — the derived id, the dedupe that lands a repeat on one row, the refusal when
// somebody else holds the name — because a name is nothing but a kind of key.
//
// It runs before `admit`, which is why `name` may be a word the vocabulary has
// never heard of: the sugar is consumed before anything is asked about it.

import type { Bundle, Hook } from '@yaks/graph'
import { Refused } from '@yaks/graph'
import { KEY, keyed } from '@yaks/key'
import { ALIAS, nameOf } from './comp.ts'

/**
 * The `normalize` hook that turns `alias{name}` on an entity into the key
 * entity it means. A bundle that carries the tag bare (`alias: {}`) is the key
 * itself and is left exactly alone.
 */
export let split = (): Hook => (bundles) => {
  let out: Bundle[] = []
  for (let b of bundles) {
    let name = nameOf(b)
    if (!name) {
      out.push(b)
      continue
    }
    if (b[KEY] != null) {
      throw new Refused(
        `${b.entity.eid} states a key and a name at once — a key's value is ` +
          'key.value, and alias{name} is how an ENTITY says its name',
      )
    }
    let { [ALIAS]: _, ...rest } = b
    out.push(rest as Bundle)
    out.push(keyed(ALIAS, b.entity.eid, name))
  }
  return out
}
