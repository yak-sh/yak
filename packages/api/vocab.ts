// The vocabulary, and only that: the module exported as `@yaks/api/vocab`.
// One component, `request`, because the server that answered a request is the
// only one that knows how it answered (./request.ts), and one tool, `serve` in
// ./tools.ts, because listening on a port is something somebody asks a graph
// to do, and a thing you can ask a graph to do is a tool.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The component and the tool this plugin declares. */
export let apiDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [apiDoc]
