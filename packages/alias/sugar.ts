// The shorthand: a name written on the entity it names.
//
// A key is its own entity — `{key: {of, value}, alias: {}}` — which is the
// right shape to STORE and the wrong shape to write by hand. What people
// actually write is the name beside the entity:
//
//   { entity: { eid: '$r' }, alias: { name: 'recipe:lemon-cakes' },
//     doc: { title: 'Lemon cakes' } }
//
// So the `normalize` phase rewrites it: the `alias` component comes off the
// bundle and a key entity is added beside it, pointing back. Everything after
// that belongs to @yaks/key — the derived id, the deduplication that lands a
// repeat on one row, the rejection when another entity already has the name —
// because a name is simply a kind of key.
//
// It runs before `admit`, which is why `name` may be a property the vocabulary
// has never heard of: the shorthand is consumed before the vocabulary is
// consulted.

import type { Bundle, Hook } from '@yaks/graph'
import { Refused } from '@yaks/graph'
import { KEY, keyed } from '@yaks/key'
import { ALIAS, nameOf } from './comp.ts'

/**
 * The `normalize` hook that turns `alias{name}` on an entity into the key
 * entity it stands for. A bundle carrying the component with no `name`
 * (`alias: {}`) is the key entity itself and is left exactly alone.
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
