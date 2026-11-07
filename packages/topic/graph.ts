// The write-time half: the `@yaks/topic/graph` entry point. A topic's name is
// folded by `named()` in the `normalize` phase, the earliest there is, so
// every door that writes one (topic_new, graph_apply, a seed file, a page's
// form) stores it in one form, and "Breads" and "breads" meet on
// `topic.name`'s unique index as one topic.

import { type Bundle, type Comp, hook, type Plugin } from '@yaks/graph'
import { named, TOPIC } from './topic.ts'

/** A bundle with its topic's name folded, or as it came. */
/// fold({ entity: { eid: 'q' }, topic: { name: ' Breads ' } }) -> { entity: { eid: 'q' }, topic: { name: 'breads' } }
/// fold({ entity: { eid: 'q' }, topic: null }) -> { entity: { eid: 'q' }, topic: null }
export let fold = (b: Bundle): Bundle => {
  let t = b[TOPIC] as Comp | null | undefined
  if (typeof t?.name != 'string' || named(t.name) == t.name) return b
  return { ...b, [TOPIC]: { ...t, name: named(t.name) } }
}

/** The topic plugin: a name folded on the way in. */
export let topics = (): Plugin => ({
  name: '@yaks/topic',
  hooks: { normalize: hook([TOPIC], (bundles) => bundles.map(fold)) },
})

/** The graph plugins this package contributes. */
export let plugins = (): Plugin[] => [topics()]
