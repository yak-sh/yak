// The tool declaration, and only that: the module exported as
// `@yaks/api/vocab`. This package declares no COMPONENT — an HTTP endpoint is
// not a domain, and nothing here is stored. What it declares is one tool,
// `serve` in ./tools.ts, because listening on a port is something somebody
// asks a graph to do, and a thing you can ask a graph to do is a tool.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tool declaration this plugin contributes. */
export let apiDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [apiDoc]
