// The vocabulary, and only that: the module exported as `@yaks/api/vocab`.
// `request` records failed HTTP answers; `apply_receipt` is a keyed write's receipt
// as a graph kept it before receipts moved into the write log (./log.ts), read
// until it is moved there. Both belong to the answering server. The tool `serve` in
// ./tools.ts, because listening on a port is something somebody asks a graph
// to do, and a thing you can ask a graph to do is a tool.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

/** The components and the tool this plugin declares. */
export let apiDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [apiDoc]
