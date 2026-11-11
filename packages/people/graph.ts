// The graph plugins this package contributes: the module a server imports at
// `@yaks/people/graph`, so a sign-up in a store that keeps people is matched
// to them.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { speaks } from './mod.ts'
import { people } from './plugin.ts'

/** The sign-up rule, in a store that keeps `individual` as this package
 * means it ({@link speaks}): one lent these words because its app names
 * @yaks/people, or one that declares them itself the same way. A store that
 * means something else by the word gets nothing. */
export let plugins = ({ vocab }: { vocab: Vocab }): Plugin[] =>
  speaks(vocab, 'individual') ? [people(vocab)] : []
