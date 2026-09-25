// The component declaration, and nothing else: the module a server or a browser
// page imports at `@yaks/mcp-client/vocab`. It reaches no storage, no SQL and
// no runtime, so a browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The `mcp_server` component: a server definition, persisted. */
export let mcpDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [mcpDoc]
