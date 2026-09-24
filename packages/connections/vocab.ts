// The component and tool declarations, and nothing else: the module a server or
// a browser page imports at `@yaks/connections/vocab`. It reaches no storage,
// no vault and no runtime, so a browser tab loading this vocabulary loads
// nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** `integration`, `connection`, the `uses` relation, and the two tools. */
export let connectionsDoc: VocabDoc = doc as VocabDoc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [connectionsDoc]
