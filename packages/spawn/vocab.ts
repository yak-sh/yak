// The words this package declares, and only the words: the `vocab` facet a
// host takes (`@yaks/spawn/vocab`). It is TOOLS and nothing else — a managed
// session wears no component of this package's own, since a session is
// @yaks/session's transcript, the run is @yaks/process's `process` and the
// request is the `using` on the first entry. What is new here is the three
// words a person types about one (./tools.ts).

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The three verbs a managed session answers to. */
export let spawnDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [spawnDoc]
