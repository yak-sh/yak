// What this package declares, and nothing more, exported as
// `@yaks/spawn/vocab`. It declares three tools, two effects and no components
// at all: a managed session uses nothing of this package's own, since the
// session belongs to @yaks/session, the running child process is
// @yaks/process's `process`, and the request is the `using` component on the
// first entry. All that is new here is the three tools a person can call
// (./tools.ts), and what a `using` or a `stop` owes (./effects.ts).

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The three tools a managed session answers to, and the two effects. */
export let spawnDoc: VocabDoc = doc

/** Every vocabulary document this package declares. */
export let docs: VocabDoc[] = [spawnDoc]
